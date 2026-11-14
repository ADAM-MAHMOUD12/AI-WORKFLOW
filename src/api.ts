type TaskflowPorts = { api?: number; frontend?: number; engine3d?: number; engine2d?: number };

declare global {
  interface Window {
    TASKFLOW_PORTS?: TaskflowPorts;
  }
}

const runtimePorts = window.TASKFLOW_PORTS;
const servicePorts: Record<number, number | undefined> = {
  3002: runtimePorts?.engine3d,
  5174: runtimePorts?.engine2d,
};

export const API_BASE = `${window.location.protocol}//${window.location.hostname}:${runtimePorts?.api ?? 8000}`;

export function serviceUrl(port: number, path = "") {
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
