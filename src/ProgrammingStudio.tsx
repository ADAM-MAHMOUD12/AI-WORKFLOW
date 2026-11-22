import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, Check, Code2, ExternalLink, Library, LoaderCircle, Link2, MessageCircle, Puzzle, RotateCw, Sparkles, Unlink } from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import {
  checkVscodeBridge,
  connectVscodeBridge,
  clearVscodeBridgeToken,
  disconnectVscodeBridge,
  getVscodeBridgeHealth,
  getVscodeBridgeMode,
  sendVscodeBridgeHeartbeat,
  setVscodeBridgePort,
  setVscodeBridgeMode,
  type VscodeBridgeMode,
} from "./vscodeBridge";
import { parseSkillFileContent, readCustomSkills, skillSuggestions, toSkillShortcut, type SkillSuggestion } from "./skills";
import { writeAppData } from "./appData";
import "./ProgrammingStudio.css";

type ProgrammingProject = {
  id: string;
  name: string;
  files: Record<string, string>;
};

type ProgrammingWorkspace = {
  working_directory: string;
  files: Array<{ path: string; content: string }>;
  truncated: boolean;
};

const PROJECTS_KEY = "taskflow-programming-projects-v1";
const ACTIVE_PROJECT_KEY = "taskflow-programming-active-v1";
const LEGACY_PROJECTS_KEY = "taskflow.programming.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "taskflow.programming.active-project.v1";
const MAX_PROJECT_FILES = 60;
const MAX_CODE_FILE_LENGTH = 200_000;
type BridgeUiState = "checking" | "connecting" | "connected" | "disconnected" | "needs-pairing" | "error";
type TfCodeExtension = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  kind: string;
  official?: boolean;
};
type TfCodeLibrarySkill = { id: string; name: string; description: string; asset: string };
type PublicTfCodeSkill = { id: string; source: string; skill_id: string; name: string; installs: number; official: boolean };

const FALLBACK_EXTENSION_CATALOG: TfCodeExtension[] = [
  { id: "taskflow.taskflow-vscode-bridge", name: "TF CODE Agent Bridge", description: "ربط محرر VS Code بمحادثة TaskFlow والأوامر والتعديلات الحية.", publisher: "TaskFlow", kind: "bridge", official: true },
  { id: "ms-python.python", name: "Python", description: "تشغيل وتصحيح واختبار مشاريع Python داخل VS Code.", publisher: "Microsoft", kind: "language", official: true },
  { id: "ms-python.vscode-pylance", name: "Pylance", description: "تحليل وType Checking وإكمال ذكي لكود Python.", publisher: "Microsoft", kind: "language", official: true },
  { id: "ms-python.debugpy", name: "Python Debugger", description: "تصحيح بايثون ونقاط توقف وهندسة تشغيل الاختبارات.", publisher: "Microsoft", kind: "debug", official: true },
  { id: "GitHub.copilot-chat", name: "GitHub Copilot Chat", description: "محادثة ووكلاء GitHub Copilot داخل VS Code.", publisher: "GitHub", kind: "ai", official: true },
];

function createProject(): ProgrammingProject {
  return {
    id: crypto.randomUUID().replaceAll("-", ""),
    name: "مشروع جديد",
    files: { "main.py": 'print("Hello, TaskFlow")\n' },
  };
}

function readProjects(): ProgrammingProject[] {
  try {
    const saved = localStorage.getItem(PROJECTS_KEY) ?? localStorage.getItem(LEGACY_PROJECTS_KEY);
    if (!saved) return [createProject()];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [createProject()];
    const projects = parsed.filter((item): item is ProgrammingProject =>
      typeof item?.id === "string" &&
      /^[a-f0-9]{32}$/.test(item.id) &&
      typeof item.name === "string" &&
      item.files !== null &&
      typeof item.files === "object" &&
      !Array.isArray(item.files) &&
      Object.values(item.files).every((content) => typeof content === "string"),
    );
    return projects.length ? projects : [createProject()];
  } catch {
    return [createProject()];
  }
}

function workspaceFilesPayload(files: Record<string, string>) {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function parseWorkspace(value: unknown, fallbackDirectory?: string): ProgrammingWorkspace {
  const workingDirectory = value && typeof value === "object" && !Array.isArray(value) &&
    "working_directory" in value && typeof value.working_directory === "string"
    ? value.working_directory
    : fallbackDirectory;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !workingDirectory ||
    !("files" in value) || !Array.isArray(value.files) ||
    !("truncated" in value) || typeof value.truncated !== "boolean") {
    throw new Error("استجابة مساحة عمل TF CODE غير صالحة.");
  }
  const files = value.files.flatMap((item): ProgrammingWorkspace["files"] => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      !("path" in item) || typeof item.path !== "string" ||
      !("content" in item) || typeof item.content !== "string") return [];
    return [{ path: item.path, content: item.content }];
  });
  return { working_directory: workingDirectory, files, truncated: value.truncated };
}

