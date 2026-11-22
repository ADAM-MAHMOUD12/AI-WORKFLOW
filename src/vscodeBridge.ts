import type { AIAppAction } from "./aiActions";
import { API_BASE, getSessionToken } from "./api";

const BRIDGE_PORT_START = 17391;
const BRIDGE_PORT_COUNT = 20;
const MODE_KEY = "taskflow-vscode-agent-mode-v1";

export type VscodeBridgeMode = "review" | "automatic";
export type VscodeBridgeHealth = {
  running: boolean;
  paired: boolean;
  authorized: boolean;
  paired_origin: string;
  workspace_directory?: string;
  bridge_port: number;
};

export type VscodeEditorContext = {
  workspace: string;
  active_file: string;
  selection: string;
  diagnostics: Array<{
    file: string;
    severity: string;
    line: number;
    message: string;
  }>;
};

function tokenKey(projectId: string) {
  return `taskflow-vscode-bridge-token:${projectId}`;
}

function portKey(projectId: string) {
  return `taskflow-vscode-bridge-port:${projectId}`;
}

function storedBridgePort(projectId: string) {
  const port = Number(localStorage.getItem(portKey(projectId)));
  return Number.isInteger(port) && port >= BRIDGE_PORT_START &&
    port < BRIDGE_PORT_START + BRIDGE_PORT_COUNT ? port : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getVscodeBridgeMode(): VscodeBridgeMode {
  return localStorage.getItem(MODE_KEY) === "automatic" ? "automatic" : "review";
}

export function setVscodeBridgeMode(mode: VscodeBridgeMode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function getVscodeBridgeToken(projectId: string) {
  return localStorage.getItem(tokenKey(projectId));
}

export function getActiveVscodeBridgeProjectId() {
  const projectId = localStorage.getItem("taskflow-programming-active-v1") ??
    localStorage.getItem("taskflow.programming.active-project.v1");
  return projectId && /^[a-f0-9]{32}$/.test(projectId) ? projectId : null;
}

export function clearVscodeBridgeToken(projectId: string) {
  localStorage.removeItem(tokenKey(projectId));
  localStorage.removeItem(portKey(projectId));
}

export async function sendVscodeBridgeHeartbeat(projectId: string): Promise<boolean> {
  const token = getVscodeBridgeToken(projectId);
  const sessionToken = getSessionToken();
  if (!token || !sessionToken) return false;
  try {
    await bridgeRequest("/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        api_origin: API_BASE,
        session_token: sessionToken,
      }),
    }, token, getBridgePort(projectId));
    return true;
  } catch (reason) {
    if (reason instanceof VscodeBridgeRequestError &&
      [401, 403, 404].includes(reason.status)) {
      clearVscodeBridgeToken(projectId);
      return false;
    }
    throw reason;
  }
}

function getBridgePort(projectId: string) {
  return storedBridgePort(projectId) ?? BRIDGE_PORT_START;
}

export function setVscodeBridgePort(projectId: string, port: number) {
  if (!Number.isInteger(port) || port < BRIDGE_PORT_START ||
    port >= BRIDGE_PORT_START + BRIDGE_PORT_COUNT) {
    throw new Error("منفذ إضافة VS Code غير صالح.");
  }
  localStorage.setItem(portKey(projectId), String(port));
}

export function normalizeVscodeWorkspacePath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

