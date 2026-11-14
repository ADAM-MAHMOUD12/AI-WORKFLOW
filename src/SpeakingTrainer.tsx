import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Download,
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_BASE, apiFetch } from "./api";
import "./SpeakingTrainer.css";

type Provider = {
  id: string;
  name: string;
  kind: "openai_compatible" | "ollama";
  model: string;
  is_default: boolean;
};

type PracticeQuestion = {
  prompt: string;
  cueCard?: string[];
};

function parseGeneratedQuestions(reply: string): PracticeQuestion[] {
  const json = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("لم يرجع المزوّد أسئلة بصيغة صحيحة. حاول مرة أخرى.");
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "questions" in parsed
      ? (parsed as { questions: unknown }).questions
      : null;
  if (!Array.isArray(items)) throw new Error("لم يرجع المزوّد قائمة أسئلة صالحة. حاول مرة أخرى.");

  const questions = items.slice(0, 5).map((item): PracticeQuestion | null => {
    if (!item || typeof item !== "object" || !("prompt" in item) || typeof item.prompt !== "string") return null;
    const prompt = item.prompt.trim();
    if (!prompt || prompt.length > 300) return null;
    const cueCard = "cueCard" in item && Array.isArray(item.cueCard)
      ? item.cueCard.filter((point): point is string => typeof point === "string").map((point) => point.trim()).filter(Boolean).slice(0, 5)
      : undefined;
    return { prompt, ...(cueCard?.length ? { cueCard } : {}) };
  });
  const validQuestions = questions.filter((question): question is PracticeQuestion => question !== null);
  if (!validQuestions.length || validQuestions.length !== questions.length) {
    throw new Error("بعض الأسئلة المولّدة غير مكتملة. حاول مرة أخرى.");
  }
  return validQuestions;
}

type TutorMood = "encouraging" | "playful" | "calm" | "focused";
type AvatarActivity = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "encouraging";
type VoiceLanguage = "ar" | "en";
type VoiceStatus = { id: string; language: string; label: string; installed: boolean; size_bytes: number };
type SpeechEngineStatus = {
  engine: string;
  installed: boolean;
  size_bytes: number;
};

const tutorMoods: Array<{ id: TutorMood; label: string; description: string; instruction: string; greeting: string }> = [
  { id: "encouraging", label: "مشجّع", description: "ودود ويركّز على التقدّم.", instruction: "كن مدربًا مشجعًا ودافئًا، احتفل بما نجح فيه المتعلم، وصغ النقد بلطف.", greeting: "كل محاولة بتقرّبك من هدفك!" },
  { id: "playful", label: "ساخر بلطف", description: "مزاح خفيف من غير إحراج.", instruction: "استخدم دعابة مصرية خفيفة وذكية ولمسة سخرية محببة عند الملاءمة، من دون إهانة المتعلم أو التقليل منه. اجعل التصحيح واضحًا والاحترام حاضرًا دائمًا.", greeting: "يلا نلمّع الإنجليزي ده من غير دراما!" },
  { id: "calm", label: "هادئ", description: "إيقاع هادئ وملاحظات مطمئنة.", instruction: "كن هادئًا ومطمئنًا، استخدم لغة بسيطة ومتزنة، وقدّم خطوة واحدة واضحة في كل مرة.", greeting: "براحتك، خُد وقتك وفكّر." },
  { id: "focused", label: "مدرّب حازم", description: "مباشر ودقيق مع احترام.", instruction: "كن مدربًا حازمًا ومباشرًا، أعطِ ملاحظات دقيقة وعملية، من دون قسوة أو إحباط.", greeting: "جاهز؟ خلّينا نشتغل على إجابة قوية." },
];

const PIPER_VOICES: Record<VoiceLanguage, { label: string; size: string; sample: string }> = {
  ar: { label: "العربية الأردنية · كريم", size: "≈ 60 MB", sample: "أهلًا بك في تدريب المحادثة. خذ نفسًا وابدأ عندما تكون مستعدًا." },
  en: { label: "الإنجليزية البريطانية · Alan", size: "≈ 60 MB", sample: "Welcome to your speaking practice. Take a breath and begin when you are ready." },
};

