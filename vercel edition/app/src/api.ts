type TaskflowPorts = { api?: number; frontend?: number; engine3d?: number; engine2d?: number };

declare global {
  interface Window {
    TASKFLOW_PORTS?: TaskflowPorts;
  }
}

const isLoopbackHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const isHostedOrigin = !window.location.port && !isLoopbackHost;
const runtimePorts = isHostedOrigin ? undefined : window.TASKFLOW_PORTS;
const servicePorts: Record<number, number | undefined> = {
  3002: runtimePorts?.engine3d,
  5174: runtimePorts?.engine2d,
};

const localApiBase = `${window.location.protocol}//${window.location.hostname}:${runtimePorts?.api ?? 8000}`;
export const IS_HOSTED_DEPLOYMENT = isHostedOrigin;
export const API_BASE = isHostedOrigin
  ? window.location.origin
  : localApiBase;

export function serviceUrl(port: number, path = "") {
  if (IS_HOSTED_DEPLOYMENT && port === 3002) {
    return `${window.location.origin}/engine/3d${path}`;
  }
  if (IS_HOSTED_DEPLOYMENT && port === 5174) {
    return `${window.location.origin}/engine/2d/${path.replace(/^\//, "")}`;
  }
  const resolvedPort = servicePorts[port] ?? port;
  return `${window.location.protocol}//${window.location.hostname}:${resolvedPort}${path}`;
}

export function sanitizeArtifactFilename(value: string, fallback: string): string {
  const filename = Array.from(value, (character) =>
    /[<>:"/\\|?*]/.test(character) || character.charCodeAt(0) < 32 ? "-" : character,
  ).join("").slice(0, 60).replace(/[. ]+$/g, "");
  return filename || fallback;
}

const SESSION_KEY = "taskflow-auth-session-v1";
const SAVED_ACCOUNTS_KEY = "taskflow-auth-saved-accounts-v1";
const LOCAL_ASSISTANT_TOKEN_KEY = "taskflow-vercel-local-assistant-token-v1";
const LOCAL_ASSISTANT_URL = "http://127.0.0.1:17411";
const DEVICE_API_ROUTES = [
  /^\/api\/programming\/run$/,
  /^\/api\/programming\/workspace(?:\/[a-f0-9]{32})?$/,
  /^\/api\/programming\/launch-vscode\/[a-f0-9]{32}$/,
  /^\/api\/programming\/extensions\/(?:catalog|installed|install|upload|[A-Za-z0-9._-]+)$/,
  /^\/api\/w2m\/vision\/(?:status|download|analyze)$/,
  /^\/api\/downloads\/[A-Za-z0-9._-]+$/,
  /^\/api\/speech\/(?:status|transcription\/download|transcription|synthesize|voices\/(?:ar|en)\/download)$/,
  /^\/api\/motion\/(?:open-editor|editor-project\/[A-Za-z0-9_-]+|latest-project|open-saved\/[A-Za-z0-9_-]+|audio-analysis\/[A-Za-z0-9_-]+|repair-images\/[A-Za-z0-9_-]+|update-editor)$/,
  /^\/api\/aedifex\/scenes$/,
];

export type SavedAuthAccount = {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "approved" | "pending" | "rejected";
  token: string;
  is_blocked?: boolean;
  block_note?: string;
  created_at: string;
};

export function getSavedAccounts(): SavedAuthAccount[] {
  try {
    const value = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedAuthAccount =>
      typeof item?.id === "string" && typeof item?.username === "string" &&
      typeof item?.token === "string" && (item.role === "admin" || item.role === "user"));
  } catch {
    return [];
  }
}

export function saveSavedAccount(account: SavedAuthAccount) {
  const accounts = getSavedAccounts().filter((item) => item.id !== account.id);
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify([account, ...accounts].slice(0, 12)));
}

export function removeSavedAccount(accountId: string) {
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(
    getSavedAccounts().filter((item) => item.id !== accountId),
  ));
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null) {
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function localAssistantHeaders(init: RequestInit, token: string, cloudToken: string) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-TaskFlow-Cloud-Session", cloudToken);
  headers.set("X-TaskFlow-Api-Origin", API_BASE);
  return headers;
}

