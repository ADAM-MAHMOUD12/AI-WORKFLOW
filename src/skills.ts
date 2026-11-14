export type SkillSuggestion = {
  id: string;
  label: string;
  shortcut: string;
  description: string;
  template: string;
  accent: string;
  kind?: "builtin" | "custom";
  source?: string;
};

export const CUSTOM_SKILLS_STORAGE_KEY = "taskflow-custom-skills-v1";
export const SKILL_FILE_ACCEPT = ".md,.mdx,.markdown,.txt,.text,.rst,.adoc,.json,.yaml,.yml,.xml,.prompt,.prompt.md,.instructions,.instructions.md,.agent,.agent.md,.toml,.mdc,.rules,.cursorrules,.windsurfrules,.clinerules,.roorules,.skill";

export const skillSuggestions: SkillSuggestion[] = [
  { id: "plan", label: "خطة المشروع", shortcut: "/plan", description: "صياغة خطة تنفيذية واضحة", template: "اكتب خطة تنفيذية واضحة للمشروع مع الأهداف والمهام والتسلسل الزمني.", accent: "#4f46e5", kind: "builtin" },
  { id: "brainstorm", label: "عصف ذهني", shortcut: "/brainstorm", description: "توليد أفكار ومقترحات", template: "عِد لي أفكارًا مبتكرة ومقترحات عملية لتحسين المشروع.", accent: "#f59e0b", kind: "builtin" },
  { id: "research", label: "بحث وتقييم", shortcut: "/research", description: "بحث وتحليل سريع", template: "قم ببحث سريع وتحليل للموضوع مع نقاط القوة والضعف والاقتراحات.", accent: "#10b981", kind: "builtin" },
  { id: "debug", label: "تصحيح", shortcut: "/debug", description: "حل مشكلة برمجية", template: "ساعدني في تصحيح المشكلة بشكل منهجي مع سببها والحل المقترح.", accent: "#ef4444", kind: "builtin" },
  { id: "summarize", label: "تلخيص", shortcut: "/summarize", description: "تلخيص نص أو فكرة", template: "لخص الفكرة التالية بشكل مختصر مع النقاط المهمة والنتائج.", accent: "#06b6d4", kind: "builtin" },
  { id: "content", label: "كتابة محتوى", shortcut: "/content", description: "كتابة نصوص ورسائل", template: "اكتب محتوى احترافي ومقنع باللغة العربية مناسبًا للهدف المطلوب.", accent: "#8b5cf6", kind: "builtin" },
  {
    id: "ui-ux-designer",
    label: "مصمم UI/UX",
    shortcut: "/ui-ux-designer",
    description: "تصميم واجهات مميزة وعملية ومتناسقة مع المنتج بدل القوالب المعتادة.",
    template: `تصرف كمصمم UI/UX ومهندس واجهات خبير. صمّم التجربة حول المستخدم ومهمته الأساسية، وابدأ بفهم نوع المنتج والجمهور وسياق الصفحة قبل اختيار الشكل. ابتعد عن المخرجات النمطية: لا تستخدم تلقائيًا Hero ضخمًا، بطاقات متكررة، تدرجات بنفسجية، خلفيات داكنة أو تخطيط SaaS عام ما لم يناسب المنتج فعلًا. اختر اتجاهًا بصريًا واضحًا ومقصودًا يناسب المجال، مع لوحة ألوان متوازنة، تسلسل بصري قوي، طباعة ذات شخصية، ومساحات محسوبة. فضّل واجهات فعلية قابلة للاستخدام ومحتوى واقعيًا بدل نصوص حشو أو وصف للميزة. اجعل التنقل والإجراءات الأساسية واضحة، والحالات كاملة (تحميل، فراغ، نجاح، خطأ، تعطيل)، والتخطيط متجاوبًا على الهاتف وسطح المكتب. راعِ التباين، لوحة المفاتيح، دلالات HTML، وتسميات الوصول. استخدم مكونات وأيقونات وأدوات المشروع الموجودة واتبع نظامه البصري عند تعديل واجهة قائمة؛ لا تغيّر النظام العام بلا داعٍ. قبل إنهاء التصميم افحص تزاحم العناصر، التفاف النص، أحجام الأزرار، واتساق المسافات، ثم لخّص الاتجاه وقرارات الاستخدام باقتضاب. إذا كان الطلب تنفيذًا على موقع قائم، افحص الملفات والأنماط الحالية أولًا ثم نفّذ التغيير داخلها بدل اقتراح تصميم منفصل.`,
    accent: "#14b8a6",
    kind: "builtin",
  },
];