const practiceParts: Array<{ title: string; description: string; duration: string; questions: PracticeQuestion[] }> = [
  {
    title: "Part 1 · Interview",
    description: "أسئلة قصيرة عن حياتك واهتماماتك اليومية.",
    duration: "4–5 دقائق",
    questions: [
      { prompt: "Do you work or are you a student?" },
      { prompt: "What do you like most about the place where you live?" },
      { prompt: "How do you usually spend your weekends?" },
      { prompt: "Do you enjoy reading? Why or why not?" },
    ],
  },
  {
    title: "Part 2 · Long turn",
    description: "حضّر دقيقة، ثم تحدث لمدة تصل إلى دقيقتين عن الموضوع.",
    duration: "3–4 دقائق",
    questions: [
      { prompt: "Describe a skill you would like to learn.", cueCard: ["what the skill is", "when you first became interested in it", "how you would learn it", "and explain why you want to learn it"] },
      { prompt: "Describe a place you visited that you would like to visit again.", cueCard: ["where it is", "when you went there", "what you did there", "and explain why you would like to visit it again"] },
      { prompt: "Describe a person who has influenced you.", cueCard: ["who this person is", "how you know them", "what they have done", "and explain how they influenced you"] },
    ],
  },
  {
    title: "Part 3 · Discussion",
    description: "ناقش أفكارًا عامة مرتبطة بموضوع الجزء الثاني.",
    duration: "4–5 دقائق",
    questions: [
      { prompt: "Why do some people find it easier to learn new skills than others?" },
      { prompt: "How has technology changed the way people learn?" },
      { prompt: "Should schools focus more on practical skills or academic subjects?" },
      { prompt: "Do you think people will have more free time in the future?" },
    ],
  },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("تعذّر الاتصال بالباكيند. تأكد أن الخادم المحلي يعمل على المنفذ 8000.");
  }

  if (!response.ok) {
    let message = `حدث خطأ (${response.status})`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the fallback error message when the server does not return JSON.
    }
    throw new Error(message);
  }

  return await response.json() as T;
}

