import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { API_BASE, apiFetch, getSessionToken, serviceUrl } from "./api";
import { useAuth } from "./authContext";
import "./ProgrammingStudio.css";

type ProgrammingProject = {
  id: string;
  name: string;
  files: Record<string, string>;
  repositoryFullName?: string;
};

type WorkspaceFile = { path: string; content: string };
type ProgrammingWorkspace = {
  working_directory: string;
  files: WorkspaceFile[];
  truncated: boolean;
};

const PROJECTS_KEY = "taskflow-programming-projects-v1";
const ACTIVE_PROJECT_KEY = "taskflow-programming-active-v1";
const LEGACY_PROJECTS_KEY = "taskflow.programming.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "taskflow.programming.active-project.v1";
const MAX_PROJECT_FILES = 60;
const MAX_CODE_FILE_LENGTH = 200_000;

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

function workspaceFilesPayload(files: Record<string, string>): WorkspaceFile[] {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function parseWorkspace(value: unknown): ProgrammingWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !("working_directory" in value) || typeof value.working_directory !== "string" ||
    !("files" in value) || !Array.isArray(value.files) ||
    !("truncated" in value) || typeof value.truncated !== "boolean") {
    throw new Error("استجابة مساحة عمل Theia غير صالحة.");
  }
  const files = value.files.flatMap((item): WorkspaceFile[] => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      !("path" in item) || typeof item.path !== "string" ||
      !("content" in item) || typeof item.content !== "string") return [];
    return [{ path: item.path, content: item.content }];
  });
  return {
    working_directory: value.working_directory,
    files,
    truncated: value.truncated,
  };
}

function cacheWorkspaceFiles(files: WorkspaceFile[]): { files: Record<string, string>; truncated: boolean } {
  const cached: Record<string, string> = {};
  let truncated = false;
  for (const file of files) {
    if (Object.keys(cached).length >= MAX_PROJECT_FILES || file.content.length > MAX_CODE_FILE_LENGTH) {
      truncated = true;
      continue;
    }
    cached[file.path] = file.content;
  }
  return { files: cached, truncated };
}

function workspacePathForTheia(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return encodeURI(normalized.startsWith("/") ? normalized : `/${normalized}`);
}

function detailFromResponse(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "detail" in value && typeof value.detail === "string"
    ? value.detail
    : fallback;
}