export const quickSkillPresets: Record<string, SkillSuggestion> = {
  claude: { id: "preset-claude", label: "Claude", shortcut: "/claude", description: "أسلوب-Claude: ردود متقنة ومنظمة", template: "تحدث بصيغة Claude: قدم إجابة منظمة، دقيقة، وقابلة للتنفيذ مع شرح موجز للأسباب والخيارات.", accent: "#a855f7", kind: "custom", source: "preset" },
  gpt: { id: "preset-gpt", label: "GPT", shortcut: "/gpt", description: "أسلوب GPT: تطوير سريع ومباشر", template: "تحدث بصيغة GPT: أجب بطريقة مباشرة ومفيدة، مع حلول عملية ومخطط خطوة بخطوة إن لزم الأمر.", accent: "#22c55e", kind: "custom", source: "preset" },
  gemini: { id: "preset-gemini", label: "Gemini", shortcut: "/gemini", description: "أسلوب Gemini: منتج ومفصل", template: "تحدث بصيغة Gemini: قدم إجابة واضحة ومفصلة، مع مثال عملي وملخص سريع في نهاية الرد.", accent: "#3b82f6", kind: "custom", source: "preset" },
};

export function toSkillShortcut(label: string) {
  return `/${label.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-+|-+$/g, "") || "skill"}`;
}

function skillColorFromSeed(seed: string) {
  const palette = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#f97316"];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return palette[hash % palette.length];
}

export function readCustomSkills(): SkillSuggestion[] {
  try {
    const saved = localStorage.getItem(CUSTOM_SKILLS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as Partial<SkillSuggestion>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<SkillSuggestion> => item && typeof item === "object")
      .map((item, index) => ({
        id: item.id || `${item.label || "custom-skill"}-${index}`,
        label: item.label || "مهارة مخصصة",
        shortcut: item.shortcut || toSkillShortcut(item.label || "مهارة مخصصة"),
        description: item.description || "مهارة مخصصة",
        template: item.template || "",
        accent: item.accent || skillColorFromSeed(item.label || `custom-${index}`),
        kind: item.kind || "custom",
        source: item.source || "local",
      }))
      .filter((skill) => skill.template.trim().length > 0);
  } catch {
    return [];
  }
}

export function writeCustomSkills(skills: SkillSuggestion[]) {
  localStorage.setItem(CUSTOM_SKILLS_STORAGE_KEY, JSON.stringify(skills));
}

function normalizeSkillSuggestion(raw: Partial<SkillSuggestion>, fallbackName: string): SkillSuggestion | null {
  const label = (raw.label || raw.id || fallbackName || "مهارة مخصصة").trim();
  const template = (raw.template || raw.description || "").trim();
  if (!label || !template) return null;
  return {
    id: raw.id || `${label}-${crypto.randomUUID()}`,
    label,
    shortcut: raw.shortcut || toSkillShortcut(label),
    description: raw.description || "مهارة مخصصة",
    template,
    accent: raw.accent || skillColorFromSeed(label),
    kind: raw.kind || "custom",
    source: raw.source || "upload",
  };
}

