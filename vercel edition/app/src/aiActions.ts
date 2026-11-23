import { FLOW_SHAPES } from "./flowchartTypes";

export type AppPage = "Overview" | "Projects" | "Flowchart" | "AI Chat" | "Speaking Trainer" | "Skills" | "Design" | "AI Planner" | "Markdown" | "AI Providers" | "Settings";

export type AIFlowchartData = {
  nodes: Array<{ id: string; label: string; shape?: string }>;
  edges: Array<{ source: string; target: string; label?: string }>;
};

export type AIPlannerData = { title: string; columns: string[]; rows: string[][] };

export type AIAppAction =
  | { type: "navigate"; page: AppPage }
  | { type: "task.create"; title: string; project?: string; difficulty?: "سهل" | "متوسط" | "صعب" }
  | { type: "task.update"; id: number; title?: string; project?: string; done?: boolean; difficulty?: "سهل" | "متوسط" | "صعب" }
  | { type: "task.delete"; id: number }
  | { type: "project.create"; name: string; description?: string }
  | { type: "project.update"; id: number; name?: string; description?: string; progress?: number }
  | { type: "project.delete"; id: number }
  | { type: "markdown.replace"; content: string }
  | { type: "flowchart.replace"; flowchart: AIFlowchartData }
  | { type: "planner.replace"; table: AIPlannerData }
  | { type: "logo.search_images"; query: string }
  | { type: "logo.generate"; prompt: string }
  | { type: "logo.set_title"; title: string }
  | { type: "skill.add"; label: string; shortcut: string; description: string; template: string }
  | { type: "skill.remove"; id: string }
  | { type: "provider.set_model"; providerId: string; model: string }
  | { type: "provider.set_default"; providerId: string }
  | { type: "settings.update"; compactMode?: boolean; defaultChatMode?: "auto" | "chat" }
  | { type: "workspace.create"; name: string }
  | { type: "workspace.switch"; id: string }
  | { type: "code.write_file"; path: string; content: string }
  | { type: "code.delete_file"; path: string }
  | { type: "code.open_file"; path: string; line?: number }
  | { type: "code.insert_text"; text: string }
  | { type: "code.replace_selection"; text: string }
  | { type: "code.execute_command"; commandId: string; arguments?: unknown[] }
  | { type: "code.run_command"; shell: "cmd" | "powershell" | "bash"; command: string }
  | { type: "code.git_pull" }
  | { type: "code.git_push" };