export default function SpeakingTrainer({ onOpenProviders }: { onOpenProviders: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [partIndex, setPartIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [generatedQuestions, setGeneratedQuestions] = useState<PracticeQuestion[][]>([[], [], []]);
  const [questionRequest, setQuestionRequest] = useState("");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [mood, setMood] = useState<TutorMood>("encouraging");
  const [avatarActivity, setAvatarActivity] = useState<AvatarActivity>("idle");
  const [voices, setVoices] = useState<Partial<Record<VoiceLanguage, VoiceStatus>>>({});
  const [installingVoice, setInstallingVoice] = useState<VoiceLanguage | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<SpeechEngineStatus | null>(null);
  const [installingTranscription, setInstallingTranscription] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState<VoiceLanguage>("en");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingBaseRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const part = practiceParts[partIndex];
  const currentQuestions = [...part.questions, ...(generatedQuestions[partIndex] ?? [])];
  const question = currentQuestions[questionIndex % currentQuestions.length];
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const selectedMood = tutorMoods.find((item) => item.id === mood) ?? tutorMoods[0];
  const avatarStatus: Record<AvatarActivity, string> = {
    idle: "جاهز للتدريب",
    listening: "بيسمعك",
    transcribing: "بيحوّل كلامك",
    thinking: "بيراجع إجابتك",
    speaking: "بيكلمك",
    encouraging: "مبسوط بتقدمك",
  };

  useEffect(() => {
    let active = true;
    request<Provider[]>("/api/providers")
      .then((items) => {
        if (!active) return;
        setProviders(items);
        setProviderId(items.find((item) => item.is_default)?.id ?? items[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل مزوّدي الذكاء الاصطناعي.");
      })
      .finally(() => {
        if (active) setLoadingProviders(false);
      });
    request<{ voices: Record<VoiceLanguage, VoiceStatus>; transcription: SpeechEngineStatus }>("/api/speech/status")
      .then((result) => {
        if (active) {
          setVoices(result.voices);
          setTranscriptionEngine(result.transcription);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل حالة محرك الصوت المحلي.");
      });

    return () => {
      active = false;
      if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
      if (recorderRef.current) {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (avatarActivity !== "encouraging") return;
    const timer = window.setTimeout(() => setAvatarActivity("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [avatarActivity]);

  async function loadVoiceStatus() {
    const result = await request<{ voices: Record<VoiceLanguage, VoiceStatus>; transcription: SpeechEngineStatus }>("/api/speech/status");
    setVoices(result.voices);
    setTranscriptionEngine(result.transcription);
  }

  async function installTranscriptionModel() {
    if (installingTranscription) return;
    setInstallingTranscription(true);
    setError("");
    try {
      await request<{ installed: boolean }>("/api/speech/transcription/download", { method: "POST" });
      await loadVoiceStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تنزيل نموذج تحويل الكلام المحلي.");
    } finally {
      setInstallingTranscription(false);
    }
  }

  async function installVoice(language: VoiceLanguage) {
    if (installingVoice) return;
    setInstallingVoice(language);
    setError("");
    try {
      await request<{ installed: boolean }>(`/api/speech/voices/${language}/download`, { method: "POST" });
      await loadVoiceStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تنزيل الصوت المحلي.");
    } finally {
      setInstallingVoice(null);
    }
  }

  async function speakText(text: string, language: VoiceLanguage) {
    if (!voices[language]?.installed) {
      setError(`نزّل الصوت المحلي ${language === "ar" ? "العربي" : "الإنجليزي"} أولًا من بطاقة الشخصية.`);
      return;
    }
    stopSpeaking();
    setError("");
    setAvatarActivity("thinking");
    let audio: HTMLAudioElement | null = null;
    try {
      const response = await apiFetch(`${API_BASE}/api/speech/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, text: text.slice(0, 5000) }),
      });
      if (!response.ok) {
        let message = `تعذّر توليد الصوت (${response.status}).`;
        try {
          const body = await response.json() as { detail?: unknown };
          if (typeof body.detail === "string") message = body.detail;
        } catch {
          // Keep the HTTP status message if the backend did not return JSON.
        }
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      audioUrlRef.current = url;
      audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => {
        setSpeaking(true);
        setAvatarActivity("speaking");
      };
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        setSpeaking(false);
        setAvatarActivity("idle");
        URL.revokeObjectURL(url);
        audioUrlRef.current = null;
        audioRef.current = null;
      };
      audio.onerror = () => {
        if (audioRef.current !== audio) return;
        setSpeaking(false);
        setAvatarActivity("idle");
        setError("تعذّر تشغيل ملف الصوت المحلي.");
        URL.revokeObjectURL(url);
        audioUrlRef.current = null;
        audioRef.current = null;
      };
      await audio.play();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (audio && audioRef.current !== audio) return;
      setSpeaking(false);
      setAvatarActivity("idle");
      setError(reason instanceof Error ? reason.message : "تعذّر تشغيل الصوت المحلي.");
    }
  }

  function stopSpeaking() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioRef.current = null;
    audioUrlRef.current = null;
    setSpeaking(false);
    setAvatarActivity("idle");
  }

  function changePart(index: number) {
    stopSpeaking();
    setPartIndex(index);
    setQuestionIndex(0);
    setAnswer("");
    setFeedback("");
    setError("");
  }

  function changeQuestion(direction: number) {
    stopSpeaking();
    setQuestionIndex((current) => (current + direction + currentQuestions.length) % currentQuestions.length);
    setAnswer("");
    setFeedback("");
    setError("");
  }

  async function transcribeRecording(blob: Blob, language: VoiceLanguage) {
    if (!transcriptionEngine?.installed) {
      setError("نزّل نموذج تحويل الكلام المحلي أولًا. لا تُرسل التسجيل لأي خدمة خارجية.");
      setAvatarActivity("idle");
      return;
    }
    if (!blob.size) {
      setError("ما وصلش صوت واضح من الميكروفون. تأكد من اختيار جهاز الإدخال الصحيح ثم جرّب مرة أخرى.");
      setAvatarActivity("idle");
      return;
    }

    setTranscribing(true);
    setAvatarActivity("transcribing");
    const formData = new FormData();
    const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
    formData.append("audio", blob, `speaking-answer.${extension}`);
    formData.append("language", language);
    try {
      const response = await apiFetch(`${API_BASE}/api/speech/transcribe`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        let message = `تعذّر تحويل التسجيل إلى نص (${response.status}).`;
        try {
          const body = await response.json() as { detail?: unknown };
          if (typeof body.detail === "string") message = body.detail;
        } catch {
          // Keep the HTTP status message when the backend returned no JSON.
        }
        throw new Error(message);
      }
      const result = await response.json() as { text: string };
      if (!result.text.trim()) {
        setError("ما التقطتش كلمات واضحة. قرّب من الميكروفون وتحدث بصوت أعلى، ثم حاول مجددًا.");
        setAvatarActivity("idle");
        return;
      }
      const prefix = recordingBaseRef.current.trim();
      setAnswer([prefix, result.text.trim()].filter(Boolean).join(" "));
      setError("");
      setAvatarActivity("encouraging");
    } catch (reason) {
      setAvatarActivity("idle");
      setError(reason instanceof Error
        ? `تعذّر تفريغ التسجيل محليًا: ${reason.message}`
        : "تعذّر تفريغ التسجيل محليًا. تأكد أن الخادم يعمل ثم أعد المحاولة.");
    } finally {
      setTranscribing(false);
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setRecording(false);
      setAvatarActivity("idle");
    }
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording();
      return;
    }
    if (transcribing || installingTranscription || requestingMicrophone) return;
    if (!transcriptionEngine?.installed) {
      setError("حمّل نموذج Whisper المحلي من بطاقة المدرّب أولًا؛ حجمه نحو 145 ميغابايت.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("تسجيل الصوت غير متاح في هذا المتصفح. افتح التطبيق على localhost أو استخدم متصفحًا أحدث.");
      return;
    }

    setError("");
    setFeedback("");
    recordingBaseRef.current = answer.trim();
    setRequestingMicrophone(true);
    setAvatarActivity("thinking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      recordingStreamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        void transcribeRecording(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), speechLanguage);
      };
      recorder.onerror = () => {
        setError("حصلت مشكلة في تسجيل الصوت. افحص الميكروفون وأغلق أي تطبيق آخر يستخدمه.");
        setAvatarActivity("idle");
      };
      recorder.start();
      setRecording(true);
      setAvatarActivity("listening");
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current !== recorder) return;
        setError("أوقفت التسجيل بعد دقيقتين لحماية الذاكرة؛ أكمِل إجابتك في تسجيل آخر.");
        stopRecording();
      }, 120_000);
    } catch (reason) {
      setRecording(false);
      setAvatarActivity("idle");
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      const name = reason instanceof DOMException ? reason.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح، ثم اضغط «أجب بصوتك» مجددًا."
        : name === "NotFoundError"
          ? "لم أجد ميكروفونًا متصلًا. وصّل ميكروفونًا أو اختر جهاز إدخال متاحًا."
          : name === "NotReadableError"
            ? "الميكروفون مستخدم من تطبيق آخر أو تعذّر فتحه. أغلق التطبيق الآخر وحاول مجددًا."
            : reason instanceof Error ? reason.message : "تعذّر بدء تسجيل الصوت.");
    } finally {
      setRequestingMicrophone(false);
    }
  }

  function readQuestion() {
    if (speaking) stopSpeaking();
    else void speakText(question.prompt, "en");
  }

  async function generateQuestions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topic = questionRequest.trim();
    if (!topic || generatingQuestions) return;
    if (!providerId) {
      setError("أضف مزوّد ذكاء اصطناعي من إعدادات «مزوّدو AI» لتوليد أسئلة جديدة.");
      return;
    }

    const targetPartIndex = partIndex;
    const targetPart = practiceParts[targetPartIndex];
    const existingQuestions = generatedQuestions[targetPartIndex] ?? [];
    setGeneratingQuestions(true);
    setError("");
    setAvatarActivity("thinking");
    try {
      const result = await request<{ reply: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          message: `أنشئ 3 أسئلة جديدة وغير مكررة لتدريب IELTS Speaking في ${targetPart.title}. طلب المستخدم أو الموضوع: ${topic}\nالأسئلة الثابتة الموجودة لتجنب تكرارها: ${targetPart.questions.map((item) => item.prompt).concat(existingQuestions.map((item) => item.prompt)).join(" | ")}\nاكتب نص الأسئلة ونقاط بطاقة المهمة بالإنجليزية. في Part 2 اجعل كل عنصر بطاقة مهمة cueCard تضم 3 إلى 5 نقاط إرشادية. في الأجزاء الأخرى لا تضف cueCard. أعد JSON فقط بهذا الشكل: {"questions":[{"prompt":"...","cueCard":["..."]}]}.`,
          system_prompt: "أنت كاتب أسئلة تدريبية لاختبار IELTS Speaking. اتبع طلب المستخدم، اكتب أسئلة طبيعية مناسبة للجزء المحدد، ولا تكرر الأسئلة الموجودة. أخرج JSON صالحًا فقط بلا Markdown أو شرح. لكل سؤال استخدم prompt كنص، وأضف cueCard كمصفوفة نصوص في Part 2 فقط.",
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });
      const questions = parseGeneratedQuestions(result.reply);
      setGeneratedQuestions((current) => current.map((items, index) => index === targetPartIndex ? [...items, ...questions] : items));
      if (partIndex === targetPartIndex) {
        setQuestionIndex(targetPart.questions.length + existingQuestions.length);
        setAnswer("");
        setFeedback("");
      }
      setQuestionRequest("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر توليد أسئلة جديدة.");
    } finally {
      setGeneratingQuestions(false);
      setAvatarActivity((current) => current === "thinking" ? "idle" : current);
    }
  }

  async function speakFeedback() {
    if (preparingSpeech || speaking) return;
    if (!providerId) {
      setError("اختر مزوّد ذكاء اصطناعي لتشكيل النص قبل تحويله إلى صوت.");
      return;
    }

    const plainText = feedback
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/[*_~`]/g, "")
      .trim()
      .slice(0, 5000);
    setPreparingSpeech(true);
    setError("");
    setAvatarActivity("thinking");
    try {
      const result = await request<{ reply: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          message: `شكّل النص العربي التالي تشكيلًا كاملًا مناسبًا للنطق الطبيعي. أعد النص نفسه فقط دون تغيير معناه أو تلخيصه أو إضافة أي شرح. ضع الحركات على الكلمات العربية، واترك الكلمات الإنجليزية كما هي. النص:\n${plainText}`,
          system_prompt: "أنت مساعد متخصص في التشكيل العربي للنصوص المعدّة للتحويل إلى كلام. أعد النص كاملًا مع التشكيل الواضح لكل الكلمات العربية، وحافظ على ترتيب الكلمات وعلامات الترقيم والكلمات الإنجليزية. لا تضف مقدمة أو Markdown أو تعليقًا.",
          temperature: 0,
          max_tokens: 2400,
        }),
      });
      const vocalizedText = result.reply.trim();
      if (!vocalizedText) throw new Error("عاد المزوّد بنص فارغ بدل النص المشكول.");
      await speakText(vocalizedText, "ar");
    } catch (reason) {
      setAvatarActivity("idle");
      setError(reason instanceof Error ? reason.message : "تعذّر تشكيل ملاحظات المدرّب صوتيًا.");
    } finally {
      setPreparingSpeech(false);
    }
  }

  async function evaluateAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!answer.trim() || evaluating) return;
    if (!providerId) {
      setError("أضف مزوّد ذكاء اصطناعي من إعدادات «مزوّدو AI» لتقييم الإجابة.");
      return;
    }

    setEvaluating(true);
    setError("");
    setFeedback("");
    setAvatarActivity("thinking");
    try {
      const moodInstruction = tutorMoods.find((item) => item.id === mood)?.instruction ?? tutorMoods[0].instruction;
      const result = await request<{ reply: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          message: `قيّم إجابة المتعلم في تدريب IELTS Speaking غير الرسمي. الجزء: ${part.title}. السؤال: ${question.prompt}${question.cueCard ? `\nنقاط بطاقة المهمة: ${question.cueCard.join("; ")}` : ""}\nلغة الإجابة: ${speechLanguage === "en" ? "الإنجليزية" : "العربية"}. إجابة المتعلم:\n${answer.trim()}\n\nاكتب التقييم بالعربية. إذا كانت الإجابة بالعربية، وضّح أنه لا يمكن تقدير مستوى IELTS Speaking من إجابة ليست بالإنجليزية، ولا تمنح نطاقًا رقميًا؛ اقترح ترجمة قصيرة وطبيعية إلى الإنجليزية للتدريب. إذا كانت بالإنجليزية، ابدأ بتقدير تقريبي للنطاق الكلي من 0 إلى 9 مع توضيح أنه تقدير تدريبي غير رسمي وليس نتيجة IELTS حقيقية. قيّم بإيجاز الطلاقة والترابط، المفردات، القواعد، والنطق (قيّم النطق بحذر لأن المتاح نص مفرغ وليس الصوت). اذكر نقطتي قوة، أهم نقطتين للتحسين، ثم مثالًا قصيرًا على صياغة أقوى مع الحفاظ على معنى المتعلم. لا تخترع أخطاء نطق لا تظهر في النص.`,
          system_prompt: `أنت مدرّب محادثة IELTS مستقل ودقيق. قيّم النص وفق معايير IELTS Speaking العامة، ولا تدّع أنك ممتحن رسمي أو أن التقدير نتيجة معتمدة. ${moodInstruction} كن محددًا وبنّاءً، ولا تبالغ في الدرجة.`,
          temperature: 0.3,
          max_tokens: 1200,
        }),
      });
      setFeedback(result.reply);
      setAvatarActivity(speechLanguage === "en" ? "encouraging" : "idle");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تقييم الإجابة.");
    } finally {
      setEvaluating(false);
      setAvatarActivity((current) => current === "thinking" ? "idle" : current);
    }
  }

  function resetAnswer() {
    stopRecording();
    setAnswer("");
    setFeedback("");
    setError("");
    setAvatarActivity("idle");
  }

  return (
    <section className="speaking-trainer">
      <header className="speaking-heading">
        <div>
          <span className="speaking-eyebrow"><Sparkles size={14} /> IELTS PRACTICE STUDIO</span>
          <h2>مدرّب المحادثة الصوتي</h2>
          <p>تدرّب على أجزاء اختبار المحادثة وسجّل إجابتك لتحصل على ملاحظات عملية.</p>
        </div>
        <label className="speaking-provider">
          <span>مزوّد التقييم · راجع تسعيرة مزوّدك</span>
          {loadingProviders ? <span className="speaking-provider-loading"><LoaderCircle size={15} /> جاري التحميل</span> : providers.length ? (
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
            </select>
          ) : <button type="button" className="speaking-link-button" onClick={onOpenProviders}>إعداد مزوّد AI</button>}
        </label>
      </header>

      <div className="speaking-notice"><CircleAlert size={17} /><span>التسجيل والتفريغ يعملان محليًا بعد تنزيل نموذج Whisper (نحو 145 ميغابايت)، بلا خدمة تعرّف صوتي عبر الإنترنت. الصوت التوليدي أيضًا محلي عبر Piper. التقييم وتوليد الأسئلة وتشكيل الملاحظات قبل الاستماع تُرسل إلى المزوّد المختار وقد تترتب عليها رسوم حسب خطتك.</span></div>

      <section className="speaking-avatar-panel" aria-label="شخصية المدرّب">
        <div className={`speaking-avatar mood-${mood} activity-${avatarActivity}`} role="img" aria-label={`${selectedMood.label}، ${avatarActivity === "speaking" ? "يتحدث" : avatarActivity === "listening" ? "يستمع" : avatarActivity === "transcribing" ? "يفرّغ التسجيل" : avatarActivity === "thinking" ? "يفكر" : "مستعد"}`}>
          <span className="speaking-avatar-halo" />
          <svg className="speaking-avatar-face" viewBox="0 0 180 190" aria-hidden="true">
            <path className="speaking-avatar-hair" d="M37 87C31 42 57 17 91 17c37 0 61 25 57 70l-12-15c-10-12-17-25-20-35-16 19-40 29-72 30l-7 20z" />
            <path className="speaking-avatar-neck" d="M72 137h36v24H72z" />
            <path className="speaking-avatar-body" d="M32 188c4-26 24-42 58-42s54 16 58 42z" />
            <path className="speaking-avatar-ear" d="M43 83c-12-5-17 2-14 16 2 9 8 14 16 12m92-28c12-5 17 2 14 16-2 9-8 14-16 12" />
            <path className="speaking-avatar-skin" d="M48 61c0-25 16-40 42-40s42 15 42 40v40c0 25-18 42-42 42s-42-17-42-42z" />
            <path className="speaking-avatar-fringe" d="M44 69C42 37 60 17 91 17c20 0 34 9 43 25-17-7-26-16-29-24-14 17-34 25-59 27z" />
            <path className="speaking-avatar-brow brow-left" d="M62 77c7-5 17-5 23 0" />
            <path className="speaking-avatar-brow brow-right" d="M96 77c7-5 17-5 23 0" />
            <ellipse className="speaking-avatar-eye-white eye-left" cx="74" cy="88" rx="8" ry="6" />
            <ellipse className="speaking-avatar-eye-white eye-right" cx="108" cy="88" rx="8" ry="6" />
            <ellipse className="speaking-avatar-eye eye-left" cx="75" cy="88" rx="4.3" ry="5.2" />
            <ellipse className="speaking-avatar-eye eye-right" cx="107" cy="88" rx="4.3" ry="5.2" />
            <circle className="speaking-avatar-eye-glint" cx="76.5" cy="86" r="1.5" />
            <circle className="speaking-avatar-eye-glint" cx="108.5" cy="86" r="1.5" />
            <path className="speaking-avatar-lash" d="M65 85l-3-2m49 2 3-2" />
            <path className="speaking-avatar-nose" d="M89 91c-2 11-7 19-3 21 3 2 7 2 10 0" />
            <path className="speaking-avatar-mouth mouth-smile" d="M74 121c9 12 23 12 32 0" />
            <path className="speaking-avatar-mouth mouth-smirk" d="M74 123c10 6 22 2 32-4" />
            <path className="speaking-avatar-mouth mouth-neutral" d="M77 124h27" />
            <ellipse className="speaking-avatar-mouth-open" cx="91" cy="126" rx="8" ry="3" />
            <path className="speaking-avatar-blush blush-left" d="M54 108c6-4 12-4 17 0" />
            <path className="speaking-avatar-blush blush-right" d="M105 108c6-4 12-4 17 0" />
          </svg>
          <span className="speaking-avatar-wave wave-one" />
          <span className="speaking-avatar-wave wave-two" />
        </div>
        <div className="speaking-avatar-content">
          <div className="speaking-avatar-title"><div><span className="speaking-eyebrow">مدرّبك الافتراضي</span><h3>سامي <span>·</span> {requestingMicrophone ? "بيجهّز الميكروفون" : avatarStatus[avatarActivity]}</h3></div><span className={`speaking-live-dot ${avatarActivity}`} /></div>
          <p className="speaking-avatar-line">{requestingMicrophone ? "ثواني، بجهّز الميكروفون..." : avatarActivity === "listening" ? "سامعك... خُد راحتك، وأنا مستني." : avatarActivity === "transcribing" ? "لحظة، بحوّل كلامك لنص على جهازك..." : avatarActivity === "thinking" ? "براجع إجابتك عشان أديك ملاحظات دقيقة..." : avatarActivity === "speaking" ? "بشرح لك بصوتي المحلي..." : avatarActivity === "encouraging" ? "عاش! دي خطوة حلوة لقدّام." : selectedMood.greeting}</p>
          <div className="speaking-moods" role="group" aria-label="أسلوب المدرّب">
            {tutorMoods.map((item) => <button type="button" key={item.id} className={mood === item.id ? "active" : ""} title={item.description} aria-pressed={mood === item.id} onClick={() => setMood(item.id)}>{item.label}</button>)}
          </div>
          <div className="speaking-voices">
            {(Object.keys(PIPER_VOICES) as VoiceLanguage[]).map((language) => {
              const voice = voices[language];
              return <div className="speaking-voice-row" key={language}>
                <span><strong>{PIPER_VOICES[language].label}</strong><small>{voice?.installed ? "مثبّت محليًا" : `تنزيل ${PIPER_VOICES[language].size}`}</small></span>
                {voice?.installed
                  ? <button type="button" disabled={speaking} onClick={() => void speakText(PIPER_VOICES[language].sample, language)}><Volume2 size={14} /> تجربة</button>
                  : <button type="button" disabled={installingVoice !== null} onClick={() => void installVoice(language)}>{installingVoice === language ? <><LoaderCircle size={14} className="speaking-spinner" /> تنزيل</> : "تنزيل"}</button>}
              </div>;
            })}
          </div>
          <div className="speaking-transcription">
            <span><strong>تحويل الكلام إلى نص</strong><small>{transcriptionEngine?.installed ? "Whisper محلي · جاهز" : "نموذج محلي · تنزيل لمرة واحدة"}</small></span>
            {transcriptionEngine?.installed
              ? <span className="speaking-ready"><CheckCircle2 size={14} /> جاهز</span>
              : <button type="button" disabled={installingTranscription || !transcriptionEngine} onClick={() => void installTranscriptionModel()}>
                {installingTranscription ? <><LoaderCircle size={14} className="speaking-spinner" /> جارٍ تنزيل النموذج...</> : <><Download size={14} /> تنزيل · نحو 145 MB</>}
              </button>}
          </div>
        </div>
      </section>

      <nav className="speaking-parts" aria-label="أجزاء اختبار المحادثة">
        {practiceParts.map((item, index) => (
          <button type="button" key={item.title} className={index === partIndex ? "active" : ""} onClick={() => changePart(index)}>
            <span>0{index + 1}</span><strong>{item.title.split("·")[1]}</strong><small>{item.duration}</small>
          </button>
        ))}
      </nav>

      <div className="speaking-workspace">
        <main className="speaking-main-card">
          <div className="speaking-card-top">
            <span className="speaking-part-label">{part.title}</span>
            <span className="speaking-time">{part.duration}</span>
          </div>
          <p className="speaking-part-description">{part.description}</p>
          <div className="speaking-question">
            <span>السؤال {questionIndex + 1}</span>
            <h3>{question.prompt}</h3>
            {question.cueCard && <ul>{question.cueCard.map((point) => <li key={point}>{point}</li>)}</ul>}
            <button type="button" className="speaking-read-button" onClick={readQuestion}><Volume2 size={16} /> {speaking ? "إيقاف الصوت" : "استمع للسؤال"}</button>
          </div>

          <form className="speaking-generate-form" onSubmit={generateQuestions}>
            <label htmlFor="speaking-question-request">اطلب أسئلة جديدة من AI</label>
            <div>
              <input
                id="speaking-question-request"
                value={questionRequest}
                onChange={(event) => setQuestionRequest(event.target.value)}
                placeholder="مثال: أسئلة عن السفر والتقنية"
                maxLength={240}
              />
              <button type="submit" disabled={generatingQuestions || !questionRequest.trim() || !selectedProvider}>
                {generatingQuestions ? <><LoaderCircle size={15} className="speaking-spinner" /> جارٍ التوليد...</> : <><Sparkles size={15} /> ولّد أسئلة</>}
              </button>
            </div>
            <small>{generatedQuestions[partIndex]?.length ?? 0} سؤال مضاف لهذا الجزء · تُستخدم خدمة المزوّد المختار</small>
          </form>

          <form onSubmit={evaluateAnswer}>
            <div className="speaking-input-language">
              <span>لغة تسجيل الإجابة</span>
              <div role="group" aria-label="لغة التفريغ الصوتي">
                <button type="button" className={speechLanguage === "en" ? "active" : ""} aria-pressed={speechLanguage === "en"} onClick={() => setSpeechLanguage("en")}>English</button>
                <button type="button" className={speechLanguage === "ar" ? "active" : ""} aria-pressed={speechLanguage === "ar"} onClick={() => setSpeechLanguage("ar")}>العربية</button>
              </div>
            </div>
            <label className="speaking-answer-label" htmlFor="speaking-answer">{speechLanguage === "en" ? "إجابتك بالإنجليزية" : "إجابتك بالعربية"}</label>
            <textarea id="speaking-answer" value={answer} onChange={(event) => { setAnswer(event.target.value); setFeedback(""); }} placeholder={speechLanguage === "en" ? "اكتب إجابتك هنا أو سجّلها..." : "اكتب إجابتك هنا أو سجّلها بالعربية..."} rows={7} />
            <div className="speaking-answer-meta"><span>{answer.trim().split(/\s+/).filter(Boolean).length} كلمة</span><button type="button" className="speaking-reset" onClick={resetAnswer}><RotateCcw size={14} /> مسح الإجابة</button></div>
            <div className="speaking-controls">
              <button type="button" className={`speaking-record ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()} disabled={requestingMicrophone || transcribing || !transcriptionEngine?.installed} aria-pressed={recording}>
                {requestingMicrophone || transcribing ? <LoaderCircle size={17} className="speaking-spinner" /> : <Mic size={17} />} {recording ? "إيقاف التسجيل" : requestingMicrophone ? "جارٍ فتح الميكروفون..." : transcribing ? "جارٍ تفريغ التسجيل..." : "أجب بصوتك"}
              </button>
              <button type="submit" className="speaking-evaluate" disabled={evaluating || !answer.trim() || !selectedProvider}>
                {evaluating ? <><LoaderCircle size={17} className="speaking-spinner" /> جارٍ التقييم...</> : <><Sparkles size={17} /> قيّم إجابتي</>}
              </button>
            </div>
          </form>

          {(error || providers.length === 0 && !loadingProviders) && <div className="speaking-error" role="alert">{error || "لم يتم إعداد مزوّد AI بعد."} {providers.length === 0 && !loadingProviders && <button type="button" onClick={onOpenProviders}>إعداد مزوّد</button>}</div>}
          {feedback && <section className="speaking-feedback" aria-live="polite"><div className="speaking-feedback-heading"><h3><CheckCircle2 size={19} /> ملاحظات المدرّب</h3><button type="button" disabled={speaking || preparingSpeech} onClick={() => void speakFeedback()}>{preparingSpeech ? <LoaderCircle size={15} className="speaking-spinner" /> : <Volume2 size={15} />} {preparingSpeech ? "جارٍ تشكيل النص..." : "استمع للملاحظات مُشكّلة"}</button></div><div className="speaking-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback}</ReactMarkdown></div></section>}

          <div className="speaking-question-nav">
            <button type="button" onClick={() => changeQuestion(-1)}><ArrowRight size={16} /> السؤال السابق</button>
            <button type="button" onClick={() => changeQuestion(1)}>السؤال التالي <ArrowLeft size={16} /></button>
          </div>
        </main>
        <aside className="speaking-side-card">
          <div className="speaking-side-icon"><Play size={18} /></div>
          <h3>طريقة التدريب</h3>
          <ol>
            <li><span>1</span><p>اقرأ السؤال أو استمع إليه.</p></li>
            <li><span>2</span><p>سجّل إجابتك أو اكتبها بالإنجليزية.</p></li>
            <li><span>3</span><p>اطلب التقييم وراجع الملاحظات قبل المحاولة التالية.</p></li>
          </ol>
          <div className="speaking-side-tip"><strong>تذكير</strong><p>هذا تدريب تعليمي غير رسمي. تقدير النطاق تقريبي ولا يحل محل تقييم ممتحن IELTS.</p></div>
        </aside>
      </div>
    </section>
  );
}