export default function ProgrammingStudio({ onExit }: { onExit: () => void }) {
  const { user } = useAuth();
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeRepository, setActiveRepository] = useState<{ projectId: string; fullName: string } | null>(null);
  const [cloneProgress, setCloneProgress] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const cloningRepository = useRef(false);

  const theiaOrigin = new URL(serviceUrl(3102)).origin;
  const theiaUrl = workspacePath
    ? `${serviceUrl(3102)}?taskflowParentOrigin=${encodeURIComponent(window.location.origin)}#${workspacePath}`
    : "";

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const projects = readProjects();
        const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY) ??
          localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
        const project = projects.find((item) => item.id === activeId) ?? projects[0];
        if (!project) throw new Error("تعذّر إنشاء مساحة عمل للبرمجة.");
        if (typeof project.repositoryFullName === "string") {
          setActiveRepository({ projectId: project.id, fullName: project.repositoryFullName });
        }

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
        if (!response.ok) {
          throw new Error(detailFromResponse(body, "تعذّر فتح مساحة عمل Theia."));
        }
        const workspace = parseWorkspace(body);
        const cachedWorkspace = cacheWorkspaceFiles(workspace.files);
        const restoredProjects = projects.map((item) =>
          item.id === project.id ? { ...item, files: cachedWorkspace.files } : item);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(restoredProjects));
        localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);

        if (active) {
          setWorkspacePath(workspacePathForTheia(workspace.working_directory));
          setError(workspace.truncated || cachedWorkspace.truncated
            ? "بعض الملفات كبيرة أو كثيرة جدًا؛ ستظل جميع ملفات مساحة Theia متاحة داخل المحرر."
            : "");
          setLoading(false);
        }
      } catch (reason) {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "تعذّر فتح مساحة Theia.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const currentFrame = frame.current;
    if (!workspacePath || !currentFrame) return;

    const sendInitialization = () => {
      currentFrame.contentWindow?.postMessage({
        type: "taskflow:initialize",
        apiBase: API_BASE,
        sessionToken: getSessionToken(),
        ...(activeRepository ? {
          projectId: activeRepository.projectId,
          repositoryFullName: activeRepository.fullName,
        } : {}),
      }, theiaOrigin);
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== currentFrame.contentWindow || event.origin !== theiaOrigin ||
        typeof event.data !== "object" || event.data === null || !("type" in event.data)) return;
      if (event.data.type === "taskflow:request-initialize") {
        sendInitialization();
        return;
      }
      if (event.data.type !== "taskflow:clone-github-repository" ||
        !("full_name" in event.data) || typeof event.data.full_name !== "string" ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(event.data.full_name) ||
        event.data.full_name.split("/").some((part) => part === "." || part === "..") ||
        cloningRepository.current) return;

      const fullName = event.data.full_name;
      cloningRepository.current = true;
      setCloneProgress(`جارٍ استنساخ ${fullName} إلى مساحة عمل جديدة. قد يستغرق ذلك بضع دقائق...`);
      void (async () => {
        const cloneController = new AbortController();
        const timeout = window.setTimeout(() => cloneController.abort(), 610_000);
        try {
          const projectId = crypto.randomUUID().replaceAll("-", "");
          const response = await apiFetch(`${API_BASE}/api/github/repositories/clone`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: cloneController.signal,
            body: JSON.stringify({ full_name: fullName, project_id: projectId }),
          });
          const body: unknown = await response.json();
          if (!response.ok) {
            throw new Error(detailFromResponse(body, `تعذّر فتح مستودع GitHub ${fullName}.`));
          }
          if (!body || typeof body !== "object" || Array.isArray(body) ||
            !("project_id" in body) || body.project_id !== projectId ||
            !("name" in body) || typeof body.name !== "string" ||
            !("working_directory" in body) || typeof body.working_directory !== "string") {
            throw new Error("استجابة فتح مستودع GitHub غير صالحة.");
          }

          const project: ProgrammingProject = {
            id: projectId,
            name: body.name,
            files: {},
            repositoryFullName: fullName,
          };
          const projects = readProjects().filter((item) => item.id !== projectId);
          localStorage.setItem(PROJECTS_KEY, JSON.stringify([...projects, project]));
          localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
          setActiveRepository({ projectId, fullName });
          setCloneProgress("");
          setError("");
          setLoading(true);
          setWorkspacePath(workspacePathForTheia(body.working_directory));
        } catch (reason) {
          const message = reason instanceof DOMException && reason.name === "AbortError"
            ? `انتهت مهلة استنساخ ${fullName}. تأكد من اتصال GitHub ثم أعد المحاولة.`
            : reason instanceof Error ? reason.message : `تعذّر فتح مستودع GitHub ${fullName}.`;
          setCloneProgress("");
          currentFrame.contentWindow?.postMessage({
            type: "taskflow:github-repository-error",
            message,
          }, theiaOrigin);
        } finally {
          window.clearTimeout(timeout);
          cloningRepository.current = false;
        }
      })();
    };

    window.addEventListener("message", handleMessage);
    currentFrame.addEventListener("load", sendInitialization);
    const refreshTimer = window.setInterval(sendInitialization, 30_000);
    sendInitialization();
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("message", handleMessage);
      currentFrame.removeEventListener("load", sendInitialization);
    };
  }, [activeRepository, onExit, theiaOrigin, user?.id, workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    let active = true;
    let syncing = false;
    const savedProjects = readProjects();
    const project = savedProjects.find((item) => item.id === localStorage.getItem(ACTIVE_PROJECT_KEY)) ?? savedProjects[0];
    if (!project) return;

    const synchronizeProject = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const response = await apiFetch(
          `${API_BASE}/api/programming/workspace/${encodeURIComponent(project.id)}`,
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(detailFromResponse(body, "تعذّرت مزامنة ملفات المشروع."));
        }
        const workspace = parseWorkspace({ ...(body as object), working_directory: "" });
        const cachedWorkspace = cacheWorkspaceFiles(workspace.files);
        if (!active) return;
        const latestProjects = readProjects();
        const latestProject = latestProjects.find((item) => item.id === project.id);
        if (!latestProject) {
          setError("تعذّر العثور على المشروع المحفوظ لمزامنة الملفات.");
          return;
        }
        if (JSON.stringify(latestProject.files) === JSON.stringify(cachedWorkspace.files)) return;
        const projects = latestProjects.map((item) =>
          item.id === project.id ? { ...item, files: cachedWorkspace.files } : item);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        setError(workspace.truncated || cachedWorkspace.truncated
          ? "بعض ملفات المشروع تجاوزت حد مزامنة المنصة؛ افتحها مباشرة من Theia."
          : "");
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّرت مزامنة ملفات المشروع.");
      } finally {
        syncing = false;
      }
    };

    const timer = window.setInterval(() => void synchronizeProject(), 2_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workspacePath]);

  return (
    <main className="program-theia-shell">
      {workspacePath && (
        <iframe
          ref={frame}
          className="program-theia-ide"
          title="AI TaskFlow Eclipse Theia IDE"
          src={theiaUrl}
          allow="clipboard-read; clipboard-write"
          onLoad={() => setLoading(false)}
        />
      )}
      {loading && (
        <div className="program-theia-loading" role="status">
          <LoaderCircle className="program-spin" size={24} aria-hidden="true" />
          <span>جارٍ تجهيز مساحة المشروع داخل Eclipse Theia...</span>
        </div>
      )}
      {cloneProgress && (
        <div className="program-theia-loading" role="status">
          <LoaderCircle className="program-spin" size={24} aria-hidden="true" />
          <span>{cloneProgress}</span>
        </div>
      )}
      {error && (
        <div className="program-theia-status" role="alert">
          <span>{error}</span>
          {!workspacePath && (
            <button type="button" onClick={onExit}>Return to AI TASKFLOW</button>
          )}
        </div>
      )}
    </main>
  );
}
