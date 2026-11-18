import { useEffect, useState } from "react";
import { Clapperboard, ExternalLink, Headphones, ImagePlus, LoaderCircle, Search, Sparkles, Upload, Video, WandSparkles } from "lucide-react";
import { API_BASE, apiFetch, deliverArtifactToTelegram, sanitizeArtifactFilename } from "./api";
import "./MotionGraphicsStudio.css";
import { useLanguage, translate } from "./localization";
import {
  formatW2MProject,
  parseW2MProject,
  validateOpenFilmProject as validateProject,
  type OpenFilmProject,
} from "./motionW2M";

const AI_IDLE_TIMEOUT_MS = 120_000;

type Provider = { id: string; name: string; model: string; is_default: boolean };
type ImageAsset = { id: string; title: string; thumbnail: string; sourceUrl: string; credit: string; license: string };
type ImageRepairReport = { repaired: Array<{ title: string; license: string }>; missing: Array<{ source: string; reason?: string }> };
type SavedProject = { project_id: string; title: string };
type PendingContinuation = {
  providerId: string;
  message: string;
  reply: string;
  attempt: number;
  images: string[];
  repairPrompt?: string;
  repairing?: boolean;
};
type AiResponseLog = { attempt: number; status: string; reply: string; error?: string };
type Voiceover = { file: File; url: string; duration: number };
type VideoReference = {
  fileName: string;
  frames: string[];
  duration: number;
  visualDescriptions: string[];
  analysisWarning?: string;
};
type AudioAnalysis = { has_voiceover: boolean; duration: number | null; quiet_spans: Array<{ start: number; end: number }> };
type ImageInputSupport = "yes" | "no" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getImageRepairReport(value: unknown): ImageRepairReport | null {
  if (!isRecord(value) || !isRecord(value.image_report)) return null;
  const { repaired, missing } = value.image_report;
  if (!Array.isArray(repaired) || !Array.isArray(missing)) return null;
  return {
    repaired: repaired.filter((item): item is { title: string; license: string } =>
      isRecord(item) && typeof item.title === "string" && typeof item.license === "string"),
    missing: missing.filter((item): item is { source: string; reason?: string } =>
      isRecord(item) && typeof item.source === "string" &&
      (item.reason === undefined || typeof item.reason === "string")),
  };
}