function assistantErrorResponse(detail: string, status = 503) {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function getLocalDevicePort(port: number) {
  if (!IS_HOSTED_DEPLOYMENT) return servicePorts[port] ?? port;
  try {
    const stored = JSON.parse(localStorage.getItem("taskflow-vercel-local-ports-v1") ?? "{}");
    const key = port === 3002 ? "engine3d" : port === 5174 ? "engine2d" : "";
    const resolved = key && typeof stored === "object" && stored !== null ? stored[key] : undefined;
    return typeof resolved === "number" && Number.isInteger(resolved) &&
      resolved >= 1 && resolved <= 65535 ? resolved : port;
  } catch {
    return port;
  }
}

export async function pairLocalAssistant(code: string) {
  const sessionToken = getSessionToken();
  if (!sessionToken) throw new Error("سجّل الدخول إلى TaskFlow قبل ربط المساعد المحلي.");
  const response = await fetch(`${LOCAL_ASSISTANT_URL}/pair`, {
    method: "POST",
    headers: {
      "X-TaskFlow-Pairing-Code": code.trim(),
      "X-TaskFlow-Cloud-Session": sessionToken,
      "X-TaskFlow-Api-Origin": API_BASE,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = value && typeof value === "object" && "detail" in value && typeof value.detail === "string"
      ? value.detail : "تعذّر ربط المساعد المحلي.";
    throw new Error(detail);
  }
  if (!value || typeof value !== "object" || !("assistant_token" in value) ||
    typeof value.assistant_token !== "string" || !("username" in value) ||
    typeof value.username !== "string" || !("local_ports" in value) ||
    typeof value.local_ports !== "object" || value.local_ports === null) {
    throw new Error("أعاد المساعد المحلي استجابة ربط غير صالحة.");
  }
  localStorage.setItem(LOCAL_ASSISTANT_TOKEN_KEY, value.assistant_token);
  localStorage.setItem("taskflow-vercel-local-ports-v1", JSON.stringify(value.local_ports));
  return value.username;
}

export async function getLocalAssistantStatus() {
  const token = localStorage.getItem(LOCAL_ASSISTANT_TOKEN_KEY);
  const sessionToken = getSessionToken();
  if (!token || !sessionToken) return false;
  const response = await fetch(`${LOCAL_ASSISTANT_URL}/health`, {
    headers: localAssistantHeaders({}, token, sessionToken),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(LOCAL_ASSISTANT_TOKEN_KEY);
    }
    return false;
  }
  const value: unknown = await response.json();
  return Boolean(value && typeof value === "object" && "paired" in value && value.paired === true);
}

export async function unpairLocalAssistant() {
  const token = localStorage.getItem(LOCAL_ASSISTANT_TOKEN_KEY);
  const sessionToken = getSessionToken();
  if (!token || !sessionToken) {
    localStorage.removeItem(LOCAL_ASSISTANT_TOKEN_KEY);
    return;
  }
  const response = await fetch(`${LOCAL_ASSISTANT_URL}/pair`, {
    method: "DELETE",
    headers: localAssistantHeaders({}, token, sessionToken),
  });
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    const value: unknown = await response.json().catch(() => null);
    const detail = value && typeof value === "object" && "detail" in value && typeof value.detail === "string"
      ? value.detail : "تعذّر فصل المساعد المحلي.";
    throw new Error(detail);
  }
  localStorage.removeItem(LOCAL_ASSISTANT_TOKEN_KEY);
  localStorage.removeItem("taskflow-vercel-local-ports-v1");
}

export function deviceApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (!IS_HOSTED_DEPLOYMENT) return apiFetch(input, init);
  let url: URL;
  try {
    url = input instanceof Request
      ? new URL(input.url)
      : new URL(input instanceof URL ? input.href : input, API_BASE);
  } catch {
    return apiFetch(input, init);
  }
  if (!DEVICE_API_ROUTES.some((route) => route.test(url.pathname))) return apiFetch(input, init);

  const token = localStorage.getItem(LOCAL_ASSISTANT_TOKEN_KEY);
  const sessionToken = getSessionToken();
  if (!token || !sessionToken) {
    return Promise.resolve(assistantErrorResponse(
      "اربط المساعد المحلي من صفحة البرمجة لتشغيل هذه الميزة على جهازك.",
    ));
  }
  const headers = localAssistantHeaders(init, token, sessionToken);
  const path = `${url.pathname}${url.search}`;
  return fetch(`${LOCAL_ASSISTANT_URL}/proxy${path}`, {
    ...init,
    headers,
    credentials: "omit",
  }).catch((reason: unknown) => {
    if (reason instanceof TypeError) {
      return assistantErrorResponse(
        "المساعد المحلي غير متصل. شغّل مساعد AI TaskFlow المحلي واسمح للمتصفح بالاتصال به.",
      );
    }
    throw reason;
  });
}

export async function deliverArtifactToTelegram(
  section: "design" | "flowchart" | "planner" | "architecture" | "motion" | "markdown",
  filename: string,
  content: BlobPart,
  contentType: string,
): Promise<{ available: boolean; delivered: boolean; reason?: string }> {
  const form = new FormData();
  form.append("section", section);
  form.append("artifact", new Blob([content], { type: contentType }), filename);
  const response = await apiFetch(`${API_BASE}/api/telegram-bot/deliver`, { method: "POST", body: form });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result === "object" && result !== null && "detail" in result &&
      typeof result.detail === "string" ? result.detail : "تعذر إرسال ملف العمل إلى Telegram.";
    throw new Error(detail);
  }
  if (typeof result !== "object" || result === null || !("available" in result) ||
    typeof result.available !== "boolean" || !("delivered" in result) ||
    typeof result.delivered !== "boolean" ||
    ("reason" in result && result.reason !== undefined && typeof result.reason !== "string")) {
    throw new Error("استجابة إرسال ملف العمل إلى Telegram غير صالحة.");
  }
  return {
    available: result.available,
    delivered: result.delivered,
    ...("reason" in result && typeof result.reason === "string" ? { reason: result.reason } : {}),
  };
}