export function parseSkillFileContent(fileName: string, content: string): SkillSuggestion | null {
  const trimmed = content.trim();
  if (!trimmed || trimmed.includes("\0")) return null;

  const fileParts = fileName.replace(/\\/g, "/").split("/");
  const baseName = fileParts[fileParts.length - 1].replace(/\.(?:prompt|instructions|agent)?\.(?:md|markdown)$/i, "").replace(/\.[^.]+$/, "");
  const fallbackLabel = (baseName.toLowerCase() === "skill" ? fileParts[fileParts.length - 2] : baseName)?.replace(/[_-]+/g, " ").trim() || "مهارة مخصصة";

  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const parsed = normalizeSkillSuggestion({
      id: typeof json.id === "string" ? json.id : undefined,
      label: typeof json.label === "string" ? json.label : typeof json.title === "string" ? json.title : typeof json.name === "string" ? json.name : undefined,
      shortcut: typeof json.shortcut === "string" ? json.shortcut : undefined,
      description: typeof json.description === "string" ? json.description : undefined,
      template: typeof json.template === "string" ? json.template : typeof json.prompt === "string" ? json.prompt : typeof json.instructions === "string" ? json.instructions : typeof json.content === "string" ? json.content : undefined,
      accent: typeof json.accent === "string" ? json.accent : undefined,
      kind: "custom",
      source: fileName,
    }, fallbackLabel);
    if (parsed) return parsed;
  } catch {
    // Continue with the text-based skill formats.
  }

  const normalized = trimmed.replace(/\r/g, "");
  const frontmatter = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  const metadata = frontmatter?.[1] ?? "";
  const body = frontmatter?.[2]?.trim() ?? normalized;
  const readField = (source: string, names: string[]) => {
    const match = source.match(new RegExp(`^\\s*(?:${names.join("|")})\\s*:\\s*(.*?)\\s*$`, "im"));
    return match?.[1]?.trim().replace(/^(?:["'])(.*)(?:["'])$/, "$1") ?? "";
  };
  const label = readField(metadata || normalized, ["name", "title", "label"]) || fallbackLabel;
  const description = readField(metadata || normalized, ["description", "summary", "about"]) || "مهارة مخصصة";
  const templateSource = metadata || normalized;
  const blockTemplate = templateSource.match(/^\s*(?:prompt|template|instruction|instructions)\s*:\s*[|>][-+]?\s*\n((?:[ \t]+.*(?:\n|$))*)/im)?.[1];
  const explicitTemplate = blockTemplate?.replace(/^\s+/gm, "").trim() || readField(templateSource, ["prompt", "template", "instruction", "instructions"]);
  const directTemplate = explicitTemplate || body.replace(/^#\s+.*$/gm, "").trim();
  return normalizeSkillSuggestion({ label, description, template: directTemplate || `${label}: ${description}`, source: fileName, kind: "custom" }, fallbackLabel);
}

export function isSupportedSkillFile(fileName: string) {
  const lower = fileName.toLowerCase();
  return [".md", ".mdx", ".markdown", ".txt", ".text", ".rst", ".adoc", ".json", ".yaml", ".yml", ".xml", ".prompt", ".instructions", ".agent", ".toml", ".mdc", ".rules", ".cursorrules", ".windsurfrules", ".clinerules", ".roorules", ".skill"].some((extension) => lower.endsWith(extension));
}

export function selectSkillFiles(files: File[]) {
  const supported = files.filter((file) => isSupportedSkillFile(file.name));
  const canonicalByFolder = new Map<string, File>();
  for (const file of supported) {
    if (file.name.toLowerCase() !== "skill.md") continue;
    canonicalByFolder.set(file.webkitRelativePath.split("/").slice(0, -1).join("/"), file);
  }
  if (!canonicalByFolder.size) return supported;
  const skillFolders = [...canonicalByFolder.keys()].filter(Boolean).sort((left, right) => right.length - left.length);
  return supported.filter((file) => {
    const folder = file.webkitRelativePath.split("/").slice(0, -1).join("/");
    const skillFolder = skillFolders.find((candidate) => folder === candidate || folder.startsWith(`${candidate}/`));
    if (skillFolder) return canonicalByFolder.get(skillFolder) === file;
    if (canonicalByFolder.has("")) return canonicalByFolder.get("") === file;
    return true;
  });
}