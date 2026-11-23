import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Eye, EyeOff, LoaderCircle, Save, Search, Sparkles, WandSparkles, X } from "lucide-react";
import DocumentAttachments, { documentsAsContext, type TextDocument } from "./DocumentAttachments";
import { API_BASE, deviceApiFetch as apiFetch, deliverArtifactToTelegram, sanitizeArtifactFilename } from "./api";
import "./SVGLogoStudio.css";
import ModelDownloadProgress from "./ModelDownloadProgress";
import { runTrackedDownload, type ModelDownloadStatus } from "./modelDownloads";
import { useLanguage, translate } from "./localization";
import { parseW2MDesign } from "./w2mFormats";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 760;
const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`;
const LOGO_SYSTEM_PROMPT = `You are a professional graphic designer operating the open-source SVG-Edit vector editor. Return one complete W2M/2 DESIGN program only. Grammar:
W2M/2 DESIGN
TITLE "short design title"
ADD rect|circle|ellipse|line|text|path|polygon element-id X number Y number [WIDTH number] [HEIGHT number] [RADIUS number] [X2 number] [Y2 number] [POINTS "x,y ..."] [PATH "SVG path data"] [TEXT "visible text"] [FILL "#RRGGBB"] [STROKE "#RRGGBB"] [STROKE_WIDTH number] [FONT_SIZE number] [FONT "font family"] [TEXT_ANCHOR start|middle|end]
IMAGE exact-asset-id X number Y number WIDTH number HEIGHT number
UPDATE existing-id FILL "#RRGGBB" STROKE "#RRGGBB" STROKE_WIDTH number OPACITY number FONT_SIZE number FONT "font family" TEXT_ANCHOR start|middle|end X number Y number WIDTH number HEIGHT number RADIUS number TEXT "replacement text"
MOVE existing-id DX number DY number
DELETE existing-id
SELECT existing-id
ROTATE existing-id DEGREES number
FRONT existing-id
BACK existing-id
TOOL exact-live-tool-id
ZOOM multiplier
PAN dx dy
END DESIGN
END W2M
Every command is one line. Always write property names, including X and Y (for example: ADD rect box X 20 Y 30 WIDTH 100 HEIGHT 80). For paths, X/Y is the local origin and every PATH coordinate is relative to that origin; keep the path's full bounds within its intended element area. Render every exact name, slogan, and other visible text requested by the user as its own editable text element; never omit requested copy. Use legible font sizes and strong contrast against the background. Quote all text values as JSON strings so punctuation and Arabic are safe. Omit optional properties rather than inventing them. The 1200x760 artboard origin is top-left; rect/image x,y is top-left, circle/ellipse x,y is center, text x,y is baseline. Keep every element fully inside the artboard, use exact shared grid anchors for alignment, balanced margins, deliberate size hierarchy, and non-overlapping text. Use only exact asset IDs from the supplied licensed library. Do not output JSON, Markdown, HTML, SVG source, scripts, external URLs, explanations, or guessed IDs.`;
const NATIVE_TOOL_PROMPT = `The live SVG-Edit catalog and current editable layer inventory are included in the request. Use only exact existing element IDs when updating, moving, rotating, deleting, selecting, or ordering layers. Use only exact listed tool IDs and image asset IDs. Create descriptive unique IDs, plan a consistent grid before placing objects, and use only editable vector primitives and the supplied image assets.`;
type Provider = { id: string; name: string; model: string; is_default: boolean };
type EditorAction = {
  type: "tool" | "add" | "add-svg" | "draw" | "zoom" | "pan" | "update" | "rotate" | "add-image" | "move" | "delete" | "select" | "front" | "back";
  shape?: "rect" | "circle" | "ellipse" | "line" | "text" | "path" | "polygon";
  toolId?: string;
  assetId?: string;
  href?: string;
  angle?: number;
  id?: string;
  target?: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: string;
  path?: string;
  markup?: string;
  factor?: number;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  textAnchor?: "start" | "middle" | "end";
  name?: string;
  dx?: number;
  dy?: number;
  attributes?: Record<string, string | number>;
};
type ImageAsset = { id: string; title: string; thumbnail: string; source: string; license: string; author: string; width: number; height: number; dataUri?: string };
type LocalVisionStatus = { engine: string; installed: boolean; loaded: boolean; runtime_ready: boolean; size_bytes: number; max_size_bytes: number; offline_after_download: boolean };
type LocalVisionRegion = { label: string; box: [number, number, number, number] };
type LocalVisionAnalysis = { engine: string; width: number; height: number; caption: string; objects: LocalVisionRegion[]; text_regions: LocalVisionRegion[]; local_only: boolean };
type SVGHistoryCommand = {
  type: () => string;
  getText: () => string;
  elements: () => Element[];
  apply: (handler: unknown) => void;
  unapply: (handler: unknown) => void;
};
type SVGCanvasApi = {
  getSvgString: () => string;
  getSvgContent: () => SVGSVGElement;
  getSvgRoot: () => SVGSVGElement;
  getZoom: () => number;
  setZoom: (zoom: number, preventUndo?: boolean) => void;
  getSelectedElements: () => SVGElement[];
  getRotationAngle: (element: SVGElement) => number;
  setRotationAngle: (angle: number, preventUndo?: boolean) => void;
  addSVGElementsFromJson: (data: { element: string; attr?: Record<string, string | number>; children?: Array<string | { element: string; attr?: Record<string, string | number> }> }) => SVGElement;
  changeSelectedAttribute: (attribute: string, value: string | number, elements: SVGElement[]) => void;
  selectOnly: (elements: SVGElement[], showGrips?: boolean) => void;
  moveSelectedElements: (dx: number, dy: number, undoable?: boolean) => void;
  deleteSelectedElements: () => void;
  moveToTopSelectedElement: () => void;
  moveToBottomSelectedElement: () => void;
  addCommandToHistory: (command: SVGHistoryCommand) => void;
  call: (event: string, value: SVGElement[]) => void;
  bind: (event: string, handler: (frame: Window, elements: SVGElement[]) => void) => ((frame: Window, elements: SVGElement[]) => void) | undefined;
  history: { InsertElementCommand: new (element: SVGElement, text?: string) => SVGHistoryCommand };
};
type SVGEditorApi = {
  isReady?: boolean;
  ready: (callback: () => void) => Promise<unknown>;
  loadFromString: (markup: string, options?: { noAlert?: boolean }) => Promise<void>;
  leftPanel: { clickSelect: () => void };
  svgCanvas?: SVGCanvasApi;
};
type SVGEditorWindow = Window & { svgEditor?: SVGEditorApi };
type SVGTool = { id: string; title: string; description: string; visible: boolean };
type SVGLogoStudioProps = { initialSvg: string; initialTitle: string; onChange: (svg: string) => void; onTitleChange: (title: string) => void; workspaceName: string };
type UsageSnapshot = { prompt_tokens: number; completion_tokens: number; total_tokens: number; credits: number };

const EDITOR_ACTION_LABELS: Record<string, string> = {
  tool: "أداة",
  add: "إضافة",
  "add-svg": "إضافة SVG",
  "add-image": "إضافة صورة",
  draw: "رسم",
  zoom: "تكبير",
  pan: "تحريك",
  update: "تعديل",
  rotate: "تدوير",
  move: "تحريك",
  delete: "حذف",
  select: "تحديد",
  front: "ترتيب للأمام",
  back: "ترتيب للخلف",
};

function estimateTokens(value: string) {
  return Math.ceil(Array.from(value).length / 3.7);
}

function estimateContextLimit(model: string) {
  const name = model.toLowerCase();
  if (/(gemini-2\.5|gemini-1\.5|gemini-2|claude-3\.7|claude-3\.5|claude-4)/.test(name)) return 1_000_000;
  if (/(gemini|claude)/.test(name)) return 200_000;
  if (/(gpt-4\.1|gpt-4o|gpt-4-turbo|gpt-5|o1|o3|o4)/.test(name)) return 128_000;
  if (/(gpt-4|gpt-3\.5|mistral-large|llama-3\.1|llama-3\.3|qwen|deepseek|mistral)/.test(name)) return 64_000;
  if (/(qwen2\.5|qwen2|llama-3|llama-2|phi)/.test(name)) return 32_000;
  return 32_000;
}