function cachedFiles(files: ProgrammingWorkspace["files"]) {
  const result: Record<string, string> = {};
  let truncated = false;
  for (const file of files) {
    if (Object.keys(result).length >= MAX_PROJECT_FILES || file.content.length > MAX_CODE_FILE_LENGTH) {
      truncated = true;
      continue;
    }
    result[file.path] = file.content;
  }
  return { files: result, truncated };
}

function responseDetail(value: unknown, fallback: string) {
  return value && typeof value === "object" && "detail" in value && typeof value.detail === "string"
    ? value.detail
    : fallback;
}

export default function ProgrammingStudio({
  onExit,
  onOpenAgent,
}: {
  onExit: () => void;
  onOpenAgent: () => void;
}) {
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [bridgeState, setBridgeState] = useState<BridgeUiState>("checking");
  const [bridgeMode, setBridgeMode] = useState<VscodeBridgeMode>(getVscodeBridgeMode);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchStatus, setLaunchStatus] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"extensions" | "skills">("extensions");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryBusyId, setLibraryBusyId] = useState("");
  const [libraryNotice, setLibraryNotice] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [extensionCatalog, setExtensionCatalog] = useState<TfCodeExtension[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<string[]>([]);
  const [taskflowSkills, setTaskflowSkills] = useState<TfCodeLibrarySkill[]>([]);
  const [publicSkills, setPublicSkills] = useState<PublicTfCodeSkill[]>([]);
  const [publicSkillSearch, setPublicSkillSearch] = useState("");
  const [publicSkillsLoading, setPublicSkillsLoading] = useState(false);
  const [installedSkillIds, setInstalledSkillIds] = useState<string[]>([]);
  const [customSkillCount, setCustomSkillCount] = useState(0);
  const bridgeOperation = useRef(false);
  const projectId = localStorage.getItem(ACTIVE_PROJECT_KEY) ?? localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
  const invalidProjectId = !projectId || !/^[a-f0-9]{32}$/.test(projectId);

  useEffect(() => {
    const openLibraryFromApp = () => void openLibrary("extensions");
    window.addEventListener("taskflow:open-tf-code-library", openLibraryFromApp);
    if (window.location.hash === "#tf-code-library" || new URLSearchParams(window.location.search).has("tf-code-library")) {
      openLibraryFromApp();
    }
    return () => window.removeEventListener("taskflow:open-tf-code-library", openLibraryFromApp);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const projects = readProjects();
        const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY) ??
          localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
        const project = projects.find((item) => item.id === activeId) ?? projects[0];
        if (!project) throw new Error("تعذّر إنشاء مساحة عمل TF CODE.");

        const response = await apiFetch(`${API_BASE}/api/programming/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            project_id: project.id,
            files: workspaceFilesPayload(project.files),
          }),
        });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(responseDetail(body, "تعذّر تجهيز مساحة عمل TF CODE."));

        const workspace = parseWorkspace(body);
        const cached = cachedFiles(workspace.files);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.map((item) =>
          item.id === project.id ? { ...item, files: cached.files } : item)));
        localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        localStorage.setItem("taskflow-programming-directory-v1", workspace.working_directory);
        if (!active) return;
        setProjectName(project.name);
        setWorkspaceDirectory(workspace.working_directory);
        setSyncWarning(workspace.truncated || cached.truncated
          ? "بعض الملفات كبيرة أو كثيرة جدًا لمزامنتها مع ذاكرة المنصة؛ تظل كاملة داخل المحرر."
          : "");
      } catch (reason) {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "تعذّر تجهيز مساحة عمل TF CODE.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!workspaceDirectory || invalidProjectId) return undefined;
    let active = true;
    let checking = false;
    const refreshBridgeStatus = async (refreshPresence = false) => {
      if (checking || bridgeBusy) return;
      checking = true;
      try {
        if (refreshPresence) await sendVscodeBridgeHeartbeat(projectId);
        const health = await getVscodeBridgeHealth(workspaceDirectory, projectId);
        if (!active) return;
        if (!health.paired && !health.authorized) clearVscodeBridgeToken(projectId);
        if (health.paired && health.paired_origin !== window.location.origin) {
          clearVscodeBridgeToken(projectId);
          setBridgeState("needs-pairing");
          setBridgeError(
            `الإضافة مرتبطة بالعنوان ${health.paired_origin || "غير معروف"}، لكن المنصة الحالية على ${window.location.origin}. أعد الربط المباشر ووافق من VS Code.`,
          );
          return;
        }
        const connected = await checkVscodeBridge(projectId, workspaceDirectory);
        if (active) {
          if (connected) {
            setBridgeState("connected");
            setBridgeError("");
            return;
          }
          setBridgeState(health.authorized ? "needs-pairing" : "disconnected");
          setBridgeError(health.paired
            ? "عنوان المنصة متطابق، لكن جلسة الربط غير صالحة أو مفقودة. أعد الربط المباشر ووافق من VS Code."
            : health.running
              ? "الإضافة تعمل؛ اضغط على الربط المباشر ووافق على نافذة VS Code."
              : "افتح VS Code واترك مساحة مشروع TF CODE مفتوحة، ثم أعد فحص الاتصال.");
        }
      } catch (reason) {
        if (active) {
          if (reason instanceof TypeError) {
            setBridgeState("disconnected");
            setBridgeError("إضافة TF CODE غير جاهزة بعد. اترك VS Code مفتوحًا واستخدم صفحة TaskFlow المحلية، أو أعد تشغيل VS Code بعد تحديث الإضافة.");
          } else {
            setBridgeState("error");
            setBridgeError(reason instanceof Error ? reason.message : "تعذّر فحص اتصال VS Code.");
          }
        }
      } finally {
        checking = false;
      }
    };
    void refreshBridgeStatus(true);
    const timer = window.setInterval(() => void refreshBridgeStatus(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workspaceDirectory, invalidProjectId, projectId, bridgeBusy]);

  useEffect(() => {
    if (!workspaceDirectory) return undefined;
    let active = true;
    let syncing = false;
    if (invalidProjectId) return undefined;

    const synchronizeProject = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const response = await apiFetch(`${API_BASE}/api/programming/workspace/${encodeURIComponent(projectId)}`);
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(responseDetail(body, "تعذّرت مزامنة ملفات المشروع."));
        const workspace = parseWorkspace(body, workspaceDirectory);
        const cached = cachedFiles(workspace.files);
        if (!active) return;
        const latestProjects = readProjects();
        const latest = latestProjects.find((item) => item.id === projectId);
        if (!latest) {
          setError("تعذّر العثور على المشروع المحفوظ لمزامنة الملفات.");
          return;
        }
        if (JSON.stringify(latest.files) !== JSON.stringify(cached.files)) {
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(latestProjects.map((item) =>
            item.id === projectId ? { ...item, files: cached.files } : item)));
        }
        setSyncWarning(workspace.truncated || cached.truncated
          ? "بعض ملفات المشروع تجاوزت حد المزامنة؛ تظل كاملة داخل TF CODE."
          : "");
      } catch (reason) {
        if (active) setSyncWarning(reason instanceof Error ? reason.message : "تعذّرت مزامنة ملفات المشروع.");
      } finally {
        syncing = false;
      }
    };

    const timer = window.setInterval(() => void synchronizeProject(), 2_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workspaceDirectory, invalidProjectId, projectId]);

  const visibleError = error || (workspaceDirectory && invalidProjectId
    ? "معرّف مشروع TF CODE غير صالح؛ أعد فتح مساحة البرمجة."
    : "");

  async function openVscodeWorkspace(): Promise<number> {
    if (!projectId || !/^[a-f0-9]{32}$/.test(projectId)) {
      throw new Error("معرّف مشروع TF CODE غير صالح؛ أعد فتح مساحة البرمجة.");
    }
    const response = await apiFetch(`${API_BASE}/api/programming/launch-vscode/${encodeURIComponent(projectId)}`, {
      method: "POST",
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("خدمة TF CODE الخلفية تعمل بإصدار قديم ولا تحتوي أمر تجهيز VS Code. أغلق TaskFlow وأعد تشغيل start-all.bat لتحديث الخدمة.");
      }
      throw new Error(responseDetail(body, "تعذّر تجهيز VS Code أو فتح مساحة المشروع."));
    }
    if (!body || typeof body !== "object" || !("launched" in body) || body.launched !== true ||
      !("bridge_port" in body) || typeof body.bridge_port !== "number" ||
      !Number.isInteger(body.bridge_port)) {
      throw new Error("استجابة تجهيز VS Code غير صالحة.");
    }
    return body.bridge_port;
  }

  async function unpairVscodeExtension() {
    if (bridgeOperation.current) return;
    bridgeOperation.current = true;
    setBridgeBusy(true);
    setBridgeState("connecting");
    setBridgeError("");
    try {
      await disconnectVscodeBridge(projectId);
      setBridgeState("disconnected");
      setBridgeError("");
    } catch (reason) {
      setBridgeState("error");
      setBridgeError(reason instanceof Error ? reason.message : "تعذّر فصل إضافة VS Code.");
    } finally {
      setBridgeBusy(false);
      bridgeOperation.current = false;
    }
  }

  async function openLibrary(tab: "extensions" | "skills" = "extensions") {
    setLibraryTab(tab);
    setLibraryOpen(true);
    setLibraryLoading(true);
    setLibraryError("");
    setLibraryNotice("");
    setExtensionCatalog(FALLBACK_EXTENSION_CATALOG);
    setCustomSkillCount(readCustomSkills().length);
    try {
      const [catalogResult, installedResult, skillsResult, appDataResult, publicSkillsResult] = await Promise.allSettled([
        apiFetch(`${API_BASE}/api/programming/extensions/catalog`),
        apiFetch(`${API_BASE}/api/programming/extensions/installed`),
        fetch("https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/catalog.json", {
          headers: { Accept: "application/json" },
        }),
        apiFetch(`${API_BASE}/api/data/skills`),
        apiFetch(`${API_BASE}/api/skills/library/popular`),
      ]);

      if (catalogResult.status === "fulfilled" && catalogResult.value.ok) {
        const catalogBody: unknown = await catalogResult.value.json();
        if (catalogBody && typeof catalogBody === "object" && "extensions" in catalogBody && Array.isArray(catalogBody.extensions)) {
          const catalog = catalogBody.extensions.filter((item): item is TfCodeExtension =>
            typeof item === "object" && item !== null &&
            "id" in item && typeof item.id === "string" &&
            "name" in item && typeof item.name === "string");
          if (catalog.length) setExtensionCatalog(catalog);
        }
      }

      if (installedResult.status === "fulfilled" && installedResult.value.ok) {
        const installedBody: unknown = await installedResult.value.json();
        if (installedBody && typeof installedBody === "object" && "extensions" in installedBody && Array.isArray(installedBody.extensions)) {
          setInstalledExtensions(installedBody.extensions.flatMap((item) =>
            typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" ? [item.id.toLowerCase()] : []));
        }
      }

      if (skillsResult.status === "fulfilled" && skillsResult.value.ok) {
        const skillsCatalog: unknown = await skillsResult.value.json();
        if (skillsCatalog && typeof skillsCatalog === "object" && "skills" in skillsCatalog && Array.isArray(skillsCatalog.skills)) {
          setTaskflowSkills(skillsCatalog.skills.filter((item): item is TfCodeLibrarySkill =>
            typeof item === "object" && item !== null &&
            "id" in item && typeof item.id === "string" &&
            "name" in item && typeof item.name === "string" &&
            "description" in item && typeof item.description === "string" &&
            "asset" in item && typeof item.asset === "string"));
        }
      }

      if (appDataResult.status === "fulfilled" && appDataResult.value.ok) {
        const appDataBody: unknown = await appDataResult.value.json();
        if (appDataBody && typeof appDataBody === "object" && "value" in appDataBody && Array.isArray(appDataBody.value)) {
          setCustomSkillCount(appDataBody.value.length);
          setInstalledSkillIds(appDataBody.value.flatMap((item) =>
            typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" ? [item.id] : []));
        }
      }

      if (publicSkillsResult.status === "fulfilled" && publicSkillsResult.value.ok) {
        const publicBody: unknown = await publicSkillsResult.value.json();
        if (publicBody && typeof publicBody === "object" && "skills" in publicBody && Array.isArray(publicBody.skills)) {
          setPublicSkills(publicBody.skills.filter((item): item is PublicTfCodeSkill =>
            typeof item === "object" && item !== null &&
            "source" in item && typeof item.source === "string" &&
            "skill_id" in item && typeof item.skill_id === "string" &&
            "name" in item && typeof item.name === "string"));
        }
      }
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "تعذّر تحميل مكتبات TaskFlow.");
    } finally {
      setLibraryLoading(false);
    }
  }

  async function searchPublicSkills() {
    const query = publicSkillSearch.trim();
    if (query.length < 2) {
      setLibraryError("اكتب حرفين على الأقل للبحث في مكتبة skills.sh.");
      return;
    }
    setPublicSkillsLoading(true);
    setLibraryError("");
    try {
      const response = await apiFetch(`${API_BASE}/api/skills/library/search?q=${encodeURIComponent(query)}`);
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "تعذّر البحث في skills.sh.");
      if (body && typeof body === "object" && "skills" in body && Array.isArray(body.skills)) {
        setPublicSkills(body.skills.filter((item): item is PublicTfCodeSkill =>
          typeof item === "object" && item !== null &&
          "source" in item && typeof item.source === "string" &&
          "skill_id" in item && typeof item.skill_id === "string" &&
          "name" in item && typeof item.name === "string"));
      }
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "تعذّر البحث في skills.sh.");
    } finally {
      setPublicSkillsLoading(false);
    }
  }

  async function loadAccountSkills() {
    const response = await apiFetch(`${API_BASE}/api/data/skills`);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(responseDetail(body, "تعذّر تحميل مهارات حساب TaskFlow."));
    if (!body || typeof body !== "object" || !("value" in body)) {
      throw new Error("استجابة مهارات حساب TaskFlow غير صالحة.");
    }
    if (body.value === null) return [];
    if (!Array.isArray(body.value)) throw new Error("استجابة مهارات حساب TaskFlow غير صالحة.");
    return body.value.filter((item): item is SkillSuggestion =>
      typeof item === "object" && item !== null &&
      "id" in item && typeof item.id === "string" &&
      "label" in item && typeof item.label === "string" &&
      "shortcut" in item && typeof item.shortcut === "string" &&
      "description" in item && typeof item.description === "string" &&
      "template" in item && typeof item.template === "string" &&
      "accent" in item && typeof item.accent === "string");
  }

  function syncAccountSkills(skills: SkillSuggestion[]) {
    setCustomSkillCount(skills.length);
    setInstalledSkillIds(skills.map((item) => item.id));
    window.dispatchEvent(new CustomEvent("taskflow:ai-skills-updated", { detail: skills }));
  }

  async function installPublicSkill(skill: PublicTfCodeSkill) {
    setLibraryBusyId(`skill:${skill.source}/${skill.skill_id}`);
    setLibraryError("");
    setLibraryNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/skills/library/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: skill.source, skill_id: skill.skill_id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : "تعذّر تثبيت المهارة.");
      if (!body || typeof body !== "object" || !("verified" in body) || body.verified !== true ||
        !("target" in body) || body.target !== "taskflow-account" ||
        !("skill" in body) || !body.skill || typeof body.skill !== "object") {
        throw new Error("لم يكتمل حفظ المهارة في حساب TaskFlow.");
      }
      const installedSkillId = `skills-sh:${skill.source}/${skill.skill_id}`;
      const savedSkills = await loadAccountSkills();
      if (!savedSkills.some((item) => item.id === installedSkillId)) {
        throw new Error("لم تظهر المهارة في بيانات حساب TaskFlow بعد الحفظ.");
      }
      syncAccountSkills(savedSkills);
      setLibraryNotice(`أُضيفت ${skill.name} إلى حساب TaskFlow؛ يمكنك استدعاؤها بكتابة / داخل محادثة الموقع أو TF CODE.`);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "تعذّر حفظ المهارة في حساب TaskFlow.");
    } finally {
      setLibraryBusyId("");
    }
  }

  async function installTaskflowSkill(skill: TfCodeLibrarySkill) {
    const id = `taskflow-${skill.id}`;
    setLibraryBusyId(`skill:${id}`);
    setLibraryError("");
    setLibraryNotice("");
    try {
      if (!/^skills\/[a-z0-9-]+\/SKILL\.md$/.test(skill.asset)) throw new Error("مسار ملف المهارة غير صالح.");
      const response = await fetch(`https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/${skill.asset}`, {
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) throw new Error(`تعذّر تحميل مهارة TaskFlow (${response.status}).`);
      const parsed = parseSkillFileContent(`${id}/SKILL.md`, await response.text());
      if (!parsed) throw new Error("تعذّر قراءة تعليمات المهارة.");
      const imported: SkillSuggestion = {
        ...parsed,
        id,
        label: skill.name,
        shortcut: toSkillShortcut(skill.name),
        description: skill.description || parsed.description,
        source: "TaskFlow Skills",
        kind: "custom",
      };
      const currentSkills = await loadAccountSkills();
      if (currentSkills.some((item) => item.id === id)) {
        syncAccountSkills(currentSkills);
        setLibraryNotice(`المهارة ${skill.name} مضافة بالفعل إلى حساب TaskFlow.`);
        return;
      }
      const nextSkills = [imported, ...currentSkills];
      await writeAppData("skills", nextSkills);
      syncAccountSkills(nextSkills);
      setLibraryNotice(`أُضيفت ${skill.name} إلى حساب TaskFlow؛ يمكنك استدعاؤها بكتابة / داخل محادثة الموقع أو TF CODE.`);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "تعذّر حفظ مهارة TaskFlow في حسابك.");
    } finally {
      setLibraryBusyId("");
    }
  }

  async function installLibraryExtension(extension: TfCodeExtension) {
    setLibraryBusyId(extension.id);
    setLibraryError("");
    setLibraryNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/programming/extensions/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extension_id: extension.id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : "تعذّر تثبيت الإضافة.");
      }
      setInstalledExtensions((current) => current.includes(extension.id.toLowerCase())
        ? current
        : [...current, extension.id.toLowerCase()]);
      setLibraryNotice(`تم تثبيت ${extension.name}. أعد تحميل نافذة VS Code إذا ظهرت الإضافة في وضع المتابعة.`);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "تعذّر تثبيت الإضافة.");
    } finally {
      setLibraryBusyId("");
    }
  }

  function launchVscode() {
    if (bridgeOperation.current || launchBusy || bridgeBusy) return;
    const approved = window.confirm(
      "السماح لـ TF CODE بتجهيز Visual Studio Code؟\n\nسيتحقق من VS Code، يثبت الإضافة المضمّنة عند الحاجة، ويفتح مجلد المشروع."
    );
    if (approved) void confirmLaunchVscode();
  }

  async function confirmLaunchVscode() {
    if (bridgeOperation.current || launchBusy || bridgeBusy) return;
    bridgeOperation.current = true;
    setLaunchBusy(true);
    setLaunchStatus("جارٍ تجهيز VS Code وفتح المشروع وانتظار تشغيل إضافة TF CODE...");
    setLaunchError("");
    setBridgeState("connecting");
    setBridgeError("");
    try {
      const bridgePort = await openVscodeWorkspace();
      setVscodeBridgePort(projectId, bridgePort);
      const health = await getVscodeBridgeHealth(workspaceDirectory, projectId);
      if (health.workspace_directory === undefined ||
        health.workspace_directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() !==
          workspaceDirectory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()) {
        throw new Error("VS Code فتح مجلدًا مختلفًا عن مساحة TF CODE المطلوبة.");
      }

      const paired = await connectVscodeBridge(projectId, workspaceDirectory, bridgePort);
      if (!paired) {
        throw new Error("لم يتم الربط بعد. وافق على نافذة TF CODE في VS Code ثم حاول الزر مرة أخرى.");
      }

      const verified = await checkVscodeBridge(projectId, workspaceDirectory);
      if (!verified) {
        clearVscodeBridgeToken(projectId);
        throw new Error("تمت الموافقة لكن التحقق من VS Code لم يكتمل. اضغط الزر مرة أخرى.");
      }

      setBridgeState("connected");
      setBridgeError("");
      setLaunchStatus("تم تجهيز VS Code وإضافة TF CODE، وفتح المجلد وربط الإضافة بنجاح.");
    } catch (reason) {
      setLaunchStatus("");
      setLaunchError(reason instanceof Error ? reason.message : "تعذّر تجهيز VS Code وربطه.");
      setBridgeState("error");
      setBridgeError(reason instanceof Error ? reason.message : "تعذّر ربط VS Code.");
    } finally {
      setLaunchBusy(false);
      bridgeOperation.current = false;
    }
  }

  function chooseBridgeMode(mode: VscodeBridgeMode) {
    setBridgeMode(mode);
    setVscodeBridgeMode(mode);
  }

  const bridgeConnected = bridgeState === "connected";
  const bridgeChecking = bridgeState === "checking" || bridgeState === "connecting";
  const bridgeStatusLabel: Record<BridgeUiState, string> = {
    checking: "جارٍ فحص الاتصال...",
    connecting: "جارٍ الربط...",
    connected: "تم الربط",
    disconnected: "غير متصل",
    "needs-pairing": "يلزم إعادة الربط",
    error: "تعذّر التحقق",
  };
  const bridgeStatusDescription: Record<BridgeUiState, string> = {
    checking: "جارٍ التحقق من إضافة VS Code وجلسة المنصة.",
    connecting: "يتم فتح مساحة المشروع وطلب موافقتك في VS Code.",
    connected: "تم الربط مع الإضافة ومجلد المشروع المفتوح.",
    disconnected: "اضغط زر إعداد وفتح TF CODE؛ سيفحص VS Code ويثبت الإضافة ويربط المشروع بعد موافقتك.",
    "needs-pairing": "الإضافة تعمل، لكن يلزم تأكيد الربط من جديد داخل VS Code.",
    error: "تعذّر التحقق من حالة الإضافة. راجع التفاصيل وحاول مجددًا.",
  };
  const StatusIcon = bridgeChecking ? LoaderCircle
    : bridgeConnected ? Check
      : bridgeState === "error" || bridgeState === "needs-pairing" ? AlertTriangle : Link2;

  return (
    <main className="program-tf-code">
      <header className="program-tf-code-header">
        <div className="program-tf-code-brand">
          <Code2 size={22} aria-hidden="true" />
          <div>
            <h1>TF CODE</h1>
            <p>{projectName || "بيئة البرمجة"} · Microsoft Visual Studio Code</p>
          </div>
        </div>
        <nav className="program-tf-code-actions" aria-label="إجراءات محرر TF CODE">
          <button type="button" onClick={onOpenAgent}>
            <MessageCircle size={16} aria-hidden="true" />
            محادثة البرمجة
          </button>
          <button type="button" className="secondary" onClick={onExit}>
            العودة إلى المنصة
          </button>
        </nav>
      </header>

      <div className="program-workbench-grid">
      <section className="program-tf-code-body" aria-live="polite">
        {loading ? (
          <div className="program-tf-code-card" role="status">
            <LoaderCircle className="program-spin" size={24} aria-hidden="true" />
            <p>جارٍ تجهيز مساحة المشروع لويندوز...</p>
          </div>
        ) : visibleError ? (
          <div className="program-tf-code-card error" role="alert">
            <p>{visibleError}</p>
            <button type="button" onClick={() => window.location.reload()}>
              <RotateCw size={15} aria-hidden="true" /> إعادة المحاولة
            </button>
          </div>
        ) : (
          <div className="program-tf-code-card">
            <Code2 size={32} aria-hidden="true" />
            <h2>افتح مساحة عملك في TF CODE</h2>
            <p>يجهّز Visual Studio Code وإضافة TF CODE عند الحاجة، ثم يفتح مساحة المشروع على ويندوز.</p>
            <div className="program-tf-code-launch-actions">
              <button className="program-tf-code-launch" type="button" onClick={() => void launchVscode()} disabled={launchBusy}>
                {launchBusy ? <LoaderCircle className="program-spin" size={17} aria-hidden="true" /> : <ExternalLink size={17} aria-hidden="true" />}
                {launchBusy ? "جارٍ تجهيز VS Code..." : "تجهيز وفتح TF CODE"}
              </button>
              <button className="program-tf-code-library-button" type="button" onClick={() => void openLibrary("extensions")}>
                <Puzzle size={17} /> مكتبة الإضافات والمهارات
              </button>
            </div>
            <p className="program-tf-code-setup-note">
              يفحص البرنامج وجود VS Code؛ إذا لم يجده، ينزّل مُثبّت المستخدم الرسمي من Microsoft ويتحقق من توقيعه قبل تثبيته دون صلاحيات مسؤول. ثم يضيف إضافة TF CODE المضمّنة إن لم تكن موجودة ويفتح هذا المشروع.
            </p>
            {launchBusy && <p className="program-tf-code-warning" role="status">{launchStatus} قد يستغرق تنزيل VS Code وتثبيته عدة دقائق.</p>}
            {!launchBusy && launchStatus && <p className="program-tf-code-success" role="status">{launchStatus}</p>}
            {launchError && <p className="program-tf-code-error" role="alert">{launchError}</p>}
            {syncWarning && <p className="program-tf-code-warning" role="status">{syncWarning}</p>}
            <small dir="ltr">{workspaceDirectory}</small>
          </div>
        )}
      </section>

      {libraryOpen && (
        <section className="tf-code-library" role="dialog" aria-modal="true" aria-labelledby="tf-code-library-title">
          <div className="tf-code-library-shell">
            <header className="tf-code-library-header">
              <div>
                <span className="tf-code-library-kicker"><Library size={14} /> مكتبة TF CODE</span>
                <h2 id="tf-code-library-title">الإضافات والمهارات الخاصة</h2>
              </div>
              <button type="button" className="tf-code-library-close" onClick={() => setLibraryOpen(false)} aria-label="إغلاق المكتبة">×</button>
            </header>

            <div className="tf-code-library-tabs" role="tablist" aria-label="مكتبات TF CODE">
              <button type="button" role="tab" aria-selected={libraryTab === "extensions"} className={libraryTab === "extensions" ? "active" : ""} onClick={() => setLibraryTab("extensions")}>
                <Puzzle size={16} /> مكتبة الإضافات
              </button>
              <button type="button" role="tab" aria-selected={libraryTab === "skills"} className={libraryTab === "skills" ? "active" : ""} onClick={() => setLibraryTab("skills")}>
                <Sparkles size={16} /> مكتبة المهارات
              </button>
            </div>

            {libraryNotice && <p className="tf-code-library-notice" role="status">{libraryNotice}</p>}
            {libraryError && <p className="tf-code-library-error" role="alert">{libraryError}</p>}

            {libraryLoading ? (
              <div className="tf-code-library-state" role="status"><LoaderCircle className="program-spin" size={22} /> جارٍ تحميل المكتبة...</div>
            ) : libraryTab === "extensions" ? (
              <div className="tf-code-library-grid">
                {extensionCatalog.map((extension) => {
                  const installed = installedExtensions.includes(extension.id.toLowerCase());
                  const busy = libraryBusyId === extension.id;
                  return (
                    <article className="tf-code-library-card" key={extension.id}>
                      <div className="tf-code-library-card-icon"><Puzzle size={20} /></div>
                      <div className="tf-code-library-card-copy">
                        <strong>{extension.name}</strong>
                        <small>{extension.publisher} · {extension.kind}</small>
                        <p>{extension.description}</p>
                      </div>
                      <button type="button" className={installed ? "tf-code-library-installed" : ""} disabled={installed || busy || Boolean(libraryBusyId)} onClick={() => void installLibraryExtension(extension)}>
                        {installed ? <><Check size={15} /> مثبتة</> : busy ? <><LoaderCircle className="program-spin" size={15} /> جارٍ التثبيت</> : <><Boxes size={15} /> تثبيت</>}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tf-code-skills-library">
                <article className="tf-code-skill-summary">
                  <Sparkles size={20} />
                  <div><strong>مهارات AI TaskFlow وskills.sh</strong><p>{customSkillCount + skillSuggestions.length} مهارة متاحة لحسابك. أضف مهارة مرة واحدة، ثم استدعها بكتابة / في شات TaskFlow أو TF CODE.</p></div>
                </article>

                <form className="tf-code-skill-search" onSubmit={(event) => { event.preventDefault(); void searchPublicSkills(); }}>
                  <input value={publicSkillSearch} onChange={(event) => setPublicSkillSearch(event.target.value)} minLength={2} maxLength={100} placeholder="ابحث عن React أو Python أو الاختبارات..." aria-label="البحث في skills.sh" />
                  <button type="submit" disabled={publicSkillsLoading}>{publicSkillsLoading ? <LoaderCircle className="program-spin" size={15} /> : <Sparkles size={15} />} بحث</button>
                </form>

                <div className="tf-code-library-grid tf-code-public-skills">
                  {publicSkills.map((skill) => {
                    const localId = `skills-sh:${skill.source}/${skill.skill_id}`;
                    const installed = installedSkillIds.includes(localId);
                    const busy = libraryBusyId === `skill:${skill.source}/${skill.skill_id}`;
                    return (
                      <article className="tf-code-library-card" key={localId}>
                        <div className="tf-code-library-card-icon"><Sparkles size={20} /></div>
                        <div className="tf-code-library-card-copy"><strong>{skill.name}</strong><small dir="ltr">{skill.source} · {skill.installs.toLocaleString()} installs{skill.official ? " · official" : ""}</small><p>مهارة عامة من مكتبة skills.sh.</p></div>
                        <button type="button" className={installed ? "tf-code-library-installed" : ""} disabled={installed || busy || Boolean(libraryBusyId)} onClick={() => void installPublicSkill(skill)}>
                          {installed ? <><Check size={15} /> مضافة للحساب</> : busy ? <><LoaderCircle className="program-spin" size={15} /> جارٍ الحفظ</> : <><Boxes size={15} /> إضافة إلى TaskFlow</>}
                        </button>
                      </article>
                    );
                  })}
                </div>

                {taskflowSkills.length > 0 && <div className="tf-code-official-skills"><h3>مهارات TaskFlow الرسمية</h3><div className="tf-code-library-grid">{taskflowSkills.map((skill) => (
                  <article className="tf-code-library-card" key={skill.id}><div className="tf-code-library-card-icon"><Sparkles size={20} /></div><div className="tf-code-library-card-copy"><strong>{skill.name}</strong><small>مهارة TaskFlow الرسمية</small><p>{skill.description}</p></div><button type="button" className={installedSkillIds.includes(`taskflow-${skill.id}`) ? "tf-code-library-installed" : ""} disabled={installedSkillIds.includes(`taskflow-${skill.id}`) || Boolean(libraryBusyId)} onClick={() => void installTaskflowSkill(skill)}>{installedSkillIds.includes(`taskflow-${skill.id}`) ? <><Check size={15} /> مضافة للحساب</> : libraryBusyId === `skill:taskflow-${skill.id}` ? <><LoaderCircle className="program-spin" size={15} /> جارٍ الحفظ</> : <><Boxes size={15} /> إضافة إلى TaskFlow</>}</button></article>
                ))}</div></div>}
              </div>
            )}
          </div>
        </section>
      )}

      {!loading && !visibleError && <section className="program-vscode-bridge" aria-labelledby="program-vscode-bridge-title">
        <div className="program-vscode-bridge-heading">
          <div>
            <h2 id="program-vscode-bridge-title">تحكم وكيل TF CODE في VS Code</h2>
            <p>{bridgeStatusDescription[bridgeState]}</p>
          </div>
          <span className={`program-vscode-state ${bridgeConnected ? "connected" : `state-${bridgeState}`}`} role="status" aria-live="polite">
            <StatusIcon className={bridgeChecking ? "program-spin" : undefined} size={14} aria-hidden="true" />
            {bridgeStatusLabel[bridgeState]}
          </span>
        </div>
        <label className="program-vscode-mode">
          <span>طريقة تنفيذ إجراءات الوكيل</span>
          <select value={bridgeMode} disabled={bridgeBusy} onChange={(event) => chooseBridgeMode(event.target.value === "automatic" ? "automatic" : "review")}>
            <option value="review">مراجعة كل إجراء قبل التنفيذ</option>
            <option value="automatic">تنفيذ تلقائي بعد رد الوكيل</option>
          </select>
        </label>
        {bridgeMode === "automatic" && <p className="program-vscode-auto-warning" role="note">
          <AlertTriangle size={15} aria-hidden="true" />
          الوضع التلقائي قد يشغّل أوامر طرفية أوامرها من المزوّد وتغيّر ملفات المشروع. عطّله للعودة للمراجعة.
        </p>}
        {bridgeConnected && <button className="program-vscode-disconnect" type="button" onClick={() => void unpairVscodeExtension()} disabled={bridgeBusy}>
          <Unlink size={15} aria-hidden="true" /> فصل إضافة VS Code
        </button>}
        {bridgeBusy && launchStatus && <p className="program-vscode-pair-status" role="status">{launchStatus}</p>}
        {!bridgeBusy && launchError && <p className="program-vscode-error" role="alert">{launchError}</p>}
        {bridgeError && <p className="program-vscode-error" role="alert">{bridgeError}</p>}
      </section>}
      {!loading && !visibleError && <aside className="program-workflow" aria-labelledby="program-workflow-title">
        <div className="program-workflow-heading">
          <span><Sparkles size={15} aria-hidden="true" /> مساعد البرمجة</span>
          <h2 id="program-workflow-title">من طلبك إلى تغيير فعلي</h2>
          <p>اطلب ما تريد بلغتك، وسيراجع المساعد ملفات مساحة العمل قبل اقتراح التعديلات.</p>
        </div>
        <ol className="program-workflow-steps">
          <li><span><Check size={15} aria-hidden="true" /></span><div><strong>يفهم المشروع</strong><small>يستخدم ملفات مساحة العمل والملف المفتوح عند توفرهما.</small></div></li>
          <li><span><Check size={15} aria-hidden="true" /></span><div><strong>يعرض التعديلات</strong><small>راجع الملفات والأوامر المقترحة قبل تطبيقها.</small></div></li>
          <li><span><Check size={15} aria-hidden="true" /></span><div><strong>يتحقق من النتيجة</strong><small>تظهر مخرجات التنفيذ والاختبارات كما أعادها VS Code.</small></div></li>
        </ol>
        <div className="program-workflow-actions">
          <button type="button" onClick={onOpenAgent}><MessageCircle size={16} aria-hidden="true" /> ابدأ محادثة برمجية</button>
          <button type="button" className="secondary" onClick={() => void openLibrary("skills")}><Sparkles size={16} aria-hidden="true" /> مهارات الحساب</button>
        </div>
        <p className="program-workflow-hint">في محادثة VS Code اكتب <kbd>/</kbd> لاختيار مهارة من حسابك.</p>
      </aside>}
      </div>
    </main>
  );
}
