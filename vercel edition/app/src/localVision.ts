
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
  const img = new Image();
  img.src = image;
  await img.decode();

  const canvas = document.createElement("canvas");
  const width = 96;
  const height = Math.max(1, Math.round(width * img.naturalHeight / img.naturalWidth));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("تعذّر تحليل الصورة في المتصفح.");
  context.drawImage(img, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  let red = 0;
  let green = 0;
  let blue = 0;
  let luminance = 0;
  let count = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    red += pixels[i];
    green += pixels[i + 1];
    blue += pixels[i + 2];
    const value = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    luminance += value;
    if (value < 70) dark += 1;
    if (value > 190) bright += 1;
    count += 1;
  }
  const avgRed = red / count;
  const avgGreen = green / count;
  const avgBlue = blue / count;
  const avgLum = luminance / count;

  const palette = avgGreen > avgRed * 1.12 && avgGreen > avgBlue * 1.05
    ? "طبيعة وخضرة"
    : avgBlue > avgRed * 1.12
      ? "مشهد بسمات زرقاء"
      : avgRed > avgGreen * 1.15
        ? "ألوان دافئة ودرجات حمراء"
        : avgLum > 175
          ? "مشهد فاتح وواضح"
          : avgLum < 75
            ? "مشهد داكن أو ليلي"
            : "مشهد متوازن الألوان";
  const detail = dark > count * 0.18
    ? "به مناطق مظللة واضحة"
    : bright > count * 0.25
      ? "وبه مناطق مضيئة"
      : "وبتباين متوسط";

  return `تحليل متصفح مجاني: ${palette}، أبعاد الصورة ${img.naturalWidth}×${img.naturalHeight}${detail}.`;
}