async function readImageDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth > 8192 || image.naturalHeight > 8192) {
      throw new Error("أبعاد الصورة المرجعية أكبر من الحد المدعوم 8192×8192.");
    }
    const scale = Math.min(1, 2048 / image.naturalWidth, 2048 / image.naturalHeight);
    const normalized = document.createElement("canvas");
    normalized.width = Math.max(1, Math.round(image.naturalWidth * scale));
    normalized.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = normalized.getContext("2d");
    if (!context) throw new Error("تعذّر تجهيز الصورة المرجعية للتحليل.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, normalized.width, normalized.height);
    context.drawImage(image, 0, 0, normalized.width, normalized.height);
    return normalized.toDataURL("image/webp", 0.88);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function analyzeWithLocalVision(image: string, mode: "full" | "caption" = "full"): Promise<LocalVisionAnalysis> {
  const response = await apiFetch(`${API_BASE}/api/w2m/vision/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, mode }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const detail = typeof result === "object" && result !== null && "detail" in result &&
      typeof result.detail === "string" ? result.detail : "تعذّر تحليل الصورة محليًا.";
    throw new Error(detail);
  }
  if (typeof result !== "object" || result === null || !("engine" in result) ||
    typeof result.engine !== "string" || !("width" in result) || typeof result.width !== "number" ||
    !("height" in result) || typeof result.height !== "number" || !("caption" in result) ||
    typeof result.caption !== "string" || !("objects" in result) || !Array.isArray(result.objects) ||
    !("text_regions" in result) || !Array.isArray(result.text_regions) ||
    !("local_only" in result) || result.local_only !== true) {
    throw new Error("استجابة Florence-2 المحلية غير صالحة.");
  }
  const regions = (values: unknown[]): LocalVisionRegion[] => values.flatMap((value) => {
    if (typeof value !== "object" || value === null || !("label" in value) ||
      typeof value.label !== "string" || !("box" in value) || !Array.isArray(value.box) ||
      value.box.length !== 4 || !value.box.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) return [];
    const [x1, y1, x2, y2] = value.box;
    return [{ label: value.label, box: [x1, y1, x2, y2] }];
  });
  return {
    engine: result.engine,
    width: result.width,
    height: result.height,
    caption: result.caption,
    objects: regions(result.objects),
    text_regions: regions(result.text_regions),
    local_only: true,
  };
}

async function renderSvgPreview(svg: string): Promise<string> {
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const preview = document.createElement("canvas");
    preview.width = CANVAS_WIDTH;
    preview.height = CANVAS_HEIGHT;
    const context = preview.getContext("2d");
    if (!context) throw new Error("تعذّر تجهيز معاينة التصميم للتحقق البصري.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, preview.width, preview.height);
    context.drawImage(image, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function findLayoutIssues(canvas: SVGCanvasApi): string[] {
  const issues: string[] = [];
  const root = canvas.getSvgContent();
  const rootBounds = root.getBoundingClientRect();
  if (!rootBounds.width || !rootBounds.height) throw new Error("تعذّر قياس مساحة لوحة SVG للتحقق.");
  const graphics = Array.from(root.querySelectorAll<SVGGraphicsElement>(
    "rect,circle,ellipse,line,path,polygon,polyline,image,text",
  )).filter((element) => element.parentElement?.closest("defs") === null);
  const textBoxes: Array<{ id: string; box: { x: number; y: number; width: number; height: number } }> = [];
  for (const element of graphics) {
    const bounds = element.getBoundingClientRect();
    const box = {
      x: (bounds.left - rootBounds.left) * CANVAS_WIDTH / rootBounds.width,
      y: (bounds.top - rootBounds.top) * CANVAS_HEIGHT / rootBounds.height,
      width: bounds.width * CANVAS_WIDTH / rootBounds.width,
      height: bounds.height * CANVAS_HEIGHT / rootBounds.height,
    };
    const id = element.id || element.localName;
    if (box.x < -1 || box.y < -1 || box.x + box.width > CANVAS_WIDTH + 1 || box.y + box.height > CANVAS_HEIGHT + 1) {
      issues.push(`${id} يخرج عن مساحة اللوحة.`);
    }
    if (element.localName === "text" && element.textContent?.trim()) textBoxes.push({ id, box });
  }
  for (let first = 0; first < textBoxes.length; first += 1) {
    for (let second = first + 1; second < textBoxes.length; second += 1) {
      const a = textBoxes[first].box;
      const b = textBoxes[second].box;
      const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const smallerArea = Math.min(a.width * a.height, b.width * b.height);
      if (smallerArea > 0 && intersection / smallerArea > 0.12) {
        issues.push(`النصان ${textBoxes[first].id} و${textBoxes[second].id} متداخلان.`);
      }
    }
  }
  return issues;
}

function findRenderedTextIssues(canvas: SVGCanvasApi, actions: EditorAction[]): string[] {
  const expectedTexts = actions.filter((action) => action.type === "add" && action.shape === "text" && action.text?.trim());
  const renderedTexts = Array.from(canvas.getSvgContent().querySelectorAll<SVGTextElement>("text"));
  const issues: string[] = [];
  for (const action of expectedTexts) {
    const text = action.text?.trim() ?? "";
    const matchingElements = renderedTexts.filter((element) => element.textContent?.trim() === text);
    if (!matchingElements.length) {
      issues.push(`لم يظهر النص المطلوب «${text}» كعنصر SVG قابل للعرض.`);
      continue;
    }
    const visible = matchingElements.some((element) => {
      const bounds = element.getBoundingClientRect();
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style?.display !== "none" &&
        style?.visibility !== "hidden" && Number(style?.opacity ?? 1) > 0 &&
        (style?.fill !== "none" || style?.stroke !== "none");
    });
    if (!visible) issues.push(`النص «${text}» موجود لكنه غير مرئي في اللوحة.`);
  }
  return issues;
}

async function requestW2MProgram(
  providerId: string,
  message: string,
  systemPrompt: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onUsage: (usage: UsageSnapshot) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ provider_id: providerId, message, system_prompt: systemPrompt, temperature: 0.15, max_tokens: 12000 }),
    });
  } catch (reason) {
    if (reason instanceof TypeError) throw new BackendConnectionError();
    throw reason;
  }
  if (!response.ok) {
    const result = await response.json() as { detail?: string };
    throw new Error(result.detail ?? `فشل الطلب (${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("البث غير متاح من الخادم.");
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let finished = false;
  while (!finished) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (reason) {
      if (reason instanceof TypeError && !signal.aborted) throw new BackendConnectionError();
      throw reason;
    }
    finished = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const eventText of events) {
      const dataLine = eventText.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(5).trim()) as { type: string; text?: string; message?: string; usage?: UsageSnapshot };
      if (event.type === "error") throw new Error(event.message ?? "تعذّر توليد الشعار.");
      if (event.type === "done") {
        finished = true;
        continue;
      }
      if (event.type === "usage" && event.usage) onUsage(event.usage);
      if (event.type === "delta" && event.text) {
        reply += event.text;
        onDelta(reply);
      }
    }
  }
  return reply;
}

class BackendConnectionError extends Error {
  constructor() {
    super("تعذّر الوصول إلى خادم AI TaskFlow. شغّل start-all.bat وانتظر رسالة جاهزية الخادم، ثم أعد المحاولة.");
    this.name = "BackendConnectionError";
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function parseW2MDesignProgram(reply: string): { title: string; actions: EditorAction[] } {
  const parsed = parseW2MDesign(reply);
  const attributeNames: Record<string, string> = {
    X: "x", Y: "y", X2: "x2", Y2: "y2", WIDTH: "width", HEIGHT: "height",
    RADIUS: "radius", POINTS: "points", PATH: "path", TEXT: "text", FILL: "fill",
    STROKE: "stroke", STROKE_WIDTH: "strokeWidth", FONT_SIZE: "fontSize", FONT: "fontFamily",
    TEXT_ANCHOR: "textAnchor", DX: "dx", DY: "dy",
  };
  const actions = parsed.actions.map((item): EditorAction => {
    const { type, shape, id, target, toolId, assetId, angle, factor, dx, dy, ...rest } = item;
    const fields: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (key === "TEXT_ANCHOR") {
        if (value !== "start" && value !== "middle" && value !== "end") {
          throw new Error("محاذاة النص يجب أن تكون start أو middle أو end.");
        }
        fields.textAnchor = value;
        continue;
      }
      const normalized = attributeNames[key];
      if (normalized) fields[normalized] = value;
    }
    if (type === "update") {
      const attributes = Object.fromEntries(Object.entries(rest).flatMap(([key, value]) => {
        const names: Record<string, string> = {
          FILL: "fill", STROKE: "stroke", STROKE_WIDTH: "stroke-width", OPACITY: "opacity",
          FONT_SIZE: "font-size", FONT: "font-family", TEXT_ANCHOR: "text-anchor",
          X: "x", Y: "y", WIDTH: "width", HEIGHT: "height", RADIUS: "r", TEXT: "#text",
        };
        return names[key] ? [[names[key], value]] : [];
      }));
      return { type, target: String(target ?? ""), attributes };
    }
    if (type === "add" && ["rect", "circle", "ellipse", "line", "text", "path", "polygon"].includes(String(shape))) {
      return { type, shape: String(shape) as EditorAction["shape"], id: String(id ?? ""), ...fields };
    }
    if (type === "add-image") return { type, assetId: String(assetId ?? ""), ...fields };
    if (type === "move" || type === "delete" || type === "select" || type === "front" || type === "back") {
      return { type, target: String(target ?? ""), dx: Number(dx ?? fields.dx ?? 0), dy: Number(dy ?? fields.dy ?? 0) };
    }
    if (type === "rotate") return { type, target: String(target ?? ""), angle: Number(angle ?? 0) };
    if (type === "tool") return { type, toolId: String(toolId ?? "") };
    if (type === "zoom") return { type, factor: Number(factor ?? 1) };
    if (type === "pan") return { type, dx: Number(dx ?? 0), dy: Number(dy ?? 0) };
    throw new Error("تعذر تحويل أمر W2M إلى إجراء SVG-Edit.");
  });
  return { title: parsed.title, actions };
}

function readAvailableTools(frameDocument: Document | null | undefined): SVGTool[] {
  if (!frameDocument) return [];
  return Array.from(frameDocument.querySelectorAll<HTMLElement>("[id^='tool_']"))
    .map((element) => ({
      id: element.id,
      title: toolLabel(element.id, element.getAttribute("title") || element.getAttribute("aria-label") || ""),
      description: (element.getAttribute("aria-description") || element.getAttribute("data-tooltip") || "").slice(0, 120),
      visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
    }));
}

async function waitForAvailableTools(frameDocument: Document | null | undefined) {
  let tools = readAvailableTools(frameDocument);
  for (let attempt = 0; attempt < 30 && tools.length < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    tools = readAvailableTools(frameDocument);
  }
  return tools;
}

function toolLabel(id: string, upstreamTitle: string) {
  const labels: Record<string, string> = {
    tool_select: "تحديد وتحريك العناصر", tool_zoom: "تكبير اللوحة", tool_fhpath: "فرشاة ومسار حر",
    tool_line: "رسم خط", tool_path: "رسم مسار Bezier", tool_rect: "مستطيل", tool_square: "مربع",
    tool_fhrect: "مستطيل مرسوم يدويًا", tool_ellipse: "شكل بيضاوي", tool_circle: "دائرة",
    tool_fhellipse: "شكل بيضاوي حر", tool_text: "إضافة أو تحرير النص", tool_shapelib: "مكتبة الأشكال",
    tool_image: "إدراج صورة", tool_star: "نجمة", tool_polygon: "مضلع", tool_eyedropper: "قطّارة الألوان",
    tool_connect: "أداة التوصيل", tool_source: "محرر مصدر SVG", tool_wireframe: "عرض الهيكل السلكي",
    tool_layerView: "إظهار الطبقات", tool_undo: "تراجع", tool_redo: "إعادة",
    tool_clone: "استنساخ", tool_delete: "حذف", tool_move_top: "ترتيب للأمام", tool_move_bottom: "ترتيب للخلف",
    tool_topath: "تحويل إلى مسار", tool_reorient: "إعادة توجيه المسار", tool_make_link: "إنشاء رابط",
    tool_flip_h: "قلب أفقي", tool_flip_v: "قلب عمودي", tool_position: "موضع ومحاذاة",
    tool_group_elements: "تجميع العناصر", tool_ungroup: "فك التجميع", tool_clear: "مسح اللوحة",
    tool_open: "فتح ملف", tool_save: "حفظ", tool_save_as: "حفظ باسم", tool_import: "استيراد",
    tool_export: "تصدير", tool_docprops: "خصائص المستند", tool_editor_prefs: "تفضيلات المحرر",
  };
  return labels[id] ?? (upstreamTitle.replace(/^tools\./, "").replace(/[_:]/g, " ").slice(0, 100) || id);
}

const EDITABLE_ATTRIBUTES = new Set([
  "fill", "stroke", "stroke-width", "opacity", "font-size", "font-family", "font-weight",
  "text-anchor", "letter-spacing", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "width", "height", "#text",
]);

function normalizeAttributeName(name: string) {
  if (name === "fontSize") return "font-size";
  if (name === "fontFamily") return "font-family";
  if (name === "strokeWidth") return "stroke-width";
  return name;
}

function validPaint(value: string | number) {
  return typeof value === "string" && (/^#[0-9a-f]{3,8}$/i.test(value) || ["none", "transparent", "currentColor"].includes(value));
}

function serializeWorkspaceSvg(canvas: SVGCanvasApi) {
  const documentClone = canvas.getSvgContent().cloneNode(true) as SVGSVGElement;
  documentClone.removeAttribute("id");
  documentClone.removeAttribute("x");
  documentClone.removeAttribute("y");
  documentClone.removeAttribute("overflow");
  return new XMLSerializer().serializeToString(documentClone);
}

function findArtwork(canvas: SVGCanvasApi, target: string) {
  return Array.from(canvas.getSvgContent().querySelectorAll<SVGElement>("[id]"))
    .find((element) => element.id === target && element.parentElement?.closest("defs") === null) ?? null;
}

function sanitizePath(path: string) {
  return path.length <= 1800 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(path);
}

function sanitizeSvgFragment(markup: string) {
  if (markup.length > 12000) throw new Error("مقطع SVG كبير جدًا.");
  const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("صيغة SVG غير صالحة.");
  const forbidden = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video"]);
  for (const element of Array.from(parsed.querySelectorAll("*"))) {
    const localName = element.localName.toLowerCase();
    if (forbidden.has(localName) || !/^(svg|g|rect|circle|ellipse|line|polyline|polygon|path|text|tspan|defs|lineargradient|radialgradient|stop|clippath|mask|pattern|use|image)$/i.test(localName)) element.remove();
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "style") element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/")) element.removeAttribute(attribute.name);
    }
  }
  return Array.from(parsed.documentElement.children);
}

function metadataText(value: string | undefined) {
  if (!value) return "غير معروف";
  const parsed = new DOMParser().parseFromString(value, "text/html");
  return (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "غير معروف";
}

function inferImageSearchQuery(prompt: string): string | null {
  const text = prompt.toLowerCase();
  if (/logo|شعار|ايقونة|أيقونة|brand mark|emblem|monogram/i.test(text)) return null;
  const usefulTerms: Array<[RegExp, string]> = [
    [/نودلز|nudles|noodle|ramen/i, "noodles ramen bowl"],
    [/مطعم|restaurant/i, "restaurant food interior"],
    [/طعام|food|وجبة|طبق/i, "food dish"],
    [/\bقط\b|cat/i, "domestic cat"],
    [/كلب|dog/i, "domestic dog"],
    [/زهرة|وردة|rose|flower/i, "flower"],
    [/جبال?|mountain/i, "mountain landscape"],
    [/سيارة|car/i, "automobile"],
    [/مدينة|city/i, "city skyline"],
  ];
  return usefulTerms.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

async function searchCommons(query: string): Promise<ImageAsset[]> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await apiFetch(`${API_BASE}/api/images/search?${new URLSearchParams({ query, limit: "8" })}`, { signal: controller.signal });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(detail?.detail ?? `تعذّر البحث في Commons (${response.status}).`);
    }
    const result = await response.json() as { query?: { pages?: Record<string, { pageid: number; title: string; imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: Record<string, { value?: string }> }> }> } };
    return Object.values(result.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl || !info.descriptionurl) return [];
      const metadata = info.extmetadata ?? {};
      const title = metadataText(metadata.ObjectName?.value) === "غير معروف" ? page.title.replace(/^File:/, "") : metadataText(metadata.ObjectName?.value);
      return [{
        id: `commons-${page.pageid}`,
        title,
        thumbnail: info.thumburl,
        source: info.descriptionurl,
        license: metadataText(metadata.LicenseShortName?.value),
        author: metadataText(metadata.Artist?.value),
        width: info.thumbwidth ?? 480,
        height: info.thumbheight ?? 360,
      } satisfies ImageAsset];
    });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("استغرق البحث عن الصور وقتًا أطول من المتوقع.");
    throw reason;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadEmbeddedThumbnail(asset: ImageAsset) {
  if (asset.dataUri) return asset.dataUri;
  const proxyUrl = `${API_BASE}/api/images/embed?url=${encodeURIComponent(asset.thumbnail)}`;
  let response: Response;
  try {
    response = await fetch(proxyUrl);
  } catch {
    response = await fetch(asset.thumbnail);
  }
  if (!response.ok) throw new Error("تعذّر تنزيل معاينة الصورة.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size > 4 * 1024 * 1024) throw new Error("ملف الصورة غير صالح أو أكبر من الحد المسموح.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 640 / image.naturalWidth, 640 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("تعذّر تجهيز الصورة للإدراج.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function addUndoableElement(canvas: SVGCanvasApi, element: SVGElement, label: string) {
  canvas.addCommandToHistory(new canvas.history.InsertElementCommand(element, `AI: ${label}`));
  canvas.selectOnly([element], true);
  canvas.call("changed", [element]);
}

function describeArtwork(canvas: SVGCanvasApi) {
  return Array.from(canvas.getSvgContent().querySelectorAll<SVGElement>("[id]"))
    .filter((element) => element.parentElement?.closest("defs") === null)
    .slice(0, 60)
    .map((element) => ({
      id: element.id,
      type: element.localName,
      text: element.textContent?.trim().slice(0, 80) || undefined,
      fill: element.getAttribute("fill") || undefined,
      stroke: element.getAttribute("stroke") || undefined,
      x: element.getAttribute("x") || element.getAttribute("cx") || undefined,
      y: element.getAttribute("y") || element.getAttribute("cy") || undefined,
    }));
}

function executeEditorAction(canvas: SVGCanvasApi, action: EditorAction, frameDocument: Document, saveToWorkspace: (svg: string) => void) {
  if (action.type === "zoom") {
    const factor = clamp(action.factor ?? 1, 0.1, 10);
    canvas.setZoom(canvas.getZoom() * factor, true);
    canvas.call("updateCanvas", []);
    return `غيّر تكبير اللوحة إلى ${Math.round(canvas.getZoom() * 100)}٪`;
  }

  if (action.type === "pan") {
    const workarea = frameDocument.querySelector<HTMLElement>("#workarea") ?? frameDocument.querySelector<HTMLElement>(".workarea") ?? frameDocument.scrollingElement as HTMLElement | null;
    workarea?.scrollBy({ left: clamp(action.dx ?? 0, -1200, 1200), top: clamp(action.dy ?? 0, -1200, 1200), behavior: "smooth" });
    return `حرك عرض اللوحة (${Math.round(action.dx ?? 0)}, ${Math.round(action.dy ?? 0)})`;
  }

  if (action.type === "draw") {
    if (!action.path || !sanitizePath(action.path)) throw new Error("مسار الرسم الحر غير صالح.");
    const element = canvas.addSVGElementsFromJson({ element: "path", attr: {
      id: (action.id ?? `draw-${crypto.randomUUID().slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
      d: action.path,
      fill: validPaint(action.fill ?? "none") ? action.fill as string : "none",
      stroke: validPaint(action.stroke ?? "#203b3a") ? action.stroke as string : "#203b3a",
      "stroke-width": clamp(action.strokeWidth ?? 3, 0, 40),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    } });
    addUndoableElement(canvas, element, "إضافة رسم حر");
    return "أضاف مسارًا مرسومًا حرًا إلى اللوحة";
  }

  if (action.type === "add-svg") {
    const fragments = sanitizeSvgFragment(action.markup ?? "");
    if (!fragments.length) throw new Error("لا يوجد SVG آمن للإضافة.");
    const root = canvas.getSvgContent().ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
    const groupId = (action.id ?? `svg-${crypto.randomUUID().slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    root.id = groupId;
    root.setAttribute("transform", `translate(${clamp(action.x ?? 0, 0, CANVAS_WIDTH)} ${clamp(action.y ?? 0, 0, CANVAS_HEIGHT)})`);
    fragments.forEach((fragment) => root.appendChild(canvas.getSvgContent().ownerDocument.importNode(fragment, true)));
    canvas.getSvgContent().appendChild(root);
    addUndoableElement(canvas, root, "إضافة SVG آمن");
    return "أضاف مقطع SVG آمنًا إلى اللوحة";
  }

  if (action.type === "add-image") {
    const assetId = action.assetId ?? "";
    const imageHref = action.href ?? "";
    if (!assetId || !imageHref) throw new Error("لا توجد صورة صالحة في مكتبة الصور لادراجها.");
    const x = clamp(action.x ?? 240, 0, CANVAS_WIDTH);
    const y = clamp(action.y ?? 180, 0, CANVAS_HEIGHT);
    const width = clamp(action.width ?? 220, 1, CANVAS_WIDTH);
    const height = clamp(action.height ?? 140, 1, CANVAS_HEIGHT);
    if (x + width > CANVAS_WIDTH || y + height > CANVAS_HEIGHT) {
      throw new Error(`أبعاد الصورة ${width}×${height} عند (${x}, ${y}) تتجاوز مساحة اللوحة ${CANVAS_WIDTH}×${CANVAS_HEIGHT}.`);
    }
    const imageId = (action.id ?? `asset-${assetId}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
    const element = canvas.addSVGElementsFromJson({
      element: "image",
      attr: {
        id: imageId,
        x,
        y,
        width,
        height,
        href: imageHref,
        preserveAspectRatio: "xMidYMid meet",
      },
    });
    addUndoableElement(canvas, element, `إدراج صورة ${assetId}`);
    return `أدرج صورة حملتها من مكتبة الصور`;
  }

  if (action.type === "tool") {
    const toolId = action.toolId ?? "";
    if (!/^tool_[a-zA-Z0-9_-]+$/.test(toolId)) throw new Error("معرّف أداة محرر غير صالح.");
    if (toolId === "tool_save" || toolId === "tool_save_as") {
      saveToWorkspace(serializeWorkspaceSvg(canvas));
      return `حفظ التصميم في مساحة العمل`;
    }
    const tool = frameDocument.getElementById(toolId);
    if (!(tool instanceof frameDocument.defaultView!.HTMLElement)) throw new Error(`أداة المحرر غير متاحة: ${toolId}`);
    const menu = tool.closest("se-flyingbutton") as HTMLElement | null;
    if (menu && menu.getAttribute("opened") === null && tool.getBoundingClientRect().width === 0) {
      menu.setAttribute("opened", "opened");
      tool.click();
      menu.removeAttribute("opened");
      return `فتح قائمة المحرر واختار ${toolLabel(toolId, tool.getAttribute("title") ?? "")}`;
    }
    tool.click();
    return `فعّل أداة المحرر ${toolId}`;
  }
  if (action.type === "add") {
    if (!action.shape || !["rect", "circle", "ellipse", "line", "text", "path", "polygon"].includes(action.shape)) {
      throw new Error("تجاهلت أداة إضافة غير مدعومة.");
    }
    if (canvas.getSvgContent().querySelectorAll("[id]").length > 160) throw new Error("وصل التصميم إلى حد العناصر الآمن (160).");
    const shape = action.shape;
    const x = clamp(action.x ?? 0, 0, CANVAS_WIDTH);
    const y = clamp(action.y ?? 0, 0, CANVAS_HEIGHT);
    const id = (action.id ?? `ai-${crypto.randomUUID().slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
    const fill = validPaint(action.fill ?? "") ? action.fill as string : "none";
    const stroke = validPaint(action.stroke ?? "") ? action.stroke as string : "#203b3a";
    const strokeWidth = clamp(action.strokeWidth ?? 2, 0, 40);
    const attr: Record<string, string | number> = { id, fill, stroke, "stroke-width": strokeWidth };
    if (shape === "rect") {
      const width = action.width ?? 160;
      const height = action.height ?? 100;
      if (x + width > CANVAS_WIDTH || y + height > CANVAS_HEIGHT) {
        throw new Error(`أبعاد المستطيل ${width}×${height} عند (${x}, ${y}) تتجاوز مساحة اللوحة.`);
      }
      attr.x = x; attr.y = y;
      attr.width = clamp(width, 1, CANVAS_WIDTH - x);
      attr.height = clamp(height, 1, CANVAS_HEIGHT - y);
      attr.rx = clamp(action.radius ?? 0, 0, 100);
    } else if (shape === "circle") {
      const radius = action.radius ?? 48;
      if (x - radius < 0 || x + radius > CANVAS_WIDTH || y - radius < 0 || y + radius > CANVAS_HEIGHT) {
        throw new Error(`الدائرة ذات نصف القطر ${radius} عند (${x}, ${y}) تتجاوز مساحة اللوحة.`);
      }
      attr.cx = x; attr.cy = y; attr.r = clamp(radius, 1, 320);
    } else if (shape === "ellipse") {
      const radiusX = action.width ?? 70;
      const radiusY = action.height ?? 45;
      if (x - radiusX < 0 || x + radiusX > CANVAS_WIDTH || y - radiusY < 0 || y + radiusY > CANVAS_HEIGHT) {
        throw new Error(`القطع الناقص عند (${x}, ${y}) يتجاوز مساحة اللوحة.`);
      }
      attr.cx = x; attr.cy = y; attr.rx = clamp(radiusX, 1, 400); attr.ry = clamp(radiusY, 1, 300);
    } else if (shape === "line") {
      const x2 = action.x2 ?? x + 120;
      const y2 = action.y2 ?? y;
      if (x2 < 0 || x2 > CANVAS_WIDTH || y2 < 0 || y2 > CANVAS_HEIGHT) {
        throw new Error("نهاية الخط تتجاوز مساحة اللوحة.");
      }
      attr.x1 = x; attr.y1 = y; attr.x2 = x2; attr.y2 = y2;
      attr.fill = "none";
    } else if (shape === "text") {
      attr.x = x; attr.y = y; attr["font-size"] = clamp(action.fontSize ?? 36, 10, 160);
      attr["font-family"] = (action.fontFamily ?? "Cairo, sans-serif").slice(0, 80);
      if (action.textAnchor) attr["text-anchor"] = action.textAnchor;
      const element = canvas.addSVGElementsFromJson({ element: "text", attr, children: [(action.text ?? "علامتك").slice(0, 120)] });
      addUndoableElement(canvas, element, `إضافة نص ${element.textContent?.slice(0, 28) ?? ""}`);
      return `أضاف نصًا: ${element.textContent?.slice(0, 30) ?? ""}`;
    } else if (shape === "path") {
      if (!action.path || !sanitizePath(action.path)) throw new Error("مسار SVG مرفوض: الصيغة غير آمنة أو طويلة.");
      attr.d = action.path;
      if (x || y) attr.transform = `translate(${x} ${y})`;
    } else if (shape === "polygon") {
      const points = action.points ?? "";
      if (points.length > 1000 || !/^[0-9eE+.,\s-]+$/.test(points)) throw new Error("نقاط المضلع غير صالحة.");
      attr.points = points;
    }
    const element = canvas.addSVGElementsFromJson({ element: shape, attr });
    addUndoableElement(canvas, element, `إضافة ${shape}`);
    return `أضاف ${shape} إلى اللوحة`;
  }

  if (action.type === "select") {
    const target = action.target ? findArtwork(canvas, action.target) : null;
    if (!target) throw new Error(`لم أجد العنصر ${action.target ?? "المحدد"} على اللوحة.`);
    canvas.selectOnly([target], true);
    return `حدد ${target.id}`;
  }

  if (action.type === "rotate") {
    const target = action.target ? findArtwork(canvas, action.target) : null;
    if (!target) throw new Error(`لم أجد العنصر ${action.target ?? "المحدد"} على اللوحة.`);
    canvas.selectOnly([target], true);
    const nextAngle = clamp(action.angle ?? 0, -360, 360);
    canvas.setRotationAngle(nextAngle, true);
    return `دوّر ${target.id} إلى ${nextAngle}°`;
  }

  if (["update", "move", "delete", "front", "back"].includes(action.type)) {
    const target = action.target ? findArtwork(canvas, action.target) : null;
    if (!target) throw new Error(`لم أجد العنصر ${action.target ?? "المحدد"} على اللوحة.`);
    canvas.selectOnly([target], true);
    if (action.type === "delete") {
      canvas.deleteSelectedElements();
      return `حذف ${target.id}`;
    }
    if (action.type === "move") {
      const dx = clamp(action.dx ?? 0, -CANVAS_WIDTH, CANVAS_WIDTH) * canvas.getZoom();
      const dy = clamp(action.dy ?? 0, -CANVAS_HEIGHT, CANVAS_HEIGHT) * canvas.getZoom();
      canvas.moveSelectedElements(dx, dy, true);
      return `حرّك ${target.id} (${Math.round(action.dx ?? 0)}, ${Math.round(action.dy ?? 0)})`;
    }
    if (action.type === "front") {
      canvas.moveToTopSelectedElement();
      return `قدّم ${target.id} للأمام`;
    }
    if (action.type === "back") {
      canvas.moveToBottomSelectedElement();
      return `أرسل ${target.id} للخلف`;
    }

    const requested = action.attributes ?? {};
    let updated = 0;
    for (const [rawName, rawValue] of Object.entries(requested)) {
      const attribute = normalizeAttributeName(rawName);
      if (!EDITABLE_ATTRIBUTES.has(attribute)) continue;
      if (["fill", "stroke"].includes(attribute) && !validPaint(rawValue)) continue;
      let value: string | number = rawValue;
      if (typeof value === "number") {
        const bounds = attribute === "x" || attribute === "x1" || attribute === "x2" || attribute === "cx" || attribute === "width" || attribute === "rx" ? CANVAS_WIDTH : CANVAS_HEIGHT;
        value = clamp(value, 0, bounds);
      } else {
        value = value.slice(0, attribute === "#text" ? 180 : 100);
      }
      canvas.changeSelectedAttribute(attribute, value, [target]);
      updated += 1;
    }
    if (!updated) throw new Error("لم يتضمن أمر التعديل خصائص مسموحًا بها.");
    canvas.call("changed", [target]);
    return `عدّل ${updated} خاصية في ${target.id}`;
  }

  throw new Error(`نوع الأمر غير مدعوم: ${action.type}`);
}

export default function SVGLogoStudio({ initialSvg, initialTitle, onChange, onTitleChange, workspaceName }: SVGLogoStudioProps) {
  const language = useLanguage();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<SVGEditorApi | null>(null);
  const generateLogoRef = useRef<(event?: React.FormEvent<HTMLFormElement>, overridePrompt?: string) => Promise<void>>(async () => undefined);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const onTitleChangeRef = useRef(onTitleChange);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [editorReady, setEditorReady] = useState(false);
  const [editorTools, setEditorTools] = useState<SVGTool[]>([]);
  const [artworkInventory, setArtworkInventory] = useState<ReturnType<typeof describeArtwork>>([]);
  const [prompt, setPrompt] = useState("");
  const [documents, setDocuments] = useState<TextDocument[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ stage: number; name: string } | null>(null);
  const [designTitle, setDesignTitle] = useState(initialTitle || "هوية جديدة");
  const [activity, setActivity] = useState<Array<{ id: number; text: string; state: "done" | "rejected" }>>([]);
  const [aiRawReply, setAiRawReply] = useState("");
  const [responseTab, setResponseTab] = useState<"program" | "activity">("activity");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageLibrary, setImageLibrary] = useState<ImageAsset[]>([]);
  const [imageQuery, setImageQuery] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const imageSearchRequestRef = useRef(0);
  const [imageLibraryVisible, setImageLibraryVisible] = useState(() => localStorage.getItem("taskflow-logo-library-hidden") !== "true");
  const [visionStatus, setVisionStatus] = useState<LocalVisionStatus | null>(null);
  const [visionDownloading, setVisionDownloading] = useState(false);
  const [visionDownloadProgress, setVisionDownloadProgress] = useState<ModelDownloadStatus | null>(null);
  const [visionReference, setVisionReference] = useState<{ name: string; dataUrl: string } | null>(null);
  const [toolbarBusy, setToolbarBusy] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState("0");
  const [actualUsage, setActualUsage] = useState<UsageSnapshot>({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, credits: 0 });
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const contextLimit = estimateContextLimit(selectedProvider?.model ?? "");
  const estimatedTokensUsed = estimateTokens(`${LOGO_SYSTEM_PROMPT}\n${NATIVE_TOOL_PROMPT}\n${JSON.stringify(editorTools)}\n${JSON.stringify(artworkInventory)}\n${prompt}`);
  const estimatedTokensRemaining = Math.max(0, contextLimit - estimatedTokensUsed);
  const contextUsagePercent = Math.min(100, (estimatedTokensUsed / contextLimit) * 100);
  const realUsageActive = actualUsage.total_tokens > 0;
  const visibleUsageText = realUsageActive
    ? `${actualUsage.total_tokens.toLocaleString(language === "ar" ? "ar-EG" : "en-US")} ${translate("توكن", language)} · ${actualUsage.credits.toFixed(4)} ${translate("رصيد", language)}`
    : `${estimatedTokensRemaining.toLocaleString(language === "ar" ? "ar-EG" : "en-US")} / ${contextLimit.toLocaleString(language === "ar" ? "ar-EG" : "en-US")} ${translate("توكن", language)}`;
  const visibleUsageWidth = realUsageActive
    ? Math.min(100, (actualUsage.total_tokens / Math.max(contextLimit, actualUsage.total_tokens)) * 100)
    : contextUsagePercent;

  useEffect(() => {
    onChangeRef.current = onChange;
    onTitleChangeRef.current = onTitleChange;
  }, [onChange, onTitleChange]);

  useEffect(() => {
    function receiveLogoRequest(event: Event) {
      const requestPrompt = (event as CustomEvent<string>).detail;
      if (typeof requestPrompt !== "string" || !requestPrompt.trim()) return;
      localStorage.removeItem("taskflow-ai-logo-request");
      setPrompt(requestPrompt);
      void generateLogoRef.current(undefined, requestPrompt);
    }
    function receiveLogoTitle(event: Event) {
      const title = (event as CustomEvent<string>).detail;
      if (typeof title === "string" && title.trim()) setDesignTitle(title.slice(0, 60));
    }
    window.addEventListener("taskflow:ai-logo-request", receiveLogoRequest);
    window.addEventListener("taskflow:ai-logo-title", receiveLogoTitle);
    return () => {
      window.removeEventListener("taskflow:ai-logo-request", receiveLogoRequest);
      window.removeEventListener("taskflow:ai-logo-title", receiveLogoTitle);
    };
  }, []);

  useEffect(() => {
    function receiveImageSearch(event: Event) {
      const query = (event as CustomEvent<string>).detail;
      if (typeof query !== "string" || !query.trim()) return;
      localStorage.removeItem("taskflow-ai-logo-search");
      void searchLibrary(query.trim().slice(0, 120));
    }
    window.addEventListener("taskflow:ai-logo-search", receiveImageSearch);
    const pendingQuery = localStorage.getItem("taskflow-ai-logo-search");
    if (pendingQuery) receiveImageSearch(new CustomEvent("taskflow:ai-logo-search", { detail: pendingQuery }));
    return () => window.removeEventListener("taskflow:ai-logo-search", receiveImageSearch);
  }, []);

  useEffect(() => {
    if (!editorReady) return;
    const pending = localStorage.getItem("taskflow-ai-logo-request");
    if (!pending) return;
    try {
      const request = JSON.parse(pending) as { prompt?: unknown; createdAt?: unknown };
      if (typeof request.prompt === "string" && request.prompt.trim() && typeof request.createdAt === "number" && Date.now() - request.createdAt < 10 * 60 * 1000) {
        localStorage.removeItem("taskflow-ai-logo-request");
        setPrompt(request.prompt);
        void generateLogoRef.current(undefined, request.prompt);
      }
    } catch {
      localStorage.removeItem("taskflow-ai-logo-request");
    }
  }, [editorReady]);

  useEffect(() => {
    let active = true;
    apiFetch(`${API_BASE}/api/providers`)
      .then((response) => response.ok ? response.json() as Promise<Provider[]> : [])
      .then((result) => {
        if (!active) return;
        setProviders(result);
        setProviderId(result.find((provider) => provider.is_default)?.id ?? result[0]?.id ?? "");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch(`${API_BASE}/api/w2m/vision/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذّر تحميل حالة محرك الرؤية المحلي.");
        return response.json() as Promise<LocalVisionStatus>;
      })
      .then((result) => {
        if (active) setVisionStatus(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل حالة محرك الرؤية المحلي.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    const canvas = editorRef.current?.svgCanvas;
    if (!canvas) return;
    try {
      onChangeRef.current(serializeWorkspaceSvg(canvas));
    } catch {
      // Keep the last serialized workspace version if the editor is already disposed.
    }
  }, []);

  async function handleEditorLoad() {
    const editor = (frameRef.current?.contentWindow as SVGEditorWindow | null)?.svgEditor;
    if (!editor) {
      setError("تعذّر تحميل SVG-Edit. أعد تشغيل التطبيق وتأكد من تثبيت الحزم.");
      return;
    }
    try {
      const frameDocument = frameRef.current?.contentDocument;
      if (frameDocument) {
        frameDocument.documentElement.style.direction = "ltr";
        frameDocument.body.style.direction = "ltr";
        frameDocument.body.style.overflow = "hidden";
      }
      await editor.ready(() => undefined);
      editorRef.current = editor;
      await editor.loadFromString(initialSvg || EMPTY_SVG, { noAlert: true });
      const svgCanvas = editor.svgCanvas;
      if (!svgCanvas) throw new Error("SVG canvas API is unavailable.");
      setArtworkInventory(describeArtwork(svgCanvas));
      setEditorTools(await waitForAvailableTools(frameRef.current?.contentDocument));
      const previousChanged = svgCanvas.bind("changed", (frame, elements) => {
        previousChanged?.(frame, elements);
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          try {
            onChangeRef.current(serializeWorkspaceSvg(svgCanvas));
          } catch {
            setError("تعذّر حفظ التعديل الأخير في مساحة العمل.");
          }
        }, 350);
      });
      setEditorReady(true);
      setError("");
    } catch {
      setError("تعذّر تهيئة محرر SVG.");
    }
  }

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    const canvas = editorRef.current?.svgCanvas;
    if (!canvas) return;
    try {
      onChangeRef.current(serializeWorkspaceSvg(canvas));
    } catch {
      // The workspace already has the last successfully serialized version.
    }
  }, []);

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function installLocalVision() {
    setVisionDownloading(true);
    setError("");
    try {
      const result = await runTrackedDownload("florence-2", async () => {
        const response = await apiFetch(`${API_BASE}/api/w2m/vision/download`, { method: "POST" });
        const value = await response.json() as LocalVisionStatus & { detail?: string };
        if (!response.ok) throw new Error(value.detail ?? "تعذّر تنزيل نموذج Florence-2.");
        return value;
      }, setVisionDownloadProgress);
      setVisionStatus(result);
      setNotice("تم تثبيت نموذج الرؤية المحلي. يعمل على هذا الجهاز ولا يرسل الصور إلى مزوّد AI.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تثبيت نموذج الرؤية المحلي.");
    } finally {
      setVisionDownloading(false);
    }
  }

  async function selectVisionReference(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("الصورة المرجعية يجب أن تكون JPEG أو PNG أو WebP.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("حجم الصورة المرجعية يجب ألا يتجاوز 4 ميغابايت.");
      return;
    }
    try {
      setVisionReference({ name: file.name, dataUrl: await readImageDataUrl(file) });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّرت قراءة الصورة المرجعية.");
    }
  }

  async function searchLibrary(queryOverride?: string) {
    const query = (queryOverride ?? imageQuery).trim().slice(0, 120);
    if (!query) {
      setImageLibrary([]);
      setNotice("");
      setError("");
      return;
    }
    const requestId = ++imageSearchRequestRef.current;
    setImageQuery(query);
    setImageLoading(true);
    try {
      const results = await searchCommons(query);
      if (requestId !== imageSearchRequestRef.current) return;
      setImageLibrary(results);
      setNotice(results.length ? `ظهر ${results.length} نتيجة من Wikimedia Commons. سيختار AI ما يلائم التصميم.` : "لم يعثر على صور مناسبة في مكتبة Wikimedia Commons.");
      setError("");
    } catch (reason) {
      if (requestId !== imageSearchRequestRef.current) return;
      setImageLibrary([]);
      setError(reason instanceof Error ? reason.message : "تعذّر البحث في مكتبة الصور.");
    } finally {
      if (requestId === imageSearchRequestRef.current) setImageLoading(false);
    }
  }

  async function insertAssetIntoCanvas(asset: ImageAsset) {
    const editor = editorRef.current;
    const canvas = editor?.svgCanvas;
    if (!editor || !canvas) {
      setError("المحرر لم يجهز بعد لإدراج الصورة.");
      return;
    }
    try {
      const dataUri = await loadEmbeddedThumbnail(asset);
      const imageId = `asset-${asset.id}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
      const element = canvas.addSVGElementsFromJson({
        element: "image",
        attr: {
          id: imageId,
          x: 260,
          y: 180,
          width: Math.min(asset.width, 340),
          height: Math.min(asset.height, 220),
          href: dataUri,
          preserveAspectRatio: "xMidYMid meet",
        },
      });
      addUndoableElement(canvas, element, `إدراج صورة ${asset.title}`);
      setNotice(`تم إدراج الصورة: ${asset.title}`);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر إدراج الصورة في اللوحة.");
    }
  }

  function saveLocally() {
    const svgCanvas = editorRef.current?.svgCanvas;
    if (!svgCanvas) {
      setError("المحرر لم يجهز بعد.");
      return;
    }
    try {
      const markup = serializeWorkspaceSvg(svgCanvas);
      onChangeRef.current(markup);
      setNotice(`تم حفظ الشعار في مساحة «${workspaceName}».`);
      setError("");
    } catch {
      setError("تعذّر قراءة الشعار أو حفظه محليًا.");
    }
  }

  function rotateSelected(angle: number) {
    const editor = editorRef.current;
    const canvas = editor?.svgCanvas;
    if (!editor || !canvas) {
      setError("المحرر لم يجهز بعد لدوران العنصر.");
      return;
    }
    try {
      setToolbarBusy(true);
      const selected = canvas.getSelectedElements();
      if (!selected.length) throw new Error("اختر عنصرًا أولاً قبل الدوران.");
      const target = selected[0]?.id || "";
      if (!target) throw new Error("العنصر المحدد لا يحتوي على معرف صالح.");
      const normalizedAngle = ((Math.round(angle * 10) / 10 % 360) + 360) % 360;
      const label = executeEditorAction(canvas, { type: "rotate", target, angle: normalizedAngle }, frameRef.current?.contentDocument ?? document, onChangeRef.current);
      setActivity((current) => [...current.slice(-11), { id: Date.now(), text: label, state: "done" }]);
      setRotationDegrees(String(Math.round(normalizedAngle * 10) / 10));
      setNotice(`تم ضبط دوران العنصر على ${normalizedAngle}°.`);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر دوران العنصر.");
    } finally {
      setToolbarBusy(false);
    }
  }

  function nudgeSelectedRotation(delta: number) {
    const canvas = editorRef.current?.svgCanvas;
    const selected = canvas?.getSelectedElements() ?? [];
    const currentAngle = selected[0] ? canvas?.getRotationAngle(selected[0]) ?? 0 : Number(rotationDegrees) || 0;
    rotateSelected(currentAngle + delta);
  }

  async function applySelectionAction(action: "front" | "back" | "delete") {
    const editor = editorRef.current;
    const canvas = editor?.svgCanvas;
    if (!editor || !canvas) {
      setError("المحرر لم يجهز بعد لتطبيق التعديل.");
      return;
    }
    try {
      setToolbarBusy(true);
      const selected = canvas.getSelectedElements();
      if (!selected.length) throw new Error("اختر عنصرًا أولاً لتطبيق هذا الإجراء.");
      const target = selected[0]?.id || "";
      if (!target) throw new Error("العنصر المحدد لا يحتوي على معرف صالح.");
      const label = executeEditorAction(canvas, { type: action, target }, frameRef.current?.contentDocument ?? document, onChangeRef.current);
      setActivity((current) => [...current.slice(-11), { id: Date.now(), text: label, state: "done" }]);
      setNotice(action === "front" ? "تم رفع العنصر إلى الأمام." : action === "back" ? "تم إرجاع العنصر إلى الخلف." : "تم حذف العنصر المحدد.");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تطبيق الإجراء.");
    } finally {
      setToolbarBusy(false);
    }
  }

  async function generateLogo(event?: React.FormEvent<HTMLFormElement>, overridePrompt = prompt) {
    event?.preventDefault();
    const editor = editorRef.current;
    if (!editor || !providerId || (!overridePrompt.trim() && !documents.length) || generating) return;
    const canvas = editor.svgCanvas;
    if (!canvas) {
      setError("تعذّر الوصول إلى لوحة SVG-Edit.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setProgress({ stage: 0, name: "يفحص العناصر الحالية" });
    setError("");
    setNotice("");
    setActivity([]);
    setAiRawReply("");
    setResponseTab("activity");
    let reply = "";
    let executedActions = 0;
    let failedActions = 0;
    let timedOut = false;
    let designModified = false;
    let activityId = 0;
    const frameDocument = frameRef.current?.contentDocument;
    const tools = readAvailableTools(frameDocument);
    const initialSvg = canvas.getSvgString();
    const requestPrompt = overridePrompt.trim() || "أنشئ شعارًا مستندًا إلى محتوى الملفات المرفقة.";
    let availableLibraryAssets = imageLibrary;
    const imageDecision = "For posters or branded scenes that mention real food/products/people/places, one relevant live image is required when a matching asset is provided. Add it with add-image using the exact assetId, large editorial dimensions, preserveAspectRatio semantics, and send it behind text with type=back afterward. Do not use a photo for abstract logos unless it clearly improves the design. Never invent assetId or image URLs.";

    const generationTimeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 900_000);
    try {
      if (!visionStatus?.installed) {
        throw new Error("ثبّت نموذج Florence-2 المحلي أولًا لتفعيل تحليل الصور والتحقق البصري في W2M.");
      }
      if (!frameDocument) throw new Error("تعذّر الوصول إلى أدوات SVG-Edit داخل الإطار.");
      let referenceAnalysis: LocalVisionAnalysis | null = null;
      if (visionReference) {
        setProgress({ stage: 0, name: "يحلل الصورة المرجعية محليًا" });
        referenceAnalysis = await analyzeWithLocalVision(visionReference.dataUrl);
      }
      const inferredImageQuery = inferImageSearchQuery(requestPrompt);
      if (inferredImageQuery) {
        setProgress({ stage: 0, name: `بحث الصور: ${inferredImageQuery}` });
        availableLibraryAssets = await searchCommons(inferredImageQuery);
        if (availableLibraryAssets.length) setImageLibrary(availableLibraryAssets);
      } else if (!availableLibraryAssets.length) {
        availableLibraryAssets = [];
      }
      const visibleTools = tools.filter((tool) => tool.visible);
      const toolsForAI = visibleTools.length ? visibleTools : tools;
      const libraryCandidates = await Promise.all(availableLibraryAssets.slice(0, 4).map(async (asset) => {
        setProgress({ stage: 0, name: "يفحص صور المكتبة محليًا" });
        const image = asset.dataUri ?? await loadEmbeddedThumbnail(asset);
        const analysis = await analyzeWithLocalVision(image, "caption");
        return { id: asset.id, title: asset.title, license: asset.license, author: asset.author, visualDescription: analysis.caption };
      }));
      availableLibraryAssets = availableLibraryAssets.slice(0, libraryCandidates.length);
      const baseSystemPrompt = `${LOGO_SYSTEM_PROMPT}\n${NATIVE_TOOL_PROMPT}\nIMPORTANT: First plan a grid and a bounding box for every object. Keep all geometry within x=0..${CANVAS_WIDTH}, y=0..${CANVAS_HEIGHT}; align repeated edges and baselines; preserve generous safe margins; size text to fit its zone. For a logo create a centered, balanced mark and wordmark. For a poster assign separate, measured zones to title, image, and details. Use a concise set of 8-36 commands, never place objects randomly or overlap unrelated elements. Return a complete valid W2M/2 DESIGN program only.`;
      let correctionFeedback = "";
      let verifiedAnalysis: LocalVisionAnalysis | null = null;
      let title = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await editor.loadFromString(initialSvg, { noAlert: true });
          setActivity([{ id: ++activityId, text: "فشل التحقق البصري، يعيد W2M المحاولة", state: "rejected" }]);
        }
        const inventory = describeArtwork(canvas);
        const request = `${requestPrompt}${documentsAsContext(documents)}\n\nLive SVG-Edit tools:\n${JSON.stringify(toolsForAI)}\n\nCurrent editable layers (use exact IDs):\n${JSON.stringify(inventory)}\n\n${imageDecision}\nLibrary candidates analyzed locally by Florence-2; choose only an exact listed ID when relevant:\n${JSON.stringify(libraryCandidates)}\n\nLocal visual analysis of the user's reference image:\n${JSON.stringify(referenceAnalysis)}\n\n${correctionFeedback ? `Local post-render verification feedback. Correct these issues and return the entire updated program:\n${correctionFeedback}` : "Create the requested design from scratch or edit the current layers."}`;
        setProgress({
          stage: 0,
          name: attempt ? "يعيد W2M التخطيط بصريًا" : "يجهّز W2M التصميم عبر المزوّد",
        });
        reply = await requestW2MProgram(providerId, request, baseSystemPrompt, controller.signal, setAiRawReply, (usage) => {
          setActualUsage({
            prompt_tokens: Number(usage.prompt_tokens ?? 0),
            completion_tokens: Number(usage.completion_tokens ?? 0),
            total_tokens: Number(usage.total_tokens ?? 0),
            credits: Number(usage.credits ?? 0),
          });
        });
        const parsed = parseW2MDesignProgram(reply);
        const resolvedActions = await Promise.all(parsed.actions.map(async (action): Promise<EditorAction> => {
          if (action.type !== "add-image") return action;
          const libraryAsset = availableLibraryAssets.find((asset) => asset.id === action.assetId);
          if (!libraryAsset) throw new Error(`لم أجد صورة مكتبة مسجلة باسم ${action.assetId ?? ""}.`);
          return { ...action, href: libraryAsset.dataUri ?? await loadEmbeddedThumbnail(libraryAsset) };
        }));
        let attemptExecuted = 0;
        let attemptFailed = 0;
        let addedElements = 0;
        for (const action of resolvedActions) {
          setProgress({ stage: attemptExecuted + attemptFailed + 1, name: action.type });
          try {
            if (action.type === "add" && addedElements >= 48) throw new Error("تم الوصول إلى حد الإضافات المسموح لهذا الطلب.");
            editor.leftPanel.clickSelect();
            const label = executeEditorAction(canvas, action, frameDocument, onChangeRef.current);
            attemptExecuted += 1;
            designModified = true;
            if (action.type === "add") addedElements += 1;
            setActivity((current) => [...current.slice(-11), { id: ++activityId, text: label, state: "done" }]);
            await new Promise((resolve) => window.setTimeout(resolve, 90));
          } catch (reason) {
            attemptFailed += 1;
            setActivity((current) => [...current.slice(-11), { id: ++activityId, text: reason instanceof Error ? reason.message : "رفض المحرر هذا الإجراء.", state: "rejected" }]);
          }
        }
        if (!attemptExecuted) throw new Error("لم يستطع محرر SVG-Edit تنفيذ أي أمر من برنامج W2M.");
        setProgress({ stage: 0, name: "يتحقق بصريًا من التصميم النهائي" });
        verifiedAnalysis = await analyzeWithLocalVision(await renderSvgPreview(serializeWorkspaceSvg(canvas)));
        const issues = [...findLayoutIssues(canvas), ...findRenderedTextIssues(canvas, resolvedActions)];
        if (attemptFailed) issues.push(`تعذر على المحرر تنفيذ ${attemptFailed} أمرًا.`);
        executedActions = attemptExecuted;
        failedActions = attemptFailed;
        title = parsed.title;
        if (!issues.length) break;
        correctionFeedback = JSON.stringify({
          detectedIssues: issues,
          renderedImageCaption: verifiedAnalysis.caption,
          detectedObjects: verifiedAnalysis.objects,
          detectedTextRegions: verifiedAnalysis.text_regions,
          instruction: "Revise positions, sizes, and layer ordering. Keep all objects within the artboard and prevent text-on-text overlap.",
        });
        if (attempt === 2) {
          await editor.loadFromString(initialSvg, { noAlert: true });
          throw new Error(`لم يجتز التصميم التحقق البصري بعد محاولتي تصحيح. أُعيدت اللوحة إلى ما قبل الطلب. ${issues.join(" ")}`);
        }
      }
      if (title) {
        setDesignTitle(title);
        onTitleChangeRef.current(title);
      }
      const visionSummary = verifiedAnalysis
        ? ` Florence-2 محليًا: ${verifiedAnalysis.caption.slice(0, 180)} · ${verifiedAnalysis.objects.length} عنصر مرئي و${verifiedAnalysis.text_regions.length} منطقة نصية.`
        : "";
      setNotice(`أنهى W2M التحقق المحلي وتنفيذ ${executedActions} أمرًا داخل المحرر${failedActions ? `، وتعذر تنفيذ ${failedActions} أمرًا` : ""}.${visionSummary} الصور لم تُرسل إلى مزوّد AI.`);
      designModified = false;
      try {
        const svg = serializeWorkspaceSvg(canvas);
        const safeName = sanitizeArtifactFilename(title || "TaskFlow design", "TaskFlow design");
        const delivery = await deliverArtifactToTelegram("design", `${safeName}.svg`, svg, "image/svg+xml");
        if (delivery.available) {
          setNotice((current) => `${current}${delivery.delivered
            ? " تم إرسال ملف SVG إلى بوت تيليجرام."
            : ` ${delivery.reason ?? "لم يُرسل الملف إلى تيليجرام."}`}`);
        }
      } catch (reason) {
        setError(`اكتمل التصميم لكن تعذر إرسال الملف إلى تيليجرام: ${reason instanceof Error ? reason.message : "خطأ غير معروف."}`);
      }
      setPrompt("");
      setDocuments([]);
      setVisionReference(null);
    } catch (reason) {
      if (designModified) await editor.loadFromString(initialSvg, { noAlert: true });
      if (reason instanceof DOMException && reason.name === "AbortError") {
        if (timedOut) {
          setError(`انتهت مهلة التوليد بعد 15 دقيقة${reply.trim() ? ". وصل رد W2M جزئي ولم يكتمل؛ أعد المحاولة بمهمة أقصر." : ". لم يصل رد كامل من مزوّد AI."}`);
        } else {
          setNotice("أوقفت التوليد وأُعيدت اللوحة إلى ما قبل الطلب.");
        }
      } else {
        const message = reason instanceof BackendConnectionError
          ? `${translate(reason.message, language)} (${API_BASE})`
          : reason instanceof Error ? reason.message : "تعذّر إنشاء الشعار.";
        setError(message);
      }
    } finally {
      window.clearTimeout(generationTimeout);
      abortRef.current = null;
      setGenerating(false);
      setProgress(null);
    }
  }

  generateLogoRef.current = generateLogo;

  return (
    <section className="svg-logo-studio" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="svg-logo-heading">
        <div className="svg-logo-mark"><Sparkles size={19} /></div>
        <div><span>TASKFLOW · DESIGN STUDIO</span><h2>{translate("استوديو الشعارات والرسوم المتجهة", language)}</h2><p>{workspaceName} · {designTitle} {translate("· حفظ تلقائي في مساحة العمل.", language)}</p></div>
        <label className="svg-logo-name"><span>{translate("اسم التصميم", language)}</span><input value={designTitle} maxLength={60} onChange={(event) => { setDesignTitle(event.target.value); onTitleChangeRef.current(event.target.value); }} /></label>
        {editorReady && <small className="svg-logo-tool-count">{translate("AI متصل بـ", language)} {editorTools.length} {translate("أداة تحرير", language)}</small>}
        <button type="button" className="svg-logo-save" onClick={saveLocally} disabled={!editorReady}><Save size={15} /> {translate("حفظ الآن", language)}</button>
      </header>

      <div className={`svg-logo-editor${generating ? " generating" : ""}`} role="region" aria-label={translate("لوحة الرسم", language)}>
        {!editorReady && <div className="svg-logo-loading"><LoaderCircle className="svg-logo-spin" size={20} /><span>{translate("جارٍ تحميل المحرر...", language)}</span></div>}
        <iframe
          ref={frameRef}
          title={translate("محرر الرسوم المتجهة", language)}
          src="/vendor/svgedit/index.html?lang=en&dimensions=1200,760&canvas_expansion=0&show_outside_canvas=false"
          onLoad={() => void handleEditorLoad()}
          style={{ visibility: editorReady ? "visible" : "hidden" }}
        />
      </div>
      <footer className="svg-logo-attribution">SVG-Edit 7.4.2 · <a href="https://github.com/SVG-Edit/svgedit" target="_blank" rel="noreferrer">{translate("المستودع والترخيص", language)}</a></footer>

      <form className="svg-logo-ai" onSubmit={(event) => void generateLogo(event)}>
        <div className="svg-logo-ai-title"><WandSparkles size={16} /><strong>{translate("مساعد داخل المحرر", language)}</strong><small>{translate("يرسم ويعدّل ويستخدم", language)} {editorTools.length} {translate("أداة أصلية", language)}</small></div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={translate("اسم العلامة ونشاطها وجمهورها وأسلوبها وألوانها؛ مثال: شعار هندسي أنيق لمحمصة قهوة باسم نواة، أخضر زمردي ونحاسي...", language)} rows={2} maxLength={3000} />
        <div className="svg-logo-documents"><DocumentAttachments documents={documents} onChange={setDocuments} disabled={generating} /></div>
        <section className="svg-logo-vision" aria-label="W2M local vision">
          <div>
            <strong>{translate("رؤية W2M المحلية · Florence-2", language)}</strong>
            <small>{visionStatus && !visionStatus.runtime_ready
              ? translate("أعد تشغيل التطبيق لتثبيت مكونات الرؤية المحلية.", language)
              : visionStatus?.installed
              ? `${translate("جاهز للتحليل والتحقق البصري", language)} · ${(visionStatus.size_bytes / 1_000_000).toFixed(0)} MB · ${translate("تبقى الصور على الجهاز", language)}`
              : translate("نزّل نموذج ONNX مرة واحدة (حتى 500 MB) لاستخدام التحليل والتحقق المحلي.", language)}</small>
            <small>{translate("المزوّد المختار يولّد الأوامر وW2M ينفّذها؛ Florence-2 للتحليل البصري والتحقق فقط.", language)}</small>
          </div>
          {!visionStatus?.installed && <button type="button" onClick={() => void installLocalVision()} disabled={visionDownloading || generating || visionStatus?.runtime_ready === false}>
            {visionDownloading ? <LoaderCircle className="svg-logo-spin" size={14} /> : <Download size={14} />}
            {visionDownloading ? translate("جارٍ تنزيل النموذج...", language) : visionStatus?.runtime_ready === false
              ? translate("المحرك غير جاهز", language)
              : translate("تثبيت محرك الرؤية", language)}
          </button>}
          {visionDownloading && <ModelDownloadProgress progress={visionDownloadProgress} label={translate("تنزيل Florence-2 المحلي", language)} />}
          <label>
            <span>{visionReference ? `${translate("مرجع بصري", language)}: ${visionReference.name}` : translate("إرفاق صورة مرجعية للتحليل المحلي", language)}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={generating || !visionStatus?.installed} onChange={(event) => {
              void selectVisionReference(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }} />
          </label>
          {visionReference && <button type="button" className="svg-logo-vision-clear" onClick={() => setVisionReference(null)} disabled={generating}>{translate("إزالة المرجع", language)}</button>}
        </section>
        <div className="svg-logo-ai-actions">
          <select aria-label={translate("مزوّد الذكاء الاصطناعي", language)} value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={!providers.length || generating}>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
          </select>
          {generating
            ? <button type="button" className="svg-logo-stop" onClick={stopGeneration}><X size={15} /> {translate("إيقاف", language)}</button>
            : <button type="submit" disabled={!editorReady || !providerId || (!prompt.trim() && !documents.length)}><WandSparkles size={15} /> {translate("نفّذ داخل المحرر", language)}</button>}
        </div>
        <div className="svg-logo-context" title={translate(realUsageActive ? "استهلاك فعلي من مزوّد AI بناءً على usage الحقيقي" : "تقدير محلي لمساحة سياق الموديل، وليس رصيد الفوترة لدى المزوّد", language)}>
          <div><span>{realUsageActive ? translate("استهلاك AI الحقيقي ·", language) : translate("السياق المتبقي تقديريًا ·", language)} {selectedProvider?.name ?? translate("المزوّد", language)}</span><strong>{visibleUsageText}</strong></div>
          <span className="svg-logo-context-track"><span style={{ width: `${visibleUsageWidth}%` }} /></span>
        </div>
      </form>

      {generating && progress && <div className="svg-logo-progress" role="status" aria-live="polite">
        <LoaderCircle className="svg-logo-spin" size={15} /><strong>{progress.stage ? translate(`ينفذ الأمر ${progress.stage}`, language) : translate("يفحص لوحة الرسم", language)}</strong><span>{translate(EDITOR_ACTION_LABELS[progress.name] ?? progress.name, language)}</span>
      </div>}
      <section className="svg-logo-response" aria-label={translate("نتيجة الذكاء الاصطناعي", language)}>
        <div className="svg-logo-response-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={responseTab === "activity"} onClick={() => setResponseTab("activity")}>{translate("سجل التنفيذ", language)}</button>
          <button type="button" role="tab" aria-selected={responseTab === "program"} onClick={() => setResponseTab("program")}>{translate("برنامج W2M/2", language)}</button>
        </div>
        {responseTab === "program"
          ? <pre className="svg-logo-ai-debug" role="tabpanel">{aiRawReply || translate("لم يبدأ نموذج AI بإرسال الرد بعد.", language)}</pre>
          : <section className="svg-logo-activity" role="tabpanel" aria-label={translate("أفعال المساعد داخل المحرر", language)}>
            <header><Sparkles size={14} /><strong>{translate("سجل عمل المساعد", language)}</strong><small>{activity.filter((item) => item.state === "done").length} {translate("نُفذت", language)}</small></header>
            {activity.length
              ? <ol>{activity.map((item) => <li key={item.id} className={item.state}><span>{item.state === "done" ? "✓" : "!"}</span>{translate(item.text, language)}</li>)}</ol>
              : <small>{translate("سيظهر هنا ما ينفذه المساعد داخل لوحة الرسم.", language)}</small>}
          </section>}
      </section>
      {error && <div className="svg-logo-feedback error" role="alert">{translate(error, language)}<button type="button" onClick={() => setError("")} aria-label={translate("إغلاق", language)}><X size={14} /></button></div>}
      {notice && <div className="svg-logo-feedback" role="status">{translate(notice, language)}<button type="button" onClick={() => setNotice("")} aria-label={translate("إغلاق", language)}><X size={14} /></button></div>}

      <section className="svg-logo-library" aria-label={translate("مكتبة الصور", language)}>
        <header className="svg-logo-library-header">
          <strong>{translate("مكتبة صور Wikimedia Commons", language)}</strong>
          <button type="button" className="svg-logo-library-toggle" aria-expanded={imageLibraryVisible} onClick={() => setImageLibraryVisible((visible) => {
            localStorage.setItem("taskflow-logo-library-hidden", String(visible));
            return !visible;
          })}>
            {imageLibraryVisible ? <><EyeOff size={14} /> {translate("إخفاء المكتبة", language)} <ChevronDown size={13} /></> : <><Eye size={14} /> {translate("عرض المكتبة", language)}</>}
          </button>
        </header>
        {imageLibraryVisible && <>
          <form className="svg-logo-library-search" onSubmit={(event) => { event.preventDefault(); void searchLibrary(); }}>
            <Search size={15} aria-hidden="true" />
            <input
              value={imageQuery}
              onChange={(event) => setImageQuery(event.target.value)}
              placeholder={translate("ابحث في مكتبة Wikimedia Commons...", language)}
              aria-label={translate("عبارة البحث في مكتبة الصور", language)}
              disabled={imageLoading}
            />
            {imageQuery && <button type="button" className="svg-logo-library-clear" onClick={() => { imageSearchRequestRef.current += 1; setImageQuery(""); setImageLibrary([]); setImageLoading(false); }} aria-label={translate("مسح البحث", language)}><X size={14} /></button>}
            <button type="submit" disabled={imageLoading || imageQuery.trim().length < 2}>
              {imageLoading ? <LoaderCircle className="svg-logo-spin" size={14} /> : <Search size={14} />}
              {translate("بحث", language)}
            </button>
          </form>
          <div className="svg-logo-library-grid">
            {imageLibrary.length === 0 && !imageLoading && imageQuery.trim() && <div className="svg-logo-library-empty">{translate("لا توجد نتائج مطابقة؛ جرّب كلمات أبسط أو باللغة الإنجليزية.", language)}</div>}
            {imageLibrary.length === 0 && !imageLoading && !imageQuery.trim() && <div className="svg-logo-library-empty">{translate("ابدأ الكتابة للبحث المباشر، ويمكن للـ AI اختيار النتائج المناسبة وإدراجها.", language)}</div>}
            {imageLibrary.map((asset) => (
              <article key={asset.id} className="svg-logo-library-item" title={`${asset.title} · ${asset.license}`}>
                <button type="button" className="svg-logo-library-preview" onClick={() => void insertAssetIntoCanvas(asset)}>
                  <img src={asset.thumbnail} alt={asset.title} onError={(event) => {
                    const image = event.currentTarget;
                    if (!asset.source || image.src === asset.source) return;
                    if (image.dataset.directFallback === "true") return;
                    image.dataset.directFallback = "true";
                    image.src = asset.source;
                  }} />
                  <span>{asset.title}</span>
                </button>
                <button type="button" className="svg-logo-library-import" onClick={() => void insertAssetIntoCanvas(asset)}>{translate("استيراد للوحة", language)}</button>
              </article>
            ))}
          </div>
        </>}
      </section>

      <div className="svg-logo-toolbar" aria-label={translate("أدوات المحرر", language)}>
        <div className="svg-logo-rotation-controls">
          <label><span>{translate("زاوية الدوران", language)}</span><input type="number" step="any" value={rotationDegrees} onChange={(event) => setRotationDegrees(event.target.value)} aria-label={translate("زاوية الدوران بالدرجات", language)} /></label>
          <button type="button" className="svg-logo-apply-angle" onClick={() => rotateSelected(Number(rotationDegrees))} disabled={!editorReady || toolbarBusy || rotationDegrees === ""}>{translate("تطبيق الزاوية", language)}</button>
          <button type="button" onClick={() => nudgeSelectedRotation(-15)} disabled={!editorReady || toolbarBusy} aria-label={translate("تدوير 15 درجة عكس عقارب الساعة", language)}>−15°</button>
          <button type="button" onClick={() => nudgeSelectedRotation(15)} disabled={!editorReady || toolbarBusy} aria-label={translate("تدوير 15 درجة مع عقارب الساعة", language)}>+15°</button>
        </div>
        <div className="svg-logo-order-controls">
          <button type="button" onClick={() => void applySelectionAction("front")} disabled={!editorReady || toolbarBusy}>{translate("للأمام", language)}</button>
          <button type="button" onClick={() => void applySelectionAction("back")} disabled={!editorReady || toolbarBusy}>{translate("للخلف", language)}</button>
          <button type="button" className="svg-logo-delete-action" onClick={() => void applySelectionAction("delete")} disabled={!editorReady || toolbarBusy}>{translate("حذف", language)}</button>
        </div>
      </div>

    </section>
  );
}
