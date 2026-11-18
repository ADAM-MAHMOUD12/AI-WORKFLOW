import { useEffect, useState } from "react";
import {
  AudioLines,
  Captions,
  Check,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  Mic2,
  Play,
  Sparkles,
  Video,
} from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import { useLanguage } from "./localization";
import { analyzeImageWithFlorence, imageCapability } from "./localVision";
import "./ContentEditingStudio.css";

type Provider = { id: string; name: string; model: string; is_default: boolean };
type ContentType = "short" | "story" | "ad" | "tutorial";
type AspectRatio = "9:16" | "16:9" | "1:1";
type ImageAttachment = { name: string; dataUrl: string };
type SocialPlatform = "YouTube" | "TikTok" | "Instagram";
type VideoReference = {
  id: string;
  title: string;
  url: string;
  embedUrl: string;
  platform: SocialPlatform;
  channel?: string;
  thumbnail?: string;
  license?: string;
  note?: string;
};

const YOUTUBE_API_KEY_STORAGE = "taskflow-youtube-data-api-key-v1";

function socialVideoReference(platform: Exclude<SocialPlatform, "YouTube">, value: string): VideoReference {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("أدخل رابط فيديو صحيحًا من TikTok أو Instagram.");
  }
  if (url.protocol !== "https:") throw new Error("استخدم رابط HTTPS آمنًا.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (platform === "TikTok") {
    const videoId = url.pathname.match(/^\/@[^/]+\/video\/(\d+)/)?.[1] ??
      url.pathname.match(/^\/player\/v1\/(\d+)/)?.[1];
    if (host !== "tiktok.com" || !videoId) {
      throw new Error("رابط TikTok غير صالح؛ استخدم رابط منشور فيديو عام.");
    }
    return {
      id: `tiktok-${videoId}`,
      title: `TikTok · ${videoId}`,
      url: `https://www.tiktok.com/@_/video/${videoId}`,
      embedUrl: `https://www.tiktok.com/player/v1/${videoId}?controls=1&description=1`,
      platform,
    };
  }
  const match = url.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (host !== "instagram.com" || !match) {
    throw new Error("رابط Instagram غير صالح؛ استخدم رابط منشور أو Reel عام.");
  }
  const kind = match[1] === "reels" ? "reel" : match[1];
  const shortcode = match[2];
  return {
    id: `instagram-${shortcode}`,
    title: `Instagram · ${shortcode}`,
    url: `https://www.instagram.com/${kind}/${shortcode}/`,
    embedUrl: `https://www.instagram.com/${kind}/${shortcode}/embed/`,
    platform,
  };
}