const APP_PAGES = new Set<AppPage>(["Overview", "Projects", "Flowchart", "AI Chat", "Speaking Trainer", "Skills", "Design", "AI Planner", "Markdown", "AI Providers", "Settings"]);
const DIFFICULTIES = new Set(["سهل", "متوسط", "صعب"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function parseFlowchart(value: unknown): AIFlowchartData | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length < 1 || value.nodes.length > 80 || value.edges.length > 160) return null;
  const nodes = value.nodes.flatMap((node) => {
    if (!isRecord(node)) return [];
    const id = shortText(node.id, 80);
    const label = shortText(node.label, 180);
    if (!id || !label) return [];
    const shape = typeof node.shape === "string" && FLOW_SHAPES.includes(node.shape as (typeof FLOW_SHAPES)[number]) ? node.shape : "process";
    return [{ id, label, shape }];
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (!nodes.length || ids.size !== nodes.length) return null;
  const edges = value.edges.flatMap((edge) => {
    if (!isRecord(edge)) return [];
    const source = shortText(edge.source, 80);
    const target = shortText(edge.target, 80);
    if (!ids.has(source) || !ids.has(target)) return [];
    return [{ source, target, ...(typeof edge.label === "string" ? { label: edge.label.slice(0, 120) } : {}) }];
  });
  if (edges.length !== value.edges.length) return null;
  return { nodes, edges };
}

function parsePlannerTable(value: unknown): AIPlannerData | null {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  const columns = value.columns.slice(0, 10).map((cell) => shortText(cell, 80));
  if (!columns.length || columns.some((column) => !column)) return null;
  const rows = value.rows.slice(0, 50).map((row) => Array.isArray(row) ? columns.map((_, index) => shortText(row[index], 500)) : []);
  if (rows.some((row) => row.length !== columns.length)) return null;
  return { title: shortText(value.title, 100) || "جدول من الذكاء الاصطناعي", columns, rows };
}

export function validateAIAppAction(value: unknown): AIAppAction | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "navigate":
      return typeof value.page === "string" && APP_PAGES.has(value.page as AppPage) ? { type: "navigate", page: value.page as AppPage } : null;
    case "task.create":
      return shortText(value.title, 180) ? { type: value.type, title: shortText(value.title, 180), project: shortText(value.project, 100) || undefined, difficulty: DIFFICULTIES.has(String(value.difficulty)) ? value.difficulty as "سهل" | "متوسط" | "صعب" : "متوسط" } : null;
    case "task.update":
      return Number.isSafeInteger(value.id) && Number(value.id) > 0 && [value.title, value.project, value.done, value.difficulty].some((item) => item !== undefined) ? {
        type: value.type, id: Number(value.id),
        ...(typeof value.title === "string" ? { title: shortText(value.title, 180) } : {}),
        ...(typeof value.project === "string" ? { project: shortText(value.project, 100) } : {}),
        ...(typeof value.done === "boolean" ? { done: value.done } : {}),
        ...(DIFFICULTIES.has(String(value.difficulty)) ? { difficulty: value.difficulty as "سهل" | "متوسط" | "صعب" } : {}),
      } : null;
    case "task.delete":
      return Number.isSafeInteger(value.id) && Number(value.id) > 0 ? { type: value.type, id: Number(value.id) } : null;
    case "project.create":
      return shortText(value.name, 100) ? { type: value.type, name: shortText(value.name, 100), description: shortText(value.description, 500) || "مشروع جديد" } : null;
    case "project.update":
      return Number.isSafeInteger(value.id) && Number(value.id) > 0 && [value.name, value.description, value.progress].some((item) => item !== undefined) ? {
        type: value.type, id: Number(value.id),
        ...(typeof value.name === "string" ? { name: shortText(value.name, 100) } : {}),
        ...(typeof value.description === "string" ? { description: shortText(value.description, 500) } : {}),
        ...(typeof value.progress === "number" && Number.isFinite(value.progress) ? { progress: Math.max(0, Math.min(100, Math.round(value.progress))) } : {}),
      } : null;
    case "project.delete":
      return Number.isSafeInteger(value.id) && Number(value.id) > 0 ? { type: value.type, id: Number(value.id) } : null;
    case "markdown.replace":
      return typeof value.content === "string" && value.content.length <= 30000 ? { type: value.type, content: value.content } : null;
    case "flowchart.replace": {
      const flowchart = parseFlowchart(value.flowchart);
      return flowchart ? { type: value.type, flowchart } : null;
    }
    case "planner.replace": {
      const table = parsePlannerTable(value.table);
      return table ? { type: value.type, table } : null;
    }
    case "logo.search_images":
      return shortText(value.query, 120) ? { type: value.type, query: shortText(value.query, 120) } : null;
    case "logo.generate":
      return shortText(value.prompt, 3000) ? { type: value.type, prompt: shortText(value.prompt, 3000) } : null;
    case "logo.set_title":
      return shortText(value.title, 60) ? { type: value.type, title: shortText(value.title, 60) } : null;
    case "skill.add":
      return shortText(value.label, 60) && shortText(value.template, 12000) ? {
        type: value.type, label: shortText(value.label, 60), shortcut: shortText(value.shortcut, 80) || "/skill",
        description: shortText(value.description, 180) || "مهارة أضافها AI", template: shortText(value.template, 12000),
      } : null;
    case "skill.remove":
      return shortText(value.id, 100) ? { type: value.type, id: shortText(value.id, 100) } : null;
    case "provider.set_model":
      return shortText(value.providerId, 100) && shortText(value.model, 160) ? { type: value.type, providerId: shortText(value.providerId, 100), model: shortText(value.model, 160) } : null;
    case "provider.set_default":
      return shortText(value.providerId, 100) ? { type: value.type, providerId: shortText(value.providerId, 100) } : null;
    case "settings.update":
      return typeof value.compactMode === "boolean" || value.defaultChatMode === "auto" || value.defaultChatMode === "chat" ? {
        type: value.type,
        ...(typeof value.compactMode === "boolean" ? { compactMode: value.compactMode } : {}),
        ...(value.defaultChatMode === "auto" || value.defaultChatMode === "chat" ? { defaultChatMode: value.defaultChatMode } : {}),
      } : null;
    case "workspace.create":
      return shortText(value.name, 80) ? { type: value.type, name: shortText(value.name, 80) } : null;
    case "workspace.switch":
      return shortText(value.id, 100) ? { type: value.type, id: shortText(value.id, 100) } : null;
    case "code.write_file": {
      const path = shortText(value.path, 240).replaceAll("\\", "/");
      if (!path || path.startsWith("/") || path.split("/").some((part) =>
        !part || part === "." || part === ".." || part.includes(":") ||
        /[<>:"|?*]/.test(part) || Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      ) || typeof value.content !== "string" || value.content.length > 200_000) return null;
      return { type: value.type, path, content: value.content };
    }
    case "code.delete_file":
    case "code.open_file": {
      const path = shortText(value.path, 240).replaceAll("\\", "/");
      if (!path || path.startsWith("/") || path.split("/").some((part) =>
        !part || part === "." || part === ".." || part.includes(":") ||
        /[<>:"|?*]/.test(part) || Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )) return null;
      if (value.type === "code.delete_file") return { type: value.type, path };
      return value.line === undefined || (Number.isSafeInteger(value.line) && Number(value.line) > 0)
        ? { type: value.type, path, ...(value.line === undefined ? {} : { line: Number(value.line) }) }
        : null;
    }
    case "code.insert_text":
    case "code.replace_selection":
      return typeof value.text === "string" && value.text.length <= 50_000
        ? { type: value.type, text: value.text }
        : null;
    case "code.execute_command": {
      if (typeof value.commandId !== "string" || !/^[\w.-]{1,200}$/.test(value.commandId) ||
        (value.arguments !== undefined && !Array.isArray(value.arguments))) return null;
      const args = Array.isArray(value.arguments) ? value.arguments : undefined;
      if (args && (args.length > 10 || JSON.stringify(args).length > 50_000)) return null;
      return { type: value.type, commandId: value.commandId, ...(args ? { arguments: args } : {}) };
    }
    case "code.run_command":
      return (value.shell === "cmd" || value.shell === "powershell" || value.shell === "bash") &&
        typeof value.command === "string" && value.command.trim().length > 0 &&
        value.command.length <= 2_000
        ? { type: value.type, shell: value.shell, command: value.command }
        : null;
    case "code.git_pull":
    case "code.git_push":
      return { type: value.type };
    default:
      return null;
  }
}

export function describeAIAppAction(action: AIAppAction) {
  switch (action.type) {
    case "navigate": return `فتح قسم ${action.page}`;
    case "task.create": return `إضافة مهمة: ${action.title}`;
    case "task.update": return `تعديل المهمة #${action.id}`;
    case "task.delete": return `حذف المهمة #${action.id}`;
    case "project.create": return `إنشاء مشروع: ${action.name}`;
    case "project.update": return `تعديل المشروع #${action.id}`;
    case "project.delete": return `حذف المشروع #${action.id} ومهامه`;
    case "markdown.replace": return "استبدال مستند Markdown";
    case "flowchart.replace": return `تطبيق مخطط من ${action.flowchart.nodes.length} مرحلة`;
    case "planner.replace": return `إنشاء جدول «${action.table.title}»`;
    case "logo.search_images": return `البحث عن صور: ${action.query}`;
    case "logo.generate": return "توليد تصميم شعار";
    case "logo.set_title": return `تسمية التصميم: ${action.title}`;
    case "skill.add": return `إضافة مهارة: ${action.label}`;
    case "skill.remove": return `حذف مهارة #${action.id}`;
    case "provider.set_model": return `تغيير موديل المزوّد إلى ${action.model}`;
    case "provider.set_default": return "تغيير المزوّد الافتراضي";
    case "settings.update": return "تعديل إعدادات مساحة العمل";
    case "workspace.create": return `إنشاء مساحة: ${action.name}`;
    case "workspace.switch": return `تغيير مساحة العمل إلى #${action.id}`;
    case "code.write_file": return `كتابة الملف ${action.path} في مشروع TF CODE`;
    case "code.delete_file": return `حذف الملف ${action.path} من مشروع TF CODE`;
    case "code.open_file": return `فتح الملف ${action.path}${action.line ? ` عند السطر ${action.line}` : ""} في VS Code`;
    case "code.insert_text": return "إدراج نص عند موضع المؤشر في VS Code";
    case "code.replace_selection": return "استبدال النص المحدد في VS Code";
    case "code.execute_command": return `تشغيل أمر VS Code: ${action.commandId}`;
    case "code.run_command": return `تشغيل أمر ${action.shell} على الكمبيوتر: ${action.command}`;
    case "code.git_pull": return "سحب التغييرات من مستودع Git المرتبط في VS Code";
    case "code.git_push": return "رفع التغييرات المحفوظة إلى مستودع Git المرتبط في VS Code";
  }
}