async function readBridgeHealth(port: number): Promise<VscodeBridgeHealth | null> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/health`);
  } catch (reason) {
    if (reason instanceof TypeError) return null;
    throw reason;
  }
  if (!response.ok) return null;
  let value: unknown;
  try {
    value = await response.json();
  } catch (reason) {
    if (reason instanceof SyntaxError) return null;
    throw reason;
  }
  if (!isRecord(value) || typeof value.running !== "boolean" ||
    typeof value.paired !== "boolean" || typeof value.paired_origin !== "string" ||
    (value.authorized !== undefined && typeof value.authorized !== "boolean") ||
    (value.workspace_directory !== undefined && typeof value.workspace_directory !== "string")) return null;
  return {
    running: value.running,
    paired: value.paired,
    authorized: value.authorized === true,
    paired_origin: value.paired_origin,
    workspace_directory: typeof value.workspace_directory === "string"
      ? value.workspace_directory : undefined,
    bridge_port: port,
  };
}

async function findVscodeBridges(
  knownPort: number,
  workspaceDirectory?: string,
): Promise<VscodeBridgeHealth[]> {
  const known = await readBridgeHealth(knownPort);
  const target = workspaceDirectory
    ? normalizeVscodeWorkspacePath(workspaceDirectory)
    : undefined;
  if (known && (!target || (known.workspace_directory &&
    normalizeVscodeWorkspacePath(known.workspace_directory) === target))) {
    return [known];
  }
  const ports = Array.from({ length: BRIDGE_PORT_COUNT }, (_, index) =>
    BRIDGE_PORT_START + index).filter((port) => port !== knownPort);
  const otherBridges = await Promise.all(ports.map(readBridgeHealth));
  return [known, ...otherBridges].filter(
    (health): health is VscodeBridgeHealth => health !== null,
  );
}

export async function getVscodeBridgeHealth(
  workspaceDirectory?: string,
  projectId?: string,
): Promise<VscodeBridgeHealth> {
  const port = projectId ? storedBridgePort(projectId) : undefined;
  if (port === undefined) {
    throw new TypeError("تعذّر الوصول إلى إضافة VS Code على هذا الجهاز.");
  }
  const available = await findVscodeBridges(port, workspaceDirectory);
  if (workspaceDirectory) {
    const target = normalizeVscodeWorkspacePath(workspaceDirectory);
    const matchingWorkspace = available.find((health) =>
      health.workspace_directory !== undefined &&
      normalizeVscodeWorkspacePath(health.workspace_directory) === target);
    if (matchingWorkspace) {
      if (projectId) setVscodeBridgePort(projectId, matchingWorkspace.bridge_port);
      return matchingWorkspace;
    }
  }
  if (available.length) return available.find((health) => health.paired) ?? available[0];
  throw new TypeError("تعذّر الوصول إلى إضافة VS Code على هذا الجهاز.");
}

async function bridgeRequest(
  path: string,
  init: RequestInit = {},
  token?: string,
  port = BRIDGE_PORT_START,
  onProgress?: (output: string) => void,
  signal?: AbortSignal,
) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers, signal: signal ?? init.signal });
  const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") === true;
  if (response.ok && isEventStream) {
    if (!response.body) throw new Error("استجابة بث VS Code لا تحتوي على بيانات.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: unknown;
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      if (done && buffer.trim()) frames.push(buffer);
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const event: unknown = JSON.parse(dataLine.slice(5).trim());
        if (!isRecord(event) || typeof event.type !== "string") continue;
        if (event.type === "output" && typeof event.text === "string") onProgress?.(event.text);
        else if (event.type === "error" && typeof event.message === "string") throw new Error(event.message);
        else if (event.type === "done") {
          result = event.result;
          finished = true;
        }
      }
      if (done && !finished) throw new Error("انقطع بث تنفيذ VS Code قبل اكتماله.");
    }
    return result;
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = value && typeof value === "object" && "detail" in value &&
      typeof value.detail === "string" ? value.detail : "تعذّر التواصل مع إضافة VS Code.";
    throw new VscodeBridgeRequestError(detail, response.status);
  }
  return value;
}

export async function connectVscodeBridge(
  projectId: string,
  workspaceDirectory: string,
  bridgePort: number,
): Promise<boolean> {
  const bridges = await findVscodeBridges(bridgePort, workspaceDirectory);
  const taskflowSessionToken = getSessionToken();
  if (!taskflowSessionToken) throw new Error("سجّل الدخول إلى TaskFlow قبل ربط المحادثة الجانبية في VS Code.");
  for (const health of bridges) {
    try {
      let result: unknown;
      try {
        result = await bridgeRequest("/pair/approve", {
          method: "POST",
          body: JSON.stringify({
            project_id: projectId,
            workspace_directory: workspaceDirectory,
            api_origin: API_BASE,
            session_token: taskflowSessionToken,
          }),
        }, undefined, health.bridge_port);
      } catch (reason) {
        if (!(reason instanceof VscodeBridgeRequestError) || reason.status !== 404) throw reason;
        const started = await bridgeRequest("/pair/start", {
          method: "POST",
          body: JSON.stringify({ workspace_directory: workspaceDirectory }),
        }, undefined, health.bridge_port);
        if (!isRecord(started) || typeof started.code !== "string" ||
          typeof started.workspace_directory !== "string") {
          throw new Error("استجابة الموافقة من إضافة VS Code غير صالحة.", { cause: reason });
        }
        if (normalizeVscodeWorkspacePath(started.workspace_directory) !==
          normalizeVscodeWorkspacePath(workspaceDirectory)) continue;
        result = await bridgeRequest("/pair", {
          method: "POST",
          body: JSON.stringify({
            code: started.code,
            project_id: projectId,
            workspace_directory: workspaceDirectory,
            api_origin: API_BASE,
            session_token: taskflowSessionToken,
          }),
        }, undefined, health.bridge_port);
      }

      if (!isRecord(result) || typeof result.token !== "string" ||
        typeof result.paired_origin !== "string" || typeof result.workspace_directory !== "string") {
        throw new Error("استجابة الربط غير مكتملة. حدّث إضافة TF CODE ثم أعد المحاولة.");
      }
      if (result.paired_origin !== window.location.origin) {
        throw new Error("عنوان المنصة تغيّر أثناء الربط. أعد الموافقة من VS Code.");
      }
      if (normalizeVscodeWorkspacePath(result.workspace_directory) !==
        normalizeVscodeWorkspacePath(workspaceDirectory)) continue;

      localStorage.setItem(tokenKey(projectId), result.token);
      localStorage.setItem(portKey(projectId), String(health.bridge_port));
      return true;
    } catch (reason) {
      if (reason instanceof VscodeBridgeRequestError && reason.status === 409) continue;
      if (reason instanceof VscodeBridgeRequestError && reason.status === 404) continue;
      throw reason;
    }
  }
  return false;
}

class VscodeBridgeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "VscodeBridgeRequestError";
    this.status = status;
  }
}

export async function disconnectVscodeBridge(projectId: string) {
  const token = getVscodeBridgeToken(projectId);
  if (!token) return;
  const port = getBridgePort(projectId);
  await bridgeRequest("/disconnect", { method: "POST", body: JSON.stringify({}) }, token, port);
  clearVscodeBridgeToken(projectId);
}

export async function checkVscodeBridge(projectId: string, workspaceDirectory: string) {
  const context = await readVscodeEditorContext(projectId);
  if (!context) return false;
  if (normalizeVscodeWorkspacePath(context.workspace) !== normalizeVscodeWorkspacePath(workspaceDirectory)) {
    throw new Error("إضافة VS Code متصلة بمجلد مختلف؛ افتح مساحة TF CODE نفسها.");
  }
  return true;
}

export async function readVscodeEditorContext(projectId: string): Promise<VscodeEditorContext | null> {
  const token = getVscodeBridgeToken(projectId);
  if (!token) return null;
  const port = getBridgePort(projectId);
  try {
    const value = await bridgeRequest("/context", {}, token, port);
    if (!isRecord(value) || typeof value.workspace !== "string" ||
      typeof value.active_file !== "string" || typeof value.selection !== "string" ||
      !Array.isArray(value.diagnostics)) {
      throw new Error("سياق إضافة VS Code غير صالح.");
    }
    const diagnostics = value.diagnostics.flatMap((item) => {
      if (!isRecord(item) || typeof item.file !== "string" ||
        typeof item.severity !== "string" || typeof item.line !== "number" ||
        !Number.isInteger(item.line) || typeof item.message !== "string") return [];
      return [{ file: item.file, severity: item.severity, line: item.line, message: item.message }];
    });
    if (diagnostics.length !== value.diagnostics.length) {
      throw new Error("تشخيصات إضافة VS Code غير صالحة.");
    }
    return {
      workspace: value.workspace,
      active_file: value.active_file,
      selection: value.selection,
      diagnostics,
    };
  } catch (reason) {
    if (reason instanceof Error && reason.message.includes("Pair this TaskFlow session")) {
      clearVscodeBridgeToken(projectId);
      return null;
    }
    throw reason;
  }
}

export async function executeVscodeActions(
  projectId: string,
  actions: AIAppAction[],
  mode: VscodeBridgeMode,
  teamMode = false,
  onProgress?: (output: string) => void,
  signal?: AbortSignal,
) {
  const token = getVscodeBridgeToken(projectId);
  if (!token) throw new Error("اربط إضافة TF CODE في VS Code أولًا للتحكم بالمحرر.");
  const port = getBridgePort(projectId);
  const editorActions = actions.filter((action) => action.type.startsWith("code."));
  if (editorActions.length !== actions.length) throw new Error("أرسل إجراءات المحرر فقط إلى إضافة VS Code.");
  const result = await bridgeRequest("/actions", {
    method: "POST",
    body: JSON.stringify({ mode, team_mode: teamMode, actions: editorActions }),
  }, token, port, onProgress, signal);
  if (!result || typeof result !== "object" || !("results" in result) ||
    !Array.isArray(result.results) || result.results.some((item) => typeof item !== "string")) {
    throw new Error("استجابة تنفيذ إجراءات VS Code غير صالحة.");
  }
  return result.results.join("\n");
}
