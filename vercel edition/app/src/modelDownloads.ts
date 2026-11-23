import { API_BASE, deviceApiFetch as apiFetch } from "./api";

export type ModelDownloadStatus = {
  id: string;
  state: "idle" | "downloading" | "complete" | "error";
  bytes_downloaded: number;
  bytes_total: number | null;
  error: string | null;
};

function isModelDownloadStatus(value: unknown): value is ModelDownloadStatus {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "state" in value && ["idle", "downloading", "complete", "error"].includes(String(value.state)) &&
    "bytes_downloaded" in value && typeof value.bytes_downloaded === "number" &&
    "bytes_total" in value && (value.bytes_total === null || typeof value.bytes_total === "number") &&
    "error" in value && (value.error === null || typeof value.error === "string");
}

async function readDownloadStatus(id: string): Promise<ModelDownloadStatus> {
  const response = await apiFetch(`${API_BASE}/api/downloads/${encodeURIComponent(id)}`);
  const value: unknown = await response.json();
  if (!response.ok || !isModelDownloadStatus(value)) {
    throw new Error("تعذّر قراءة تقدّم تنزيل النموذج.");
  }
  return value;
}

export async function runTrackedDownload<T>(
  id: string,
  action: () => Promise<T>,
  onProgress: (progress: ModelDownloadStatus) => void,
): Promise<T> {
  let settled = false;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
  const operation = action().then(
    (value) => {
      outcome = { ok: true, value };
      settled = true;
    },
    (reason: unknown) => {
      outcome = { ok: false, error: reason };
      settled = true;
    },
  );

  while (!settled) {
    try {
      onProgress(await readDownloadStatus(id));
    } catch (reason) {
      onProgress({
        id,
        state: "error",
        bytes_downloaded: 0,
        bytes_total: null,
        error: reason instanceof Error ? reason.message : "تعذّر تحديث مؤشر التنزيل.",
      });
    }
    if (!settled) await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  await operation;
  if (!outcome) throw new Error("انتهى تنزيل النموذج دون نتيجة.");
  if (outcome.ok === false) throw outcome.error;
  onProgress(await readDownloadStatus(id));
  return outcome.value;
}

export function formatDownloadBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