function videoReferenceFromUrl(value: string): VideoReference {
  const [rawUrl, ...noteParts] = value.split("|");
  const note = noteParts.join("|").trim().slice(0, 300);
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("رابط الفيديو غير صالح.");
  }
  if (url.protocol !== "https:") throw new Error("استخدم رابط HTTPS آمنًا.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host) || host === "youtu.be") {
    const videoId = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      throw new Error("رابط YouTube غير صالح؛ استخدم رابط فيديو مباشرًا.");
    }
    return {
      id: `youtube-${videoId}`,
      title: `YouTube · ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      platform: "YouTube",
      ...(note ? { note } : {}),
    };
  }
  if (host === "tiktok.com") {
    const reference = socialVideoReference("TikTok", rawUrl);
    return note ? { ...reference, note } : reference;
  }
  if (host === "instagram.com") {
    const reference = socialVideoReference("Instagram", rawUrl);
    return note ? { ...reference, note } : reference;
  }
  throw new Error("الرابط غير مدعوم؛ استخدم YouTube أو TikTok أو Instagram.");
}

const TYPES: Array<{ id: ContentType; label: string; detail: string }> = [
  { id: "short", label: "فيديو قصير", detail: "إيقاع سريع وخطّاف واضح" },
  { id: "story", label: "قصة بصرية", detail: "بداية وتحوّل وخاتمة" },
  { id: "ad", label: "إعلان", detail: "فائدة المنتج ودعوة للفعل" },
  { id: "tutorial", label: "شرح تعليمي", detail: "خطوات مرتّبة وسهلة" },
];

const TYPE_ENGLISH: Record<ContentType, string> = {
  short: "Short video",
  story: "Visual story",
  ad: "Product advertisement",
  tutorial: "Educational tutorial",
};

const COPY: Record<string, string> = {
  "مونتاج المحتوى": "Content editing",
  "من الفكرة إلى تسلسل مشاهد جاهز للتحرير.": "Turn an idea into a sequence of scenes ready to edit.",
  "ما نوع الفيديو الذي تريد إنتاجه؟": "What kind of video are you making?",
  "فيديو قصير": "Short video",
  "قصة بصرية": "Visual story",
  "إعلان": "Advertisement",
  "شرح تعليمي": "Tutorial",
  "إيقاع سريع وخطّاف واضح": "A quick pace and a strong hook",
  "بداية وتحوّل وخاتمة": "A beginning, shift, and ending",
  "فائدة المنتج ودعوة للفعل": "A clear benefit and call to action",
  "خطوات مرتّبة وسهلة": "Clear, ordered steps",
  "المنصّة": "Platform",
  "نسبة العرض": "Aspect ratio",
  "مدة الفيديو": "Video length",
  "ثانية": "seconds",
  "الفكرة والجمهور والرسالة": "Idea, audience, and message",
  "صف الفكرة والجمهور والرسالة الأساسية...": "Describe the idea, audience, and key message...",
  "خيارات الإنتاج": "Production options",
  "ترجمة مرئية": "On-screen captions",
  "تعليق صوتي": "Voice-over",
  "إيقاع موسيقي": "Music pacing",
  "مصادر الفيديو الرسمية": "Official video sources",
  "ابحث في فيديوهات YouTube المرخّصة Creative Commons أو أضف رابطًا عامًا من TikTok وInstagram للمشاهدة والتخطيط.": "Search Creative Commons-licensed YouTube videos or add a public TikTok or Instagram link to preview and plan.",
  "مصدر المقاطع": "Clip source",
  "بحث عن مقطع": "Search for a clip",
  "بحث YouTube يحتاج مفتاح Data API مجانيًا.": "YouTube search requires a free Data API key.",
  "مفتاح YouTube Data API": "YouTube Data API key",
  "ابحث في YouTube CC": "Search YouTube CC",
  "اكتب كلمات البحث أولًا.": "Enter search terms first.",
  "أدخل مفتاح YouTube Data API للبحث.": "Enter a YouTube Data API key to search.",
  "جارٍ البحث في YouTube...": "Searching YouTube...",
  "لا توجد فيديوهات مرخّصة مطابقة.": "No matching licensed videos found.",
  "إضافة للخطة": "Add to plan",
  "تمت الإضافة": "Added",
  "اختر TikTok أو Instagram لإضافة رابط فيديو.": "Select TikTok or Instagram to add a video link.",
  "إزالة المقطع": "Remove clip",
  "معاينة المقطع": "Preview clip",
  "رابط فيديو عام": "Public video URL",
  "أضف رابط TikTok أو Instagram": "Add TikTok or Instagram URL",
  "المقاطع المختارة للخطة": "Video references for the plan",
  "يُعرض الفيديو ضمن مشغّل المنصة الرسمي ولا يُنزّل. عند إنشاء الخطة، يُرسل اسم المقطع ورابطه فقط لمزوّد AI.": "Videos are shown in the platform's official player and are not downloaded. Only the title and link are sent to the AI provider when creating a plan.",
  "100 عملية بحث مجانية يوميًا افتراضيًا. يرسل التطبيق المفتاح مباشرة إلى Google، فقيّده من Google Cloud.": "The default free quota is 100 searches per day. The app sends the key directly to Google; restrict it in Google Cloud.",
  "YouTube API key غير صالح أو غير مفعّل.": "The YouTube API key is invalid or the API is not enabled.",
  "انتهت حصة YouTube المجانية اليومية. حاول بعد إعادة ضبط الحصة أو استخدم رابطًا عامًا.": "The daily free YouTube quota is exhausted. Try after the quota reset or use a public link.",
  "تجاوز البحث حد الاستخدام المؤقت. حاول لاحقًا.": "The search rate limit was reached. Try again later.",
  "تعذّر الوصول إلى YouTube Data API.": "Could not reach the YouTube Data API.",
  "تعذّر حفظ المفتاح محليًا؛ سيتم استخدامه لهذه الجلسة فقط.": "Could not save the key locally; it will be used for this session only.",
  "أدخل رابط فيديو صحيحًا من TikTok أو Instagram.": "Enter a valid TikTok or Instagram video URL.",
  "استخدم رابط HTTPS آمنًا.": "Use a secure HTTPS link.",
  "رابط TikTok غير صالح؛ استخدم رابط منشور فيديو عام.": "Invalid TikTok link; use a public video post URL.",
  "رابط Instagram غير صالح؛ استخدم رابط منشور أو Reel عام.": "Invalid Instagram link; use a public post or Reel URL.",
  "رابط الفيديو غير صالح.": "Invalid video URL.",
  "أغلق المعاينة": "Close preview",
  "رابط YouTube غير صالح؛ استخدم رابط فيديو مباشرًا.": "Invalid YouTube link; use a direct video URL.",
  "الرابط غير مدعوم؛ استخدم YouTube أو TikTok أو Instagram.": "Unsupported link; use YouTube, TikTok, or Instagram.",
  "روابط متعددة للمراجع": "Multiple reference links",
  "الصق رابطًا واحدًا في كل سطر (حتى 20 رابطًا).": "Paste one link per line (up to 20 links).",
  "يمكن إضافة وصف بعد الرابط بهذا الشكل: الرابط | وصف المشهد": "Add an optional clip note after the URL: URL | scene description",
  "أضف الروابط للخطة": "Add links to plan",
  "تمت إضافة {count} روابط. الروابط مراجع فقط ولا يتم تنزيلها.": "Added {count} links. Links are references only and are not downloaded.",
  "تمت إضافة {count} روابط، وتعذّر استخدام {invalid} رابطًا.": "Added {count} links; {invalid} links could not be used.",
  "لم تتم إضافة أي رابط. استخدم روابط عامة صحيحة من المنصات المدعومة.": "No links were added. Use valid public URLs from supported platforms.",
  "وصلت إلى حد 20 مرجع فيديو للخطة.": "The plan supports up to 20 video references.",
  "خدمة البحث والمعاينة لا تنزّل الفيديوهات. استخدم المواد التي تملكها أو لديك إذن باستخدامها، وتحقق من ترخيص كل مقطع قبل إعادة نشره.": "Search and previews do not download videos. Use media you own or are authorized to use, and verify each clip's license before reuse.",
  "صور ومراجع بصرية": "Images and visual references",
  "ارفع حتى 3 صور تملك حق استخدامها (4 ميغابايت للصورة).": "Upload up to 3 images you have rights to use (4 MB each).",
  "اختر صورًا": "Choose images",
  "إزالة الصورة": "Remove image",
  "ستُرسل الصور للمزوّد لدعم الرؤية. إذا لم يدعم الصور، سيحللها Florence-2 محليًا.": "Images are sent to the provider when it supports vision. Otherwise, Florence-2 analyzes them locally.",
  "تم إنشاء خطة المونتاج.": "The edit plan is ready.",
  "لا يوجد صوت Piper محلي لهذه اللغة. نزّل الصوت من استوديو مدرّب المحادثة ثم أعد المحاولة.": "No local Piper voice is installed for this language. Download one from Speaking Trainer and try again.",
  "تعذّر إنشاء التعليق الصوتي المحلي.": "Could not generate local voice-over.",
  "لم يُرجع المزوّد نص التعليق الصوتي بالصيغة المطلوبة. أعد إنشاء الخطة.": "The provider did not return voice-over text in the required format. Regenerate the plan.",
  "جارٍ إنشاء التعليق الصوتي محليًا...": "Generating local voice-over...",
  "تنزيل التعليق الصوتي": "Download voice-over",
  "تعليق صوتي مستقل": "Standalone voice-over",
  "تُستخدم الصور المرفوعة كمراجع للخطة فقط. لإضافة الفيديوهات نفسها، افتح المحرر وأرفق الوسائط التي تملكها.": "Uploaded images are visual references for the plan. To edit video clips, open the editor and attach media you own.",
  "المزوّد": "Provider",
  "اختر مزوّدًا": "Choose a provider",
  "أنشئ النص وخطة المشاهد": "Draft the script and scene plan",
  "جارٍ إعداد خطة الإنتاج...": "Preparing the production plan...",
  "اكتب فكرة الفيديو أولًا.": "Describe the video idea first.",
  "أضف مزوّد AI من قسم المزوّدين أولًا.": "Add an AI provider in AI Providers first.",
  "لم يصل رد نصي من المزوّد.": "The provider returned no text.",
  "خطة المشاهد": "Scene plan",
  "إرسال الخطة إلى استوديو OpenFilm": "Send the plan to OpenFilm Studio",
  "سطر الترجمة": "Caption track",
  "مسار التعليق الصوتي": "Voice-over track",
  "مشاهد مرئية": "Visual scenes",
  "جاهز للمعاينة والتحرير في OpenFilm": "Ready to preview and edit in OpenFilm",
  "اختر الخيارات، ثم أنشئ مخطط المشاهد. OpenFilm يوفر معاينة وتايملاين للمشروع الفعلي.": "Choose your settings and draft a scene plan. OpenFilm provides the actual project preview and timeline.",
  "يساعدك هذا القسم على إعداد خطة مونتاج وتعليق صوتي محلي. لا يجلب فيديوهات من منصات التواصل.": "This section creates an edit plan and local voice-over. It does not fetch videos from social platforms.",
};

function tr(text: string, language: "ar" | "en") {
  return language === "en" ? (COPY[text] ?? text) : text;
}

function ratioForPlatform(platform: string): AspectRatio {
  if (platform === "YouTube") return "16:9";
  if (platform === "Instagram feed") return "1:1";
  return "9:16";
}

export default function ContentEditingStudio() {
  const language = useLanguage();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [contentType, setContentType] = useState<ContentType>("short");
  const [platform, setPlatform] = useState("TikTok");
  const [ratio, setRatio] = useState<AspectRatio>("9:16");
  const [duration, setDuration] = useState(30);
  const [idea, setIdea] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [captions, setCaptions] = useState(true);
  const [voiceover, setVoiceover] = useState(true);
  const [music, setMusic] = useState(false);
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voiceoverUrl, setVoiceoverUrl] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState<SocialPlatform>("YouTube");
  const [youtubeApiKey, setYoutubeApiKey] = useState(() => {
    try {
      return localStorage.getItem(YOUTUBE_API_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });
  const [videoQuery, setVideoQuery] = useState("");
  const [socialVideoUrl, setSocialVideoUrl] = useState("");
  const [bulkVideoUrls, setBulkVideoUrls] = useState("");
  const [videoResults, setVideoResults] = useState<VideoReference[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<VideoReference[]>([]);
  const [previewVideo, setPreviewVideo] = useState<VideoReference | null>(null);
  const [searchingVideos, setSearchingVideos] = useState(false);

  useEffect(() => () => {
    if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl);
  }, [voiceoverUrl]);

  useEffect(() => {
    let active = true;
    apiFetch(`${API_BASE}/api/providers`)
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok || !Array.isArray(result)) throw new Error("تعذّر تحميل المزوّدين.");
        return result.filter((item): item is Provider => item && typeof item.id === "string" &&
          typeof item.name === "string" && typeof item.model === "string");
      })
      .then((items) => {
        if (!active) return;
        setProviders(items);
        setProviderId(items.find((item) => item.is_default)?.id ?? items[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل المزوّدين.");
      });
    return () => { active = false; };
  }, []);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    try {
      if (images.length + files.length > 3) throw new Error("يمكن إرفاق 3 صور كحد أقصى.");
      const selected: ImageAttachment[] = [];
      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("الصيغ المدعومة للصور: JPEG وPNG وWebP.");
        }
        if (file.size > 4 * 1024 * 1024) throw new Error("حجم الصورة الواحدة يجب ألا يتجاوز 4 ميغابايت.");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("تعذّرت قراءة الصورة."));
          reader.onerror = () => reject(new Error("تعذّرت قراءة الصورة."));
          reader.readAsDataURL(file);
        });
        selected.push({ name: file.name, dataUrl });
      }
      setImages((current) => [...current, ...selected]);
      setError("");
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّرت إضافة الصور.");
    }
  }

  async function searchYouTubeVideos() {
    if (!videoQuery.trim()) {
      setError(tr("اكتب كلمات البحث أولًا.", language));
      return;
    }
    if (!youtubeApiKey.trim()) {
      setError(tr("أدخل مفتاح YouTube Data API للبحث.", language));
      return;
    }
    setSearchingVideos(true);
    setError("");
    setNotice("");
    setVideoResults([]);
    try {
      const params = new URLSearchParams({
        part: "snippet",
        q: videoQuery.trim().slice(0, 100),
        type: "video",
        videoLicense: "creativeCommon",
        videoEmbeddable: "true",
        maxResults: "12",
        key: youtubeApiKey.trim(),
      });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
        const apiErrors = apiError && typeof apiError === "object" && "errors" in apiError &&
          Array.isArray(apiError.errors) ? apiError.errors : [];
        const apiErrorReason = apiErrors[0] && typeof apiErrors[0] === "object" &&
          "reason" in apiErrors[0] ? apiErrors[0].reason : "";
        const apiReason = typeof apiErrorReason === "string" ? apiErrorReason : "";
        if (apiReason === "quotaExceeded" || apiReason === "dailyLimitExceeded") {
          throw new Error(tr("انتهت حصة YouTube المجانية اليومية. حاول بعد إعادة ضبط الحصة أو استخدم رابطًا عامًا.", language));
        }
        const apiMessage = apiError && typeof apiError === "object" && "message" in apiError &&
          typeof apiError.message === "string" ? apiError.message : "";
        if (apiReason === "keyInvalid" || apiReason === "accessNotConfigured" ||
          apiMessage.includes("API key not valid")) {
          throw new Error(tr("YouTube API key غير صالح أو غير مفعّل.", language));
        }
        if (response.status === 429) throw new Error(tr("تجاوز البحث حد الاستخدام المؤقت. حاول لاحقًا.", language));
        throw new Error(tr("تعذّر الوصول إلى YouTube Data API.", language));
      }
      if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) {
        throw new Error(tr("تعذّر الوصول إلى YouTube Data API.", language));
      }
      const results = payload.items.flatMap((item): VideoReference[] => {
        if (!item || typeof item !== "object" || !("id" in item) || !item.id ||
          typeof item.id !== "object" || !("videoId" in item.id) || typeof item.id.videoId !== "string" ||
          !("snippet" in item) || !item.snippet || typeof item.snippet !== "object" ||
          !("title" in item.snippet) || typeof item.snippet.title !== "string") return [];
        const videoId = item.id.videoId;
        if (!/^[\w-]{11}$/.test(videoId)) return [];
        const snippet = item.snippet;
        const thumbnail = "thumbnails" in snippet && snippet.thumbnails &&
          typeof snippet.thumbnails === "object" && "medium" in snippet.thumbnails &&
          snippet.thumbnails.medium && typeof snippet.thumbnails.medium === "object" &&
          "url" in snippet.thumbnails.medium && typeof snippet.thumbnails.medium.url === "string"
          ? snippet.thumbnails.medium.url : undefined;
        const channel = "channelTitle" in snippet && typeof snippet.channelTitle === "string"
          ? snippet.channelTitle : undefined;
        return [{
          id: `youtube-${videoId}`,
          title: snippet.title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
          platform: "YouTube",
          ...(channel ? { channel } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          license: "Creative Commons",
        }];
      });
      setVideoResults(results);
      if (results.length === 0) setNotice(tr("لا توجد فيديوهات مرخّصة مطابقة.", language));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("تعذّر الوصول إلى YouTube Data API.", language));
    } finally {
      setSearchingVideos(false);
    }
  }

  function addSocialVideo() {
    if (sourcePlatform === "YouTube") {
      setError(tr("اختر TikTok أو Instagram لإضافة رابط فيديو.", language));
      return;
    }
    try {
      const reference = socialVideoReference(sourcePlatform, socialVideoUrl);
      setSelectedVideos((current) => current.some((item) => item.id === reference.id)
        ? current
        : [...current, reference]);
      setPreviewVideo(reference);
      setSocialVideoUrl("");
      setError("");
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? tr(reason.message, language) : tr("رابط الفيديو غير صالح.", language));
    }
  }

  function addVideoLinks() {
    const links = bulkVideoUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (links.length === 0) {
      setError(tr("لم تتم إضافة أي رابط. استخدم روابط عامة صحيحة من المنصات المدعومة.", language));
      return;
    }
    const accepted: VideoReference[] = [];
    const invalid: string[] = [];
    for (const link of links.slice(0, 20)) {
      try {
        accepted.push(videoReferenceFromUrl(link));
      } catch {
        invalid.push(link);
      }
    }
    const uniqueAccepted = accepted.filter((video, index) =>
      accepted.findIndex((candidate) => candidate.id === video.id) === index);
    const additions = uniqueAccepted.filter((video) => !selectedVideos.some((item) => item.id === video.id));
    const added = additions.slice(0, Math.max(0, 20 - selectedVideos.length));
    setSelectedVideos((current) => {
      const merged = [...current];
      for (const video of added) {
        if (!merged.some((item) => item.id === video.id) && merged.length < 20) merged.push(video);
      }
      return merged;
    });
    if (added.length > 0) setPreviewVideo(added[0]);
    setBulkVideoUrls("");
    setError("");
    const invalidCount = invalid.length + Math.max(0, links.length - 20) + additions.length - added.length;
    if (added.length === 0 && selectedVideos.length >= 20) {
      setNotice(tr("وصلت إلى حد 20 مرجع فيديو للخطة.", language));
    } else if (added.length === 0) {
      setNotice(tr("لم تتم إضافة أي رابط. استخدم روابط عامة صحيحة من المنصات المدعومة.", language));
    } else if (invalidCount > 0) {
      setNotice(tr("تمت إضافة {count} روابط، وتعذّر استخدام {invalid} رابطًا.", language)
        .replace("{count}", String(added.length))
        .replace("{invalid}", String(invalidCount)));
    } else {
      setNotice(tr("تمت إضافة {count} روابط. الروابط مراجع فقط ولا يتم تنزيلها.", language)
        .replace("{count}", String(added.length)));
    }
  }

  function addVideoToPlan(reference: VideoReference) {
    setSelectedVideos((current) => current.some((item) => item.id === reference.id)
      ? current
      : [...current, reference]);
    setPreviewVideo(reference);
    setError("");
  }

  async function generateVoiceover(text: string) {
    const match = /VOICEOVER:\s*([\s\S]*?)\s*END VOICEOVER/i.exec(text);
    if (!match?.[1]?.trim()) {
      setNotice(tr("لم يُرجع المزوّد نص التعليق الصوتي بالصيغة المطلوبة. أعد إنشاء الخطة.", language));
      return;
    }
    setNotice(tr("جارٍ إنشاء التعليق الصوتي محليًا...", language));
    try {
      const response = await apiFetch(`${API_BASE}/api/speech/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, text: match[1].trim().slice(0, 5000) }),
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const detail = result && typeof result === "object" && "detail" in result &&
          typeof result.detail === "string" ? result.detail : tr("تعذّر إنشاء التعليق الصوتي المحلي.", language);
        throw new Error(response.status === 409
          ? tr("لا يوجد صوت Piper محلي لهذه اللغة. نزّل الصوت من استوديو مدرّب المحادثة ثم أعد المحاولة.", language)
          : detail);
      }
      const audio = await response.blob();
      if (audio.type !== "audio/wav" || audio.size === 0) throw new Error(tr("تعذّر إنشاء التعليق الصوتي المحلي.", language));
      setVoiceoverUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(audio);
      });
      setNotice(tr("تم إنشاء خطة المونتاج.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : tr("تعذّر إنشاء التعليق الصوتي المحلي.", language));
    }
  }

  async function createPlan() {
    if (!idea.trim()) {
      setError(tr("اكتب فكرة الفيديو أولًا.", language));
      return;
    }
    if (!providerId) {
      setError(tr("أضف مزوّد AI من قسم المزوّدين أولًا.", language));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setVoiceoverUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    try {
      const selectedType = TYPES.find((item) => item.id === contentType);
      const selectedProvider = providers.find((item) => item.id === providerId);
      if (!selectedProvider) throw new Error(tr("اختر مزوّدًا", language));
      const capability = imageCapability(selectedProvider.model);
      const imageDescriptions = capability === "no"
        ? await Promise.all(images.map(async (image) => ({
          name: image.name,
          description: await analyzeImageWithFlorence(image.dataUrl),
        })))
        : [];
      const videoContext = selectedVideos.length
        ? `\nVideo references from official platform search/embed APIs (preview links only; do not download or imply permission to reuse):\n${selectedVideos.map((video) =>
          `- ${video.title} (${video.platform}${video.license ? `, ${video.license}` : ""}) — ${video.url}${video.channel ? ` — ${video.channel}` : ""}${video.note ? ` — User-provided scene note: ${video.note}` : ""}`).join("\n")}`
        : "";
      const message = `Create a practical footage-first edit decision list, not motion graphics or animated scenes. Type: ${language === "en" ? TYPE_ENGLISH[contentType] : selectedType?.label}. Platform: ${platform}. Aspect ratio: ${ratio}. Target length: ${duration} seconds. On-screen captions: ${captions}. Voice-over: ${voiceover}. Music pacing: ${music}. User's idea and audience: ${idea.trim().slice(0, 4000)}${videoContext}${imageDescriptions.length
        ? `\nUploaded image references analyzed locally with Florence-2 (use as visual references, not source footage):\n${imageDescriptions.map((image) => `${image.name}: ${image.description}`).join("\n")}`
        : ""}`;
      const requestPlan = (imagePayload: string[]) => apiFetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: providerId,
          message,
          images: imagePayload,
          system_prompt: `You are a footage-first documentary/social-video editor. Never turn this request into motion graphics, CSS animation, or AI-generated footage. Return a practical edit decision list that uses only footage/assets the user provides or has legal permission to use; never propose scraping or downloading social-media videos. Respond in ${language === "ar" ? "Arabic" : "English"} with a hook, cut order and approximate in/out times, transition notes, a timed voice-over script, optional captions, and a closing. Put only the spoken narration between the exact markers VOICEOVER: and END VOICEOVER. Keep the full edit within ${duration} seconds at ${ratio}, and do not claim you rendered a video.`,
          temperature: 0.6,
          max_tokens: 3000,
        }),
      });
      let response = await requestPlan(capability === "no" ? [] : images.map((image) => image.dataUrl));
      let result: unknown = await response.json();
      if (!response.ok && images.length > 0 && capability !== "no" &&
        [400, 413, 415, 422].includes(response.status)) {
        const imageDescriptionsFallback = await Promise.all(images.map(async (image) => ({
          name: image.name,
          description: await analyzeImageWithFlorence(image.dataUrl),
        })));
        const fallbackMessage = `${message}\n\nUploaded image references analyzed locally with Florence-2:\n${imageDescriptionsFallback
          .map((image) => `${image.name}: ${image.description}`).join("\n")}`;
        response = await apiFetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider_id: providerId,
            message: fallbackMessage,
            system_prompt: `You are a footage-first social-video editor. Return an edit decision list using only user-provided or legally authorized assets, not motion graphics, animation, or scraped videos. Include cut order, timings, transition notes, captions and voice-over. Put the spoken words between exact VOICEOVER: and END VOICEOVER markers. Respond in ${language === "ar" ? "Arabic" : "English"}.`,
            temperature: 0.6,
            max_tokens: 3000,
          }),
        });
        result = await response.json();
      }
      if (!response.ok) {
        const detail = result && typeof result === "object" && "detail" in result && typeof result.detail === "string"
          ? result.detail : `فشل الطلب (${response.status}).`;
        throw new Error(detail);
      }
      if (!result || typeof result !== "object" || !("reply" in result) || typeof result.reply !== "string" || !result.reply.trim()) {
        throw new Error(tr("لم يصل رد نصي من المزوّد.", language));
      }
      setPlan(result.reply);
      if (voiceover) void generateVoiceover(result.reply);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر إعداد خطة المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-editing-studio" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="content-editing-heading">
        <span className="content-editing-heading-icon"><Clapperboard size={23} /></span>
        <div><h1>{tr("مونتاج المحتوى", language)}</h1><p>{tr("من الفكرة إلى تسلسل مشاهد جاهز للتحرير.", language)}</p></div>
      </header>

      <div className="content-editing-grid">
        <div className="content-editing-form">
          <section className="content-editing-field">
            <h2>{tr("ما نوع الفيديو الذي تريد إنتاجه؟", language)}</h2>
            <div className="content-type-grid">
              {TYPES.map((item) => (
                <button type="button" key={item.id} className={contentType === item.id ? "is-selected" : ""}
                  onClick={() => setContentType(item.id)} aria-pressed={contentType === item.id}>
                  <Film size={16} /><strong>{tr(item.label, language)}</strong><small>{tr(item.detail, language)}</small>
                </button>
              ))}
            </div>
          </section>

          <div className="content-editing-options">
            <label><span>{tr("المنصّة", language)}</span>
              <select value={platform} onChange={(event) => {
                setPlatform(event.target.value);
                setRatio(ratioForPlatform(event.target.value));
              }}>
                <option>TikTok</option><option>Instagram Reels</option><option>Instagram feed</option>
                <option>YouTube Shorts</option><option>YouTube</option><option>Web</option>
              </select>
            </label>
            <label><span>{tr("نسبة العرض", language)}</span>
              <select value={ratio} onChange={(event) => setRatio(event.target.value as AspectRatio)}>
                <option value="9:16">9:16 · Portrait</option><option value="16:9">16:9 · Landscape</option><option value="1:1">1:1 · Square</option>
              </select>
            </label>
            <label className="content-duration"><span>{tr("مدة الفيديو", language)} · {duration} {tr("ثانية", language)}</span>
              <input type="range" min="15" max="90" step="5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
            </label>
          </div>

          <section className="content-editing-platform-media" aria-label={tr("مصادر الفيديو الرسمية", language)}>
            <div className="content-editing-media-heading">
              <span><Video size={16} aria-hidden="true" />{tr("مصادر الفيديو الرسمية", language)}</span>
              <small>{tr("ابحث في فيديوهات YouTube المرخّصة Creative Commons أو أضف رابطًا عامًا من TikTok وInstagram للمشاهدة والتخطيط.", language)}</small>
            </div>
            <label className="content-editing-platform-select">
              <span>{tr("مصدر المقاطع", language)}</span>
              <select value={sourcePlatform} onChange={(event) => {
                setSourcePlatform(event.target.value as SocialPlatform);
                setVideoResults([]);
                setError("");
                setNotice("");
              }}>
                <option value="YouTube">YouTube · Creative Commons</option>
                <option value="TikTok">TikTok · رابط عام</option>
                <option value="Instagram">Instagram · رابط عام</option>
              </select>
            </label>
            {sourcePlatform === "YouTube" ? <>
              <label className="content-editing-platform-key">
                <span>{tr("مفتاح YouTube Data API", language)}</span>
                <input type="password" autoComplete="off" value={youtubeApiKey}
                  onChange={(event) => {
                    setYoutubeApiKey(event.target.value);
                    try {
                      if (event.target.value) localStorage.setItem(YOUTUBE_API_KEY_STORAGE, event.target.value);
                      else localStorage.removeItem(YOUTUBE_API_KEY_STORAGE);
                    } catch {
                      setError(tr("تعذّر حفظ المفتاح محليًا؛ سيتم استخدامه لهذه الجلسة فقط.", language));
                    }
                  }} />
              </label>
              <p className="content-editing-api-note">
                {tr("بحث YouTube يحتاج مفتاح Data API مجانيًا.", language)}{" "}
                <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                  target="_blank" rel="noopener noreferrer">Google Cloud Console</a>
                {" · "}{tr("100 عملية بحث مجانية يوميًا افتراضيًا. يرسل التطبيق المفتاح مباشرة إلى Google، فقيّده من Google Cloud.", language)}
              </p>
              <form className="content-editing-video-search" onSubmit={(event) => {
                event.preventDefault();
                void searchYouTubeVideos();
              }}>
                <input value={videoQuery} maxLength={100} onChange={(event) => setVideoQuery(event.target.value)}
                  placeholder={tr("بحث عن مقطع", language)} aria-label={tr("بحث عن مقطع", language)} />
                <button type="submit" disabled={searchingVideos || !youtubeApiKey.trim()}>
                  {searchingVideos ? <LoaderCircle className="content-editing-spin" size={16} /> : <Sparkles size={16} />}
                  {tr("ابحث في YouTube CC", language)}
                </button>
              </form>
            </> : <form className="content-editing-video-search" onSubmit={(event) => {
              event.preventDefault();
              addSocialVideo();
            }}>
              <input type="url" value={socialVideoUrl} onChange={(event) => setSocialVideoUrl(event.target.value)}
                placeholder={tr("رابط فيديو عام", language)} aria-label={tr("رابط فيديو عام", language)} />
              <button type="submit" disabled={!socialVideoUrl.trim()}>
                <Play size={16} />{tr("أضف رابط TikTok أو Instagram", language)}
              </button>
            </form>}
            <label className="content-editing-bulk-links">
              <span>{tr("روابط متعددة للمراجع", language)}</span>
              <textarea value={bulkVideoUrls} maxLength={8000}
                onChange={(event) => setBulkVideoUrls(event.target.value)}
                placeholder={tr("الصق رابطًا واحدًا في كل سطر (حتى 20 رابطًا).", language)}
                rows={4} />
              <small>{tr("يمكن إضافة وصف بعد الرابط بهذا الشكل: الرابط | وصف المشهد", language)}</small>
            </label>
            <button type="button" className="content-editing-add-links"
              onClick={addVideoLinks} disabled={!bulkVideoUrls.trim()}>
              <Video size={16} aria-hidden="true" />{tr("أضف الروابط للخطة", language)}
            </button>
            {videoResults.length > 0 && <div className="content-editing-video-results">
              {sourcePlatform === "YouTube" && videoResults.map((video) => (
                <article className="content-editing-video-card" key={video.id}>
                  {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
                  <div className="content-editing-video-copy">
                    <strong>{video.title}</strong>
                    <small>{video.channel} · {video.license}</small>
                  </div>
                  <button type="button" disabled={selectedVideos.some((item) => item.id === video.id)}
                    onClick={() => addVideoToPlan(video)}>
                    {selectedVideos.some((item) => item.id === video.id)
                      ? tr("تمت الإضافة", language)
                      : tr("إضافة للخطة", language)}
                  </button>
                  <a href={video.url} target="_blank" rel="noopener noreferrer">YouTube</a>
                </article>
              ))}
            </div>}
            {selectedVideos.length > 0 && <div className="content-editing-selected-videos">
              <strong>{tr("المقاطع المختارة للخطة", language)} ({selectedVideos.length})</strong>
              {selectedVideos.map((video) => (
                <div className="content-editing-selected-video" key={video.id}>
                  <button type="button" onClick={() => setPreviewVideo(video)}>{video.title}</button>
                  <button type="button" aria-label={`${tr("إزالة المقطع", language)} ${video.title}`}
                    onClick={() => {
                      setSelectedVideos((current) => current.filter((item) => item.id !== video.id));
                      setPreviewVideo((current) => current?.id === video.id ? null : current);
                    }}>×</button>
                </div>
              ))}
            </div>}
            {previewVideo && <div className="content-editing-video-preview">
              <div><strong>{previewVideo.platform}: {previewVideo.title}</strong>
                <button type="button" onClick={() => setPreviewVideo(null)} aria-label={tr("أغلق المعاينة", language)}>×</button>
              </div>
              <iframe src={previewVideo.embedUrl} title={`${previewVideo.platform}: ${previewVideo.title}`}
                loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>}
            <p className="content-editing-api-note">{tr("يُعرض الفيديو ضمن مشغّل المنصة الرسمي ولا يُنزّل. عند إنشاء الخطة، يُرسل اسم المقطع ورابطه فقط لمزوّد AI.", language)}</p>
          </section>

          <label className="content-editing-idea"><span>{tr("الفكرة والجمهور والرسالة", language)}</span>
            <textarea value={idea} onChange={(event) => setIdea(event.target.value)} maxLength={4000} rows={5}
              placeholder={tr("صف الفكرة والجمهور والرسالة الأساسية...", language)} />
          </label>

          <section className="content-editing-media" aria-label={tr("صور ومراجع بصرية", language)}>
            <div className="content-editing-media-heading">
              <span><ImagePlus size={16} aria-hidden="true" />{tr("صور ومراجع بصرية", language)}</span>
              <small>{tr("ارفع حتى 3 صور تملك حق استخدامها (4 ميغابايت للصورة).", language)}</small>
            </div>
            <label className="content-editing-image-picker">
              <ImagePlus size={16} aria-hidden="true" />{tr("اختر صورًا", language)}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || images.length >= 3}
                onChange={(event) => {
                  void addImages(event.currentTarget.files);
                  event.currentTarget.value = "";
                }} />
            </label>
            {images.length > 0 && <div className="content-editing-image-list">
              {images.map((image, index) => (
                <div className="content-editing-image-item" key={`${image.name}-${index}`}>
                  <img src={image.dataUrl} alt={image.name} />
                  <span title={image.name}>{image.name}</span>
                  <button type="button" aria-label={`${tr("إزالة الصورة", language)} ${image.name}`}
                    onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
            </div>}
            <p>{tr("ستُرسل الصور للمزوّد لدعم الرؤية. إذا لم يدعم الصور، سيحللها Florence-2 محليًا.", language)}</p>
          </section>

          <fieldset className="content-editing-toggles">
            <legend>{tr("خيارات الإنتاج", language)}</legend>
            <label><Captions size={17} /><span>{tr("ترجمة مرئية", language)}</span><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)} /></label>
            <label><Mic2 size={17} /><span>{tr("تعليق صوتي", language)}</span><input type="checkbox" checked={voiceover} onChange={(event) => setVoiceover(event.target.checked)} /></label>
            <label><AudioLines size={17} /><span>{tr("إيقاع موسيقي", language)}</span><input type="checkbox" checked={music} onChange={(event) => setMusic(event.target.checked)} /></label>
          </fieldset>

          <label className="content-editing-provider">
            <span>{tr("المزوّد", language)}</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              <option value="">{tr("اختر مزوّدًا", language)}</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
            </select>
          </label>

          {error && <p className="content-editing-error" role="alert">{error}</p>}
          <button type="button" className="content-editing-generate" disabled={busy || !idea.trim() || !providerId} onClick={() => void createPlan()}>
            {busy ? <LoaderCircle className="content-editing-spin" size={17} /> : <Sparkles size={17} />}
            {busy ? tr("جارٍ إعداد خطة الإنتاج...", language) : tr("أنشئ النص وخطة المشاهد", language)}
          </button>
        </div>

        <div className="content-editing-output">
          {plan ? <>
            <div className="content-editing-output-header"><h2><Check size={17} />{tr("خطة المشاهد", language)}</h2><span>{ratio} · {duration}s</span></div>
            <div className={`content-editing-storyboard ratio-${ratio.replace(":", "-")}`}>
              <div className="content-editing-track content-track-video"><Video size={15} /><span>{tr("مشاهد مرئية", language)}</span><i /></div>
              {captions && <div className="content-editing-track content-track-captions"><Captions size={15} /><span>{tr("سطر الترجمة", language)}</span><i /></div>}
              {voiceover && <div className="content-editing-track content-track-voice"><Mic2 size={15} /><span>{tr("مسار التعليق الصوتي", language)}</span><i /></div>}
              <div className="content-editing-timeline">{[0, 1, 2, 3].map((item) => <span key={item}>{Math.round(duration * item / 3)}s</span>)}</div>
            </div>
            <div className="content-editing-script"><p>{plan}</p></div>
            <div className="content-editing-openfilm-note"><Play size={15} />{tr("تُستخدم الصور المرفوعة كمراجع للخطة فقط. لإضافة الفيديوهات نفسها، افتح المحرر وأرفق الوسائط التي تملكها.", language)}</div>
            {voiceoverUrl && <a className="content-editing-audio-download" href={voiceoverUrl} download="taskflow-voiceover.wav">
              <Download size={16} />{tr("تنزيل التعليق الصوتي", language)}
            </a>}
          </> : <div className="content-editing-empty">
            <span><Clapperboard size={28} /></span>
            <h2>{tr("خطة الإنتاج ستظهر هنا", language)}</h2>
            <p>{tr("اختر الخيارات، ثم أنشئ مخطط المشاهد. OpenFilm يوفر معاينة وتايملاين للمشروع الفعلي.", language)}</p>
            <div><span><Captions size={14} />{tr("سطر الترجمة", language)}</span><span><AudioLines size={14} />{tr("مسار التعليق الصوتي", language)}</span></div>
          </div>}
          {notice && <p className="content-editing-privacy" role="status">{notice}</p>}
          <p className="content-editing-privacy">{tr("يساعدك هذا القسم على إعداد خطة مونتاج وتعليق صوتي محلي. لا يجلب فيديوهات من منصات التواصل.", language)}</p>
        </div>
      </div>
    </section>
  );
}
