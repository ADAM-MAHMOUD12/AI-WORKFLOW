import { API_BASE, deviceApiFetch as apiFetch } from "./api";

export type ImageCapability = "yes" | "no" | "unknown";

export function imageCapability(model: string): ImageCapability {
  const name = model.toLowerCase().replace(/^models\//, "");
  if (/(?:-tts|transcribe|embedding|native-audio|live|lyria|robotics|deep-research)/i.test(name)) return "no";
  if (/(gpt-4o|gpt-4\.1|gpt-5|gemini-(1\.5|2|2\.5|3|4)|gemma-[34]|claude-(3|4)|qwen[^/]*-vl|qwen-vl|llava|pixtral|ministral-3|llama-3\.2-(11b|90b)-vision|llama-4|molmo|internvl)/i.test(name)) return "yes";
  if (/^(gpt-3\.5|deepseek-(chat|reasoner)|llama-3(?:\.1|\.3)?(?:-|$)|gemma-2(?:-|$)|qwen(?:2(?:\.5)?|3)?(?:-|$))/.test(name)) return "no";
  return "unknown";
}

async function normalizeImage(imageData: string, signal?: AbortSignal): Promise<string> {
  const image = new Image();
  image.src = imageData;
  await image.decode();
  if (signal?.aborted) throw new DOMException("تم إلغاء تحليل الصورة.", "AbortError");
  if (image.naturalWidth > 8192 || image.naturalHeight > 8192) {
    throw new Error("أبعاد الصورة المرجعية أكبر من الحد المدعوم 8192×8192.");
  }

  let scale = Math.min(1, 2048 / image.naturalWidth, 2048 / image.naturalHeight);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("تعذّر تجهيز الصورة للتحليل المحلي.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const normalized = canvas.toDataURL("image/webp", Math.max(0.45, 0.88 - attempt * 0.1));
    if (normalized.length <= 5_500_000) return normalized;
    scale *= 0.75;
  }
  throw new Error("تعذّر ضغط الصورة إلى حجم مناسب للتحليل المحلي.");
}

export async function analyzeImageWithFlorence(
  imageData: string,
  signal?: AbortSignal,
): Promise<string> {
  const image = await normalizeImage(imageData, signal);
  const response = await apiFetch(`${API_BASE}/api/w2m/vision/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ image, mode: "caption" }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const detail = typeof result === "object" && result !== null && "detail" in result &&
      typeof result.detail === "string" ? result.detail : "تعذّر تحليل الصورة باستخدام Florence-2 المحلي.";
    throw new Error(detail);
  }
  if (typeof result !== "object" || result === null || !("caption" in result) ||
    typeof result.caption !== "string" || !result.caption.trim() ||
    !("local_only" in result) || result.local_only !== true) {
    throw new Error("استجابة Florence-2 المحلية غير صالحة.");
  }
  return result.caption.trim();
}