function imageRepairNotice(report: ImageRepairReport | null, fallback: string): string {
  if (!report) return fallback;
  const repaired = report.repaired.length;
  const missing = report.missing.length;
  if (repaired && missing) return `أُصلحت ${repaired} صور من Wikimedia Commons، وتعذر العثور على ${missing} صور أخرى.`;
  if (repaired) return `أُصلحت ${repaired} صور مفقودة وحُفظت محليًا داخل مشروع OpenFilm.`;
  if (missing) return `تعذر إصلاح ${missing} صور. افتح سجل المشروع للتحقق من روابطها.`;
  return fallback;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("انتهت مهلة قراءة الفيديو المرجعي."));
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("تعذر قراءة الفيديو المرجعي."));
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function extractVideoReference(file: File): Promise<VideoReference> {
  if (!file.type.startsWith("video/") || file.size > 250 * 1024 * 1024) {
    throw new Error("اختر فيديو مرجعيًا صالحًا لا يتجاوز حجمه 250 ميجابايت.");
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  try {
    const metadataReady = waitForVideoEvent(video, "loadedmetadata");
    video.src = url;
    video.load();
    await metadataReady;
    if (!Number.isFinite(video.duration) || video.duration <= 0 ||
      video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("الفيديو المرجعي لا يحتوي على مسار صورة صالح.");
    }
    const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("تعذر تجهيز لقطات الفيديو المرجعي.");

    const frames: string[] = [];
    for (const fraction of [0.12, 0.5, 0.88]) {
      const seeked = waitForVideoEvent(video, "seeked");
      video.currentTime = Math.min(video.duration - 0.01, Math.max(0, video.duration * fraction));
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.76));
    }
    return { fileName: file.name, frames, duration: video.duration, visualDescriptions: [] };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function analyzeFramesWithFlorence(frames: string[]): Promise<string[]> {
  const statusResponse = await apiFetch(`${API_BASE}/api/w2m/vision/status`);
  if (!statusResponse.ok) throw new Error("تعذّر معرفة حالة Florence-2 المحلي.");
  const status: unknown = await statusResponse.json();
  if (!isRecord(status) || status.installed !== true) return [];
  const descriptions: string[] = [];
  for (const [index, image] of frames.entries()) {
    const response = await apiFetch(`${API_BASE}/api/w2m/vision/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, mode: "caption" }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(result) || typeof result.caption !== "string" ||
      result.local_only !== true) {
      throw new Error(isRecord(result) && typeof result.detail === "string"
        ? result.detail
        : `تعذّر تحليل اللقطة ${index + 1} محليًا باستخدام Florence-2.`);
    }
    descriptions.push(`اللقطة ${index + 1}: ${result.caption.trim()}`);
  }
  return descriptions;
}

async function describeVideoReference(file: File): Promise<VideoReference> {
  const reference = await extractVideoReference(file);
  try {
    reference.visualDescriptions = await analyzeFramesWithFlorence(reference.frames);
  } catch (reason) {
    reference.analysisWarning = reason instanceof Error ? reason.message : "تعذّر تحليل لقطات الفيديو عبر Florence-2.";
  }
  return reference;
}

function starterProject(title: string, duration: number): OpenFilmProject {
  const safeTitle = title.trim().slice(0, 160) || "MOTION AI TASKFLOW";
  const sceneHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=1280,height=720">
<title>${safeTitle.replace(/[<>&"]/g, "")}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}
body{display:grid;place-items:center;background:radial-gradient(ellipse at 70% 20%,#563f91,#111323 58%,#070910);color:#fff;font-family:Arial,sans-serif}
main{text-align:center}.mark{font-size:18px;letter-spacing:.28em;color:#c4b5fd}h1{font-size:64px;margin:18px}
</style></head><body><main id="intro"><span class="mark">MOTION AI TASKFLOW</span><h1>مشروعك يبدأ من هنا</h1></main>
<script>
const intro=document.getElementById("intro");
window.film={duration:${duration},width:1280,height:720,frame(t){intro.style.opacity=String(Math.max(0,Math.min(1,t/.35)));}};
</script></body></html>`;
  const filmHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1280,height=720"><title>${safeTitle.replace(/[<>&"]/g, "")}</title>
<style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#070910}iframe{display:block;width:1280px;height:720px;border:0}</style></head>
<body><section><iframe id="shot-01" src="scene-01.html#t=0,${duration.toFixed(3)}"></iframe></section></body></html>`;
  return { title: safeTitle, width: 1280, height: 720, duration, film_html: filmHtml, scenes: [{ file: "scene-01.html", duration, html: sceneHtml }] };
}

function projectPrompt(
  brief: string,
  current: OpenFilmProject | null,
  assets: ImageAsset[],
  voiceoverDuration?: number,
  audioAnalysis?: AudioAnalysis,
  videoReference?: VideoReference,
  attachReferenceFrames = true,
) {
  const mediaList = assets.map((asset) => ({
    title: asset.title,
    url: `${API_BASE}/api/images/embed?url=${encodeURIComponent(asset.thumbnail)}`,
    source: asset.sourceUrl,
    credit: asset.credit,
    license: asset.license,
  }));
  const targetDuration = audioAnalysis?.duration ?? voiceoverDuration ?? current?.duration ?? 30;
  const targetSceneCount = Math.max(4, Math.min(10, Math.ceil(targetDuration / 18)));
  const common = `Act as an award-winning motion-design director and an exacting OpenFilm editor. Create a distinctive, production-ready film for this brief:
${brief}

OpenFilm is the actual editor and timeline, not a preview wrapper. Use the strict W2M/2 language below, not JSON. Metadata and block delimiters are grammar; keep each on its own line. Write raw HTML only between its matching HTML BEGIN/END lines. Never put a W2M control line inside HTML.
W2M/2
DO PROJECT
TITLE "concise project title"
CANVAS 1280x720
DURATION ${targetDuration.toFixed(3)}s
SCENES ${targetSceneCount}
DO FILM
HTML film.html BEGIN
complete OpenFilm film.html source, raw HTML
HTML film.html END
END FILM
DO SCENE scene-01.html
DURATION 18.000s
HTML scene-01.html BEGIN
complete standalone scene HTML source, raw HTML
HTML scene-01.html END
END SCENE
Repeat the DO SCENE block for every scene, then write END PROJECT and END W2M. TITLE is a JSON-quoted string. Use exact sequential filenames scene-01.html through scene-${String(targetSceneCount).padStart(2, "0")}.html, declare the matching count in SCENES, and use one scene page per block.
Create exactly ${targetSceneCount} separately editable scene pages named scene-01.html, scene-02.html, etc. Their durations must add up to the complete audio/project duration. Within every scene, choreograph three or more purposeful time-based visual beats; avoid holding one composition unchanged for more than six seconds unless deliberately honoring a narration pause. Use the brief's chronology and supplied reference frames to choose relevant, specific visuals, vary framing and scale, and keep the story moving. Never insert unrelated objects or generic filler. Keep scene source compact and minified to fit the complete editable film in one response. film_html must use valid OpenFilm tracks: one or more <section> elements containing <iframe src="scene-NN.html#t=0,DURATION" at="START"></iframe>, with sequential at times and no overlaps on a track. Put image, video and sound clips on appropriate separate tracks. The viewport is 1280x720. Each page must be a complete standalone HTML document and implement window.film={duration:SECONDS,width:1280,height:720,ready:Promise...,frame(t){...}}.
Design a clear visual arc with a striking opening, varied purposeful shots, smooth scene transitions and a memorable ending. Make each scene feel art-directed: strong composition and hierarchy, considered negative space, sophisticated typography, layered depth, rich but controlled color, fine texture, lighting and detail. Favor editorial layouts and specific visual storytelling over centered text cards or generic gradients. For illustrated explainers, build original, scene-specific vector artwork with inline SVG/CSS, vivid chapter color, meaningful diagrams, timelines, device silhouettes, and subtle lighting rather than emoji or generic placeholder shapes. Do not repeat the same composition from scene to scene.
When the image catalog is provided, use relevant real photographs from it in the film. Copy each chosen image URL exactly into the scene HTML and preserve its descriptive alt text. Never invent image URLs or filenames, never reference an unprovided assets/* path, and never leave an <img> without a valid supplied URL. If no suitable catalog image is available, create an intentional vector/CSS illustration rather than a broken image placeholder. Keep image subjects large enough to read clearly and integrate them into the composition.
Every visible DOM layer must be individually editable and have a descriptive id. window.film.frame(t) must be deterministic and set the complete visual state for that exact time. Do not use CSS animation/keyframes, transitions, timers, requestAnimationFrame, random values, autoplay, external scripts or libraries; calculate motion directly from t. Keep scene source self-contained. Do not draw captions or transcript text. Put all sound in film.html tracks, not inside scene pages. The scene durations must sum to the full project/audio duration, within 0.1 seconds. HTML blocks must be complete documents with the exact matching HTML BEGIN/END names. Output the complete W2M/2 program only.`;
  const mediaContext = mediaList.length
    ? `\n\nVerified Wikimedia image catalog. These URLs are available through this computer's local image proxy. Use the exact URL verbatim for each photo you include; do not replace it with a guessed filename or a different URL. On every catalog image <img>, preserve its source, credit, and license in data-commons-source, data-commons-credit, and data-commons-license attributes:\n${JSON.stringify(mediaList)}`
    : "";
  const referenceContext = videoReference
    ? `\n\nThe user's visual reference "${videoReference.fileName}" is ${videoReference.duration.toFixed(1)} seconds long. ${videoReference.visualDescriptions.length
      ? `Florence-2 analyzed these sampled frames locally: ${videoReference.visualDescriptions.join(" | ")}.`
      : ""} ${attachReferenceFrames
      ? "Three sampled frames are attached. Treat them as visual direction only: match the reference's motion-graphics craft, illustration approach, color rhythm, and visual variety while creating original scenes for the user's brief. Do not reproduce the reference's subject, wording, screenshots, or exact layouts."
      : "The selected provider does not accept image input, so use only the local Florence-2 descriptions above; the sampled images and source video are not sent."}`
    : "";
  const audioContext = audioAnalysis?.has_voiceover
    ? `\n\nLocal voiceover timing analysis: audio duration ${audioAnalysis.duration?.toFixed(2) ?? voiceoverDuration?.toFixed(2) ?? "unknown"} seconds. Detected low-volume intervals (seconds): ${JSON.stringify(audioAnalysis.quiet_spans)}. The audio itself is not included in this AI request. Use the supplied intervals as concrete editing cues: place a scene transition, visual hold, or clear beat near meaningful pauses without cutting off narration; group adjacent pauses instead of making awkward rapid cuts. These are acoustic silence estimates, not speech recognition; background music can mask spoken pauses. Preserve the full audio duration exactly.`
    : "";
  const instructions = `${common}${mediaContext}${referenceContext}${audioContext}`;
  if (!current) return `${instructions}\n\nThis is a new project. Design it from scratch with a coherent visual story and useful separate OpenFilm shots.`;
  return `${instructions}\n\nThis is an EDIT of the project already open in OpenFilm. Apply the requested change to the actual existing project. Preserve unrelated scenes, content, timings, scene filenames, track order, clip IDs, and any audio tracks. Return the complete updated project as W2M/2, not a proposal or a new unrelated film.\n\nCurrent OpenFilm project source in W2M/2:\n${formatW2MProject(current)}`;
}

async function fetchProject(projectId: string): Promise<OpenFilmProject> {
  const response = await apiFetch(`${API_BASE}/api/motion/editor-project/${encodeURIComponent(projectId)}`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : "تعذر قراءة مشروع OpenFilm الحالي.");
  }
  return validateProject(data);
}

async function searchImageAssets(query: string): Promise<ImageAsset[]> {
  const response = await apiFetch(`${API_BASE}/api/images/search?query=${encodeURIComponent(query)}&limit=12`);
  const data: unknown = await response.json();
  if (!response.ok || !isRecord(data) || !isRecord(data.query) || !isRecord(data.query.pages)) {
    throw new Error("تعذر البحث في مكتبة Wikimedia Commons.");
  }
  return Object.values(data.query.pages).flatMap((page): ImageAsset[] => {
    if (!isRecord(page) || !Array.isArray(page.imageinfo) || !isRecord(page.imageinfo[0])) return [];
    const info = page.imageinfo[0];
    if (typeof info.thumburl !== "string" || typeof info.descriptionurl !== "string") return [];
    const metadata = isRecord(info.extmetadata) ? info.extmetadata : {};
    const metadataValue = (key: string) => {
      const item = metadata[key];
      return isRecord(item) && typeof item.value === "string" ? item.value.replace(/<[^>]*>/g, "").trim().slice(0, 180) : "";
    };
    return [{
      id: typeof page.pageid === "number" ? String(page.pageid) : info.descriptionurl,
      title: typeof page.title === "string" ? page.title.replace(/^File:/, "") : "Wikimedia Commons image",
      thumbnail: info.thumburl,
      sourceUrl: info.descriptionurl,
      credit: metadataValue("Artist"),
      license: metadataValue("LicenseShortName"),
    }];
  });
}

export default function MotionGraphicsStudio({ initialPrompt = "" }: { initialPrompt?: string }) {
  const language = useLanguage();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [topic, setTopic] = useState(initialPrompt);
  const [designEditPrompt, setDesignEditPrompt] = useState("");
  const [project, setProject] = useState<OpenFilmProject | null>(null);
  const [projectId, setProjectId] = useState("");
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);
  const [editorUrl, setEditorUrl] = useState("");
  const [editorMode, setEditorMode] = useState<"inside" | "outside">("inside");
  const [voiceover, setVoiceover] = useState<Voiceover | null>(null);
  const [videoReference, setVideoReference] = useState<VideoReference | null>(null);
  const [processingVideoReference, setProcessingVideoReference] = useState(false);
  const [providerImageSupportByModel, setProviderImageSupportByModel] = useState<Record<string, ImageInputSupport>>({});
  const [imageQuery, setImageQuery] = useState("");
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [aiResponses, setAiResponses] = useState<AiResponseLog[]>([]);
  const [combinedReply, setCombinedReply] = useState("");
  const [pendingContinuation, setPendingContinuation] = useState<PendingContinuation | null>(null);
  const [generating, setGenerating] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [repairingImages, setRepairingImages] = useState(false);
  const [searchingImages, setSearchingImages] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedProvider = providers.find((item) => item.id === providerId);
  const providerImageSupportKey = selectedProvider ? `${selectedProvider.id}:${selectedProvider.model}` : "";
  const providerImageSupport = providerImageSupportByModel[providerImageSupportKey] ?? "unknown";

  useEffect(() => {
    let active = true;
    apiFetch(`${API_BASE}/api/providers`).then(async (response) => {
      if (!response.ok) throw new Error("تعذر تحميل مزوّدي الذكاء الاصطناعي.");
      return await response.json() as Provider[];
    }).then((items) => {
      if (!active) return;
      setProviders(items);
      setProviderId(items.find((item) => item.is_default)?.id ?? items[0]?.id ?? "");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "تعذر تحميل مزوّدي الذكاء الاصطناعي.");
    });
    apiFetch(`${API_BASE}/api/motion/latest-project`).then(async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("تعذر العثور على آخر مشروع OpenFilm محفوظ.");
      const value: unknown = await response.json();
      return isRecord(value) && typeof value.project_id === "string" && typeof value.title === "string"
        ? { project_id: value.project_id, title: value.title }
        : null;
    }).then((value) => {
      if (active && value) setSavedProject(value);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "تعذر العثور على مشروع OpenFilm محفوظ.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    let active = true;
    apiFetch(`${API_BASE}/api/providers/${encodeURIComponent(provider.id)}/models`)
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذّر قراءة إمكانات الصور لدى المزوّد.");
        return await response.json() as unknown;
      })
      .then((value) => {
        if (!active || !isRecord(value) || !isRecord(value.image_capabilities)) return;
        const capability = value.image_capabilities[provider.model];
        if (capability === "yes" || capability === "no" || capability === "unknown") {
          setProviderImageSupportByModel((current) => ({
            ...current,
            [`${provider.id}:${provider.model}`]: capability,
          }));
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setNotice(reason instanceof Error
            ? `تعذّر التحقق من دعم الصور لدى المزوّد؛ ستُرسل إليه اللقطات إن قبلها. ${reason.message}`
            : "تعذّر التحقق من دعم الصور لدى المزوّد؛ ستُرسل إليه اللقطات إن قبلها.");
        }
      });
    return () => { active = false; };
  }, [providerId, providers]);

  useEffect(() => () => {
    if (voiceover) URL.revokeObjectURL(voiceover.url);
  }, [voiceover]);

  async function saveOpenFilmProject(id: string, nextProject: OpenFilmProject, audio?: File) {
    const form = new FormData();
    form.append("project_id", id);
    form.append("project_json", JSON.stringify(nextProject));
    if (audio) form.append("audio", audio, audio.name);
    const response = await apiFetch(`${API_BASE}/api/motion/update-editor`, { method: "POST", body: form });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : "تعذر تحديث المشروع المفتوح في OpenFilm.");
    }
    return getImageRepairReport(data);
  }

  async function openNewProject(duration: number) {
    const initial = starterProject(topic.trim() || "MOTION AI TASKFLOW", duration);
    let newTab: Window | null = null;
    if (editorMode === "outside") newTab = window.open("about:blank", "_blank");
    const form = new FormData();
    form.append("project_json", JSON.stringify(initial));
    if (voiceover) form.append("audio", voiceover.file, voiceover.file.name);
    const response = await apiFetch(`${API_BASE}/api/motion/open-editor`, { method: "POST", body: form });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data) || typeof data.project_id !== "string" || typeof data.url !== "string") {
      if (newTab && !newTab.closed) newTab.close();
      throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : "تعذر بدء مشروع OpenFilm.");
    }
    const url = new URL(data.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", window.location.hostname].includes(url.hostname)) {
      if (newTab && !newTab.closed) newTab.close();
      throw new Error("رابط OpenFilm غير آمن؛ يجب أن يعمل محليًا.");
    }
    setProjectId(data.project_id);
    setProject(initial);
    setEditorUrl(url.href);
    setNotice(imageRepairNotice(getImageRepairReport(data), "تم فتح مشروع OpenFilm المحلي."));
    if (editorMode === "outside" && newTab && !newTab.closed) {
      newTab.location.replace(url.href);
      newTab.opener = null;
    } else if (newTab && !newTab.closed) {
      newTab.close();
    }
    return { projectId: data.project_id, project: initial };
  }

  async function openSavedProject() {
    if (!savedProject) return;
    const response = await apiFetch(`${API_BASE}/api/motion/open-saved/${encodeURIComponent(savedProject.project_id)}`, { method: "POST" });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data) || typeof data.project_id !== "string" || typeof data.url !== "string") {
      throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : "تعذر فتح آخر مشروع OpenFilm محفوظ.");
    }
    const url = new URL(data.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", window.location.hostname].includes(url.hostname)) {
      throw new Error("رابط OpenFilm غير آمن؛ يجب أن يعمل محليًا.");
    }
    const restoredProject = await fetchProject(data.project_id);
    setProjectId(data.project_id);
    setProject(restoredProject);
    setEditorUrl(url.href);
    setNotice(imageRepairNotice(getImageRepairReport(data), "تمت استعادة آخر مشروع OpenFilm محفوظ."));
  }

  async function loadVoiceover(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("اختر ملفًا صوتيًا مثل MP3 أو WAV.");
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error("تعذر قراءة مدة الملف الصوتي."));
      });
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("مدة الملف الصوتي غير صالحة.");
      const next = { file, url, duration };
      if (projectId) {
        const latestProject = await fetchProject(projectId);
        await saveOpenFilmProject(projectId, latestProject, file);
        setProject(latestProject);
      }
      setVoiceover(next);
      setNotice(projectId ? "أُرفق الفويس أوفر بمسار الصوت في OpenFilm." : "سيُرفق الفويس أوفر بمسار صوت OpenFilm عند إنشاء المشروع.");
      setError("");
    } catch (reason) {
      URL.revokeObjectURL(url);
      setError(reason instanceof Error ? reason.message : "تعذر تحميل الفويس أوفر.");
    }
  }

  async function loadVideoReference(file?: File) {
    setVideoReference(null);
    if (!file) return;
    setProcessingVideoReference(true);
    setError("");
    try {
      const reference = await describeVideoReference(file);
      setVideoReference(reference);
      setNotice(reference.visualDescriptions.length
        ? "حلّل Florence-2 اللقطات محليًا. لا يُرفع الفيديو؛ تُرسل الصور الثابتة للمزوّد فقط إذا كان يدعم الصور."
        : reference.analysisWarning
          ? `استُخرجت اللقطات محليًا، لكن تعذّر تحليلها بـ Florence-2: ${reference.analysisWarning}`
          : "استُخرجت 3 لقطات محليًا. لم يُنزّل Florence-2 بعد؛ الفيديو نفسه لا يُرفع.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تجهيز الفيديو المرجعي.");
    } finally {
      setProcessingVideoReference(false);
    }
  }

  async function analyzeVoiceover(project: string): Promise<AudioAnalysis> {
    const response = await apiFetch(`${API_BASE}/api/motion/audio-analysis/${encodeURIComponent(project)}`);
    const data: unknown = await response.json().catch(() => null);
    const duration = isRecord(data) ? data.duration : undefined;
    const quietSpans = isRecord(data) ? data.quiet_spans : undefined;
    const audioDuration = duration === null
      ? null
      : typeof duration === "number" && Number.isFinite(duration) ? duration : undefined;
    if (!response.ok || !isRecord(data) || typeof data.has_voiceover !== "boolean" ||
      !Array.isArray(quietSpans) || audioDuration === undefined) {
      throw new Error(isRecord(data) && typeof data.detail === "string"
        ? data.detail
        : "تعذر تحليل توقيت الفويس أوفر محليًا.");
    }
    return {
      has_voiceover: data.has_voiceover,
      duration: audioDuration,
      quiet_spans: quietSpans.filter((span): span is { start: number; end: number } =>
        isRecord(span) && typeof span.start === "number" && Number.isFinite(span.start) &&
        typeof span.end === "number" && Number.isFinite(span.end) && span.end > span.start),
    };
  }

  async function searchImages() {
    const query = imageQuery.trim();
    if (query.length < 2 || searchingImages) return;
    setSearchingImages(true);
    setError("");
    try {
      const assets = await searchImageAssets(query);
      setImageAssets(assets);
      if (!assets.length) setNotice("لم يُعثر على صور؛ جرّب عبارة بحث أخرى.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر البحث عن الصور.");
    } finally {
      setSearchingImages(false);
    }
  }

  async function openExistingProject() {
    if (openingEditor) return;
    setOpeningEditor(true);
    setError("");
    try {
      if (!projectId) {
        if (savedProject) await openSavedProject();
        else await openNewProject(voiceover?.duration ?? 30);
      } else if (editorMode === "outside") {
        const tab = window.open(editorUrl, "_blank");
        if (tab) tab.opener = null;
        else setNotice("اسمح بالنوافذ المنبثقة لفتح OpenFilm في تبويب مستقل.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر فتح OpenFilm.");
    } finally {
      setOpeningEditor(false);
    }
  }

  async function repairMissingImages() {
    if (!projectId || repairingImages) return;
    setRepairingImages(true);
    setError("");
    setNotice("يفحص OpenFilm الصور المفقودة ويبحث عن بدائل مرخّصة...");
    try {
      const response = await apiFetch(`${API_BASE}/api/motion/repair-images/${encodeURIComponent(projectId)}`, { method: "POST" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(isRecord(data) && typeof data.detail === "string" ? data.detail : "تعذر إصلاح صور مشروع OpenFilm.");
      }
      const report = getImageRepairReport(data);
      setNotice(imageRepairNotice(report, "تم فحص صور المشروع؛ يعرض OpenFilm الآن الملفات المحدّثة."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إصلاح صور مشروع OpenFilm.");
      setNotice("");
    } finally {
      setRepairingImages(false);
    }
  }

  async function generate(editInstruction?: string, continuation?: PendingContinuation) {
    const brief = editInstruction?.trim() || topic.trim();
    if ((!continuation && !providerId) || (!continuation && !brief) || generating) return;
    setGenerating(true);
    setError("");
    setNotice("");
    if (!continuation) {
      setAiResponses([]);
      setCombinedReply("");
      setPendingContinuation(null);
    } else if (continuation.repairPrompt && !continuation.repairing) {
      setCombinedReply("");
    }

    let attempt = continuation?.attempt ?? 0;
    let fullReply = continuation?.repairPrompt && !continuation.repairing ? "" : continuation?.reply ?? "";
    let attemptReply = "";
    let locallyRepairable = false;
    if (continuation?.repairPrompt && !continuation.repairing) {
      try {
        parseW2MProject(continuation.reply);
        fullReply = continuation.reply;
        locallyRepairable = true;
      } catch {
        // Keep the compiler-guided provider repair for programs that remain invalid.
      }
    }
    const requestProviderId = continuation?.providerId ?? providerId;
    let activeProjectId = projectId;
    let message = continuation?.repairPrompt ?? continuation?.message ?? "";
    let repairPrompt = continuation?.repairPrompt;
    let compileFailure: string | null = null;
    const attachReferenceFrames = providerImageSupport !== "no";
    let requestImages = continuation?.images ?? (
      videoReference && attachReferenceFrames ? videoReference.frames : []
    );
    const updateLog = (number: number, patch: Partial<AiResponseLog>) => {
      setAiResponses((current) => current.map((entry) => entry.attempt === number ? { ...entry, ...patch } : entry));
    };

    try {
      setProgress("يفتح مشروع OpenFilm الحقيقي ويقرأ نسخته الحالية...");
      if (videoReference && providerImageSupport === "no" && !videoReference.visualDescriptions.length) {
        throw new Error("هذا المزوّد لا يدعم الصور، كما أن Florence-2 المحلي لم يُحلّل الفيديو. نزّل نموذج Florence-2 من استوديو التصميم ثم أعد إرفاق الفيديو.");
      }
      if (!activeProjectId) {
        const opened = await openNewProject(voiceover?.duration ?? 30);
        activeProjectId = opened.projectId;
      }
      const requestProject = await fetchProject(activeProjectId);
      setProject(requestProject);
      setProgress("يحلل مستوى صوت الفويس أوفر محليًا لتحديد الفواصل الهادئة...");
      const audioAnalysis = await analyzeVoiceover(activeProjectId);
      message = continuation?.repairPrompt ?? continuation?.message ?? projectPrompt(
        editInstruction?.trim() || topic.trim(),
        project ? requestProject : null,
        imageAssets,
        voiceover?.duration,
        audioAnalysis,
        videoReference ?? undefined,
        attachReferenceFrames,
      );
      if (!continuation) fullReply = "";

      while (!locallyRepairable) {
        attempt += 1;
        attemptReply = "";
        setAiResponses((current) => [...current, { attempt, status: "يحرر صفحات OpenFilm...", reply: "" }]);
        const prompt = fullReply
          ? `Continue this exact W2M/2 document from its last character. Return only the missing suffix; do not repeat its header, restart the project, or duplicate existing HTML. Finish every block and end with END PROJECT followed by END W2M.\n\n${fullReply}`
          : message;
        setProgress(attempt === 1
          ? repairPrompt ? "الذكاء الاصطناعي يصلح أخطاء W2M وفق التشخيص..." : "الذكاء الاصطناعي يبني صفحات المشاهد الأصلية داخل مشروع OpenFilm..."
          : repairPrompt ? "الذكاء الاصطناعي يكمل إصلاح صيغة W2M..." : "الذكاء الاصطناعي يكمل حزمة المشروع من موضع التوقف...");
        const controller = new AbortController();
        const sendPrompt = (messageText: string, images: string[]) => apiFetch(`${API_BASE}/api/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            provider_id: requestProviderId,
            message: messageText,
            images,
            system_prompt: `You are a senior motion-graphics director and OpenFilm project editor. Treat W2M/2 as a strict programming language with a fixed grammar. ${requestImages.length
              ? "Study attached reference frames as visual direction, not content to copy."
              : "Use any local Florence-2 frame descriptions in the message as visual direction."} Create original, highly art-directed scenes directly in the supplied OpenFilm project, follow its timeline and window.film.frame(t) protocol exactly, use local low-volume voiceover timing notes to pace visual beats, and return only a complete W2M/2 program. If asked to repair compiler diagnostics, fix every listed diagnostic and return the entire corrected program, not a patch or explanation.`,
            temperature: 0.7,
            max_tokens: 12000,
          }),
        });
        let response = await sendPrompt(prompt, requestImages);
        if (!response.ok && requestImages.length && videoReference?.visualDescriptions.length &&
          [400, 415, 422].includes(response.status)) {
          const firstFailure = await response.text();
          const fallbackContext = `The provider rejected image input. Use only these Florence-2 descriptions generated locally; no image data is attached:\n${videoReference.visualDescriptions.join("\n")}`;
          requestImages = [];
          message = `${message}\n\n${fallbackContext}`;
          setNotice("لم يقبل المزوّد صور الفيديو؛ أُعيد الطلب باستخدام أوصاف Florence-2 المحلية فقط.");
          response = await sendPrompt(`${prompt}\n\n${fallbackContext}`, requestImages);
          if (!response.ok || !response.body) {
            const detail = await response.text();
            throw new Error(`تعذر الاتصال بمزوّد AI (${response.status}): ${detail.slice(0, 500)}. الرد الأول: ${firstFailure.slice(0, 240)}`);
          }
        }
        if (!response.ok || !response.body) {
          const detail = await response.text();
          throw new Error(`تعذر الاتصال بمزوّد AI (${response.status}): ${detail.slice(0, 500)}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let doneEvent = false;
        let timedOut = false;
        let finishReason = "";
        while (!doneEvent) {
          let timeout = 0;
          let next: { kind: "read"; result: ReadableStreamReadResult<Uint8Array> } | { kind: "idle" };
          try {
            next = await Promise.race([
              reader.read().then((result) => ({ kind: "read" as const, result })),
              new Promise<{ kind: "idle" }>((resolve) => {
                timeout = window.setTimeout(() => resolve({ kind: "idle" }), AI_IDLE_TIMEOUT_MS);
              }),
            ]);
          } finally {
            window.clearTimeout(timeout);
          }
          if (next.kind === "idle") {
            timedOut = true;
            await reader.cancel();
            controller.abort();
            break;
          }
          const { value, done } = next.result;
          buffer += decoder.decode(value, { stream: !done });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const event: unknown = JSON.parse(dataLine.slice(5).trim());
            if (!isRecord(event)) continue;
            if (event.type === "delta" && typeof event.text === "string") {
              attemptReply += event.text;
              fullReply += event.text;
              setCombinedReply(fullReply);
              setAiResponses((current) => current.map((item) =>
                item.attempt === attempt ? { ...item, status: "يكتب ملفات OpenFilm", reply: attemptReply } : item));
            } else if (event.type === "finish" && typeof event.reason === "string") {
              finishReason = event.reason;
            } else if (event.type === "error") {
              throw new Error(typeof event.message === "string" ? event.message : "توقف مزوّد AI عن تحرير المشروع.");
            } else if (event.type === "done") {
              doneEvent = true;
            }
          }
          if (done) doneEvent = true;
        }
        reader.releaseLock();

        const attemptHasCompleteBundle = (() => {
          try { parseW2MProject(attemptReply); return true; } catch { return false; }
        })();
        if (attemptHasCompleteBundle) {
          fullReply = attemptReply;
          setCombinedReply(fullReply);
        }
        if (timedOut || finishReason === "length" || !doneEvent) {
          if (!fullReply.trim()) throw new Error("لم يصل محتوى من المزوّد؛ تحقق من اتصاله ثم حاول مرة أخرى.");
          throw new Error("توقف رد AI قبل اكتمال ملفات OpenFilm. اضغط «أكمل» لمتابعة الحزمة المحفوظة.");
        }
        try {
          parseW2MProject(fullReply);
        } catch (reason) {
          compileFailure = reason instanceof Error ? reason.message : "تعذر ترجمة برنامج W2M.";
          if (!continuation?.repairPrompt && attempt === 1) {
            repairPrompt = `The complete W2M/2 source below failed compilation. Repair every error and return the entire corrected W2M/2 program only. Preserve the intended project and all valid content. Do not explain.\n\nCOMPILER DIAGNOSTICS:\n${compileFailure}\n\nSOURCE TO REPAIR:\n${fullReply}`;
            message = repairPrompt;
            fullReply = "";
            setError("");
            continue;
          }
          throw reason;
        }
        break;
      }

      setProgress("يتحقق من ملفات المشروع ثم يحدّثها مباشرة في OpenFilm...");
      let nextProject: OpenFilmProject;
      try {
        nextProject = parseW2MProject(fullReply);
      } catch (reason) {
        compileFailure = reason instanceof Error ? reason.message : "تعذر ترجمة برنامج W2M.";
        throw reason;
      }
      if (!activeProjectId) throw new Error("لم يتم فتح مشروع OpenFilm لاستقبال التعديلات.");
      const imageReport = await saveOpenFilmProject(activeProjectId, nextProject);
      setProject(nextProject);
      setPendingContinuation(null);
      setDesignEditPrompt("");
      setNotice(imageRepairNotice(imageReport, "تم تعديل ملفات المشروع المفتوح؛ OpenFilm يعرض التغييرات مباشرة ويمكنك متابعة التحرير على الـTimeline."));
      try {
        const safeName = sanitizeArtifactFilename(nextProject.title, "openfilm-project");
        const delivery = await deliverArtifactToTelegram("motion", `${safeName}.w2m`, formatW2MProject(nextProject), "text/plain;charset=utf-8");
        if (delivery.available) setNotice((current) => `${current}${delivery.delivered
          ? " تم إرسال ملف مشروع W2M/2 إلى بوت تيليجرام."
          : ` ${delivery.reason ?? "لم يُرسل الملف إلى تيليجرام."}`}`);
      } catch (reason) {
        setError(`تم تحديث مشروع OpenFilm لكن تعذر إرسال الملف إلى تيليجرام: ${reason instanceof Error ? reason.message : "خطأ غير معروف."}`);
      }
      updateLog(attempt, { status: "تم تحديث مشروع OpenFilm بنجاح" });
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "تعذر تحرير مشروع OpenFilm.";
      setError(detail);
      if (fullReply.trim() || repairPrompt) {
        if (compileFailure) {
          repairPrompt = `The complete W2M/2 source below failed compilation. Repair every error and return the entire corrected W2M/2 program only. Preserve the intended project and all valid content. Do not explain.\n\nCOMPILER DIAGNOSTICS:\n${compileFailure}\n\nSOURCE TO REPAIR:\n${fullReply}`;
          setPendingContinuation({
            providerId: requestProviderId,
            message,
            reply: fullReply,
            attempt,
            images: requestImages,
            repairPrompt,
            repairing: false,
          });
          updateLog(attempt, { status: "أخطاء ترجمة؛ يمكن إصلاح W2M", error: detail });
        } else {
          setPendingContinuation({
            providerId: requestProviderId,
            message,
            reply: fullReply,
            attempt,
            images: requestImages,
            repairPrompt,
            repairing: Boolean(repairPrompt && attemptReply.trim()),
          });
          updateLog(attempt, { status: "متوقف؛ المشروع محفوظ للمتابعة", error: detail });
        }
      } else if (attempt > 0) {
        updateLog(attempt, { status: "فشل الطلب", error: detail });
      }
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }

  return (
    <section className="motion-studio" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="motion-heading">
        <div className="motion-icon"><Clapperboard size={22} /></div>
        <div>
          <span>{translate("استوديو إنشاء الفيديو", language)}</span>
          <h2>OPENFILM-AI TASKFLOW EDITION</h2>
          <p>{translate("OpenFilm هو المحرر الوحيد. الذكاء الاصطناعي ينشئ ويعدّل ملفات مشروعه المفتوح مباشرة؛ لا يوجد محرك معاينة أو Timeline بديل.", language)}</p>
        </div>
      </header>

      <div className="motion-workspace">
        <aside className="motion-controls">
          <label><span>{translate("مزوّد الذكاء الاصطناعي", language)}</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={generating || Boolean(pendingContinuation)}>
              <option value="">{translate("اختر مزوّدًا", language)}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
            </select>
          </label>
          <label><span>{project ? translate("طلب تعديل المشروع المفتوح", language) : translate("فكرة الفيلم", language)}</span>
            <textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={5}
              placeholder={translate("صف الفكرة والجمهور والأسلوب البصري. سيبني AI مشاهد HTML أصلية قابلة للتحرير في OpenFilm.", language)} />
          </label>
          <label className="motion-video-upload">
            {processingVideoReference ? <LoaderCircle className="motion-spin" size={17} /> : <Video size={17} />}
            <span>{processingVideoReference
              ? translate("يستخرج لقطات من الفيديو المرجعي...", language)
              : videoReference
                ? translate(`${videoReference.fileName} · 3 لقطات مرجعية`, language)
                : translate("إرفاق فيديو مرجعي للأسلوب البصري (اختياري)", language)}</span>
            <input type="file" accept="video/*" disabled={generating || processingVideoReference || Boolean(pendingContinuation)}
              onChange={(event) => void loadVideoReference(event.target.files?.[0])} />
          </label>
          {videoReference && <small className="motion-reference-note">
            {providerImageSupport === "no"
              ? translate("هذا المزوّد لا يقبل الصور؛ يُرسل إليه وصف Florence-2 المستخرج محليًا فقط. لا يُرفع الفيديو.", language)
              : videoReference.visualDescriptions.length
                ? translate("حلّل Florence-2 اللقطات محليًا. لا يُرفع الفيديو؛ تُرسل الصور الثابتة فقط للمزوّد إذا كان يدعمها.", language)
                : translate("لا يُرفع الفيديو الكامل؛ تُرسل اللقطات الثابتة للمزوّد عند دعمه للصور.", language)}
          </small>}
          <div className="motion-assets">
            <div className="motion-assets-heading">
              <strong><ImagePlus size={16} /> {translate("صور مرجعية للمشروع", language)}</strong>
              <small>{translate("ابحث عن أصول يمكن للمزوّد استخدامها داخل صفحات OpenFilm.", language)}</small>
            </div>
            <form className="motion-image-search" onSubmit={(event) => { event.preventDefault(); void searchImages(); }}>
              <input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder={translate("ابحث عن صور...", language)} aria-label={translate("البحث في مكتبة الصور", language)} />
              <button type="submit" disabled={searchingImages || imageQuery.trim().length < 2}>
                {searchingImages ? <LoaderCircle className="motion-spin" size={16} /> : <Search size={16} />}
              </button>
            </form>
            {imageAssets.length > 0 && <div className="motion-image-results">{imageAssets.map((asset) => (
              <article key={asset.id}>
                <img src={`${API_BASE}/api/images/embed?url=${encodeURIComponent(asset.thumbnail)}`} alt="" loading="lazy" />
                <div><strong title={asset.title}>{asset.title}</strong><small>{[asset.credit, asset.license].filter(Boolean).join(" · ")}</small></div>
                <a href={asset.sourceUrl} target="_blank" rel="noreferrer" aria-label={translate("مصدر الصورة", language)}><ExternalLink size={14} /></a>
              </article>
            ))}</div>}
          </div>
          <label className="motion-audio-upload">
            <Upload size={17} />
            <span>{voiceover ? translate(`${voiceover.file.name} · ${voiceover.duration.toFixed(1)} ثانية`, language) : translate("إرفاق فويس أوفر بمسار OpenFilm", language)}</span>
            <input type="file" accept="audio/*" onChange={(event) => void loadVoiceover(event.target.files?.[0])} />
          </label>
          {voiceover && <div className="motion-voiceover"><Headphones size={17} /><span><strong>{voiceover.file.name}</strong><small>{translate("يُحلّل محليًا لاكتشاف فترات الصوت المنخفضة؛ لا يُرسل الصوت إلى مزوّد AI.", language)}</small></span></div>}
          <button className="motion-generate" type="button" onClick={() => void generate()} disabled={!providerId || !topic.trim() || generating || processingVideoReference}>
            {generating ? <LoaderCircle className="motion-spin" /> : <Sparkles size={18} />}
            {generating ? translate("يعدّل المشروع...", language) : project ? translate("أنشئ / عدّل في OpenFilm", language) : translate("ابدأ مشروع OpenFilm بالذكاء الاصطناعي", language)}
          </button>
          {pendingContinuation && <button className="motion-continue" type="button" onClick={() => void generate(undefined, pendingContinuation)} disabled={generating}>
            {generating ? <LoaderCircle className="motion-spin" size={17} /> : <WandSparkles size={17} />}
            {translate(pendingContinuation.repairPrompt && !pendingContinuation.repairing ? "أصلح أخطاء W2M" : "أكمل من موضع التوقف", language)}
          </button>}
          {progress && <div className="motion-generation-progress" role="status">{translate(progress, language)}</div>}
          {error && <div className="motion-error" role="alert">{translate(error, language)}</div>}
        </aside>

        <div className="motion-preview-panel">
          <div className="motion-export-row">
            <label className="motion-editor-mode"><span>{translate("مكان OpenFilm", language)}</span>
              <select value={editorMode} onChange={(event) => setEditorMode(event.target.value === "outside" ? "outside" : "inside")}>
                <option value="inside">{translate("داخل الموقع", language)}</option><option value="outside">{translate("تبويب مستقل", language)}</option>
              </select>
            </label>
            <button type="button" onClick={() => void openExistingProject()} disabled={openingEditor || generating}>
              {openingEditor ? <LoaderCircle className="motion-spin" /> : <ExternalLink size={17} />}
              {openingEditor ? translate("يفتح OpenFilm...", language) : projectId ? translate("افتح OpenFilm", language) : savedProject ? translate(`افتح آخر مشروع: ${savedProject.title}`, language) : translate("أنشئ مشروع OpenFilm فارغًا", language)}
            </button>
            {editorUrl && <a href={editorUrl} target="_blank" rel="noreferrer">{translate("فتح في نافذة مستقلة", language)} <ExternalLink size={14} /></a>}
          </div>
          <div className="motion-preview">
            {editorUrl
              ? <iframe className="motion-openfilm-frame" title="OPENFILM-AI TASKFLOW EDITION" src={editorUrl} allow="clipboard-read; clipboard-write; fullscreen" />
              : <div className="motion-editor-placeholder"><Clapperboard size={42} /><h3>{translate("مشروع OpenFilm سيظهر هنا", language)}</h3><p>{translate("اكتب الفكرة واضغط بدء المشروع؛ سيُفتح المحرر الحقيقي، ثم يكتب AI المشاهد بداخله.", language)}</p></div>}
          </div>
          {projectId && <div className="motion-editor-panel">
            <div><strong>{project?.title ?? translate("مشروع OpenFilm متصل", language)}</strong><span>{translate("المحرر يعرض المشروع من ملفاته الأصلية. أي تعديل من AI ينعكس على الـTimeline والمعاينة.", language)}</span></div>
            <button className="motion-image-repair" type="button" onClick={() => void repairMissingImages()} disabled={repairingImages}>
              {repairingImages ? <LoaderCircle className="motion-spin" size={15} /> : <ImagePlus size={15} />}
              {repairingImages ? translate("يبحث عن الصور المفقودة...", language) : translate("إصلاح الصور المفقودة", language)}
            </button>
            <form className="motion-ai-assistant" onSubmit={(event) => { event.preventDefault(); void generate(designEditPrompt); }}>
              <label htmlFor="motion-design-edit">{translate("اطلب من AI تعديل المشروع الحالي", language)}</label>
              <div>
                <input id="motion-design-edit" value={designEditPrompt} onChange={(event) => setDesignEditPrompt(event.target.value)} placeholder={translate("مثال: غيّر مشهد البداية مع الحفاظ على بقية الفيلم", language)} />
                <button type="submit" disabled={!providerId || !designEditPrompt.trim() || generating}>
                  {generating ? <LoaderCircle className="motion-spin" size={16} /> : <WandSparkles size={16} />} {translate("تعديل داخل OpenFilm", language)}
                </button>
              </div>
            </form>
          </div>}
        </div>
      </div>
      {notice && <div className="motion-notice" role="status">{translate(notice, language)}</div>}
      <details className="motion-ai-log">
        <summary>{translate("سجل تحرير OpenFilm ·", language)} {aiResponses.length} {translate("طلب", language)}</summary>
        <div className="motion-ai-log-content">
          {aiResponses.map((entry) => <article key={entry.attempt}>
            <header><strong>{translate("الطلب", language)} {entry.attempt}</strong><span>{translate(entry.status, language)}</span></header>
            {entry.error && <p className="motion-ai-log-error">{translate(entry.error, language)}</p>}
            <pre dir="ltr">{entry.reply || translate("لم يصل رد بعد.", language)}</pre>
          </article>)}
          {combinedReply && <article><header><strong>{translate("حزمة المشروع المجمّعة", language)}</strong></header><pre dir="ltr">{combinedReply}</pre></article>}
        </div>
      </details>
    </section>
  );
}
