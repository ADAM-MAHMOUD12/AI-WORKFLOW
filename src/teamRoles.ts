export type TeamRole = {
  id: string;
  actor: string;
  phase: string;
  instructions: string;
  markdown: string;
  enabled: boolean;
};

export const TEAM_ROLES_STORAGE_KEY = "taskflow-code-team-roles-v1";
export const MAX_TEAM_ROLES = 8;

const defaultRoles: TeamRole[] = [
  {
    id: "designer",
    actor: "المصمم",
    phase: "التصميم وتجربة الاستخدام",
    instructions: "استخدم مهارة UI/UX Pro Max المدمجة: افحص الواجهة وأنماط المشروع أولًا، ثم قدّم تصميمًا أصليًا مناسبًا للمنتج لا قالبًا عامًا. راعِ التباين وإمكانية الوصول والتنقل بلوحة المفاتيح، حالات التحميل والفراغ والخطأ، أحجام اللمس، والاستجابة للشاشات الصغيرة بلا تمرير أفقي. ناقش ملاحظات الأدوار السابقة بدل تكرارها. يمكنك تعديل ملفات الواجهة داخل مساحة العمل أو تشغيل أدوات المعاينة والتحقق عند الحاجة.",
    markdown: "",
    enabled: true,
  },
  {
    id: "programmer",
    actor: "المبرمج",
    phase: "التنفيذ البرمجي",
    instructions: "افحص الملفات ذات الصلة والسياق الحالي، ثم نفّذ حلًا كاملًا بأقل تغيير متماسك. اتبع أنماط المشروع والمساعدات الموجودة، حافظ على أمان الأنواع، ولا تثبت اعتمادية دون حاجة. ناقش اقتراح المصمم أو صحّحه بأسباب محددة. استخدم أوامر المحرر والطرفية عند الحاجة، وسجّل كل تعديل وأمر قبل تنفيذه.",
    markdown: "",
    enabled: true,
  },
  {
    id: "debugger-tester",
    actor: "الديباجر والاختبار",
    phase: "التصحيح والتحقق",
    instructions: "استخدم مهارة التصحيح والاختبار: افحص التشخيصات والتغييرات ومخرجات الأوامر، واعزل السبب الجذري بدل التخمين. شغّل أصغر اختبار أو فحص موجود وملائم، واذكر الأمر ورمز الخروج والنتيجة الفعلية. إذا فشل الاختبار، ناقش المبرمج أو اقترح إصلاحًا محددًا، ثم أعد التحقق بعد التعديل. لا تدّع نجاحًا دون نتيجة فعلية برمز خروج صفر.",
    markdown: "",
    enabled: true,
  },
].map((role) => ({
  ...role,
  markdown: `---\nname: ${role.actor}\nphase: ${role.phase}\n---\n\n${role.instructions}`,
}));

function readField(frontmatter: string, field: string) {
  const value = frontmatter.match(new RegExp(`^\\s*${field}\\s*:\\s*(.*?)\\s*$`, "im"))?.[1]?.trim() ?? "";
  return value.replace(/^(["'])(.*)\1$/, "$2").slice(0, field === "name" ? 60 : 100);
}

export function parseTeamRoleMarkdown(markdown: string, id: string, fallbackName = ""): TeamRole | null {
  const normalized = markdown.trim().replace(/\r\n?/g, "\n");
  if (!normalized || normalized.length > 16_000 || normalized.includes("\0")) return null;
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  const actor = match ? readField(match[1], "name") : "";
  const phase = match ? readField(match[1], "phase") : "";
  const promptField = match?.[1].match(/^\s*(?:instructions?|template|prompt|content)\s*:\s*(?:[|>][-+]?\s*\n((?:[ \t]+.*(?:\n|$))+)|(.+))$/im);
  const frontmatterPrompt = promptField?.[1]?.replace(/^[ \t]+/gm, "").trim() ?? promptField?.[2]?.trim() ?? "";
  const instructions = (match?.[2].trim() || frontmatterPrompt || (match ? "" : normalized)).trim();
  if (!instructions) return null;
  const memberName = fallbackName || id.replace(/[-_]+/g, " ").trim();
  return {
    id,
    actor: actor || memberName.slice(0, 60) || "عضو فريق",
    phase: phase || "مهمة الفريق",
    instructions,
    markdown: normalized,
    enabled: true,
  };
}

export function readTeamRoles(): TeamRole[] {
  try {
    const saved = localStorage.getItem(TEAM_ROLES_STORAGE_KEY);
    if (!saved) return defaultRoles;
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return defaultRoles;
    const roles = parsed.flatMap((item): TeamRole[] => {
      if (!item || typeof item !== "object" || !("id" in item) ||
        typeof item.id !== "string" || !("markdown" in item) ||
        typeof item.markdown !== "string") return [];
      const role = parseTeamRoleMarkdown(item.markdown, item.id);
      return role ? [{ ...role, enabled: !("enabled" in item) || item.enabled !== false }] : [];
    }).slice(0, MAX_TEAM_ROLES);
    return roles.length ? roles : defaultRoles;
  } catch {
    return defaultRoles;
  }
}

export function createTeamRoleMarkdown(actor: string, phase: string, instructions = "اكتب تعليمات واضحة لمسؤوليات هذا العضو وحدود عمله.") {
  return `---\nname: ${actor}\nphase: ${phase}\n---\n\n${instructions}`;
}
