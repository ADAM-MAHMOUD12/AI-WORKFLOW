import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { formatDownloadBytes, type ModelDownloadStatus } from "./modelDownloads";
import "./ModelDownloadProgress.css";
import { translate, useLanguage } from "./localization";

export default function ModelDownloadProgress({
  progress,
  label,
}: {
  progress: ModelDownloadStatus | null;
  label: string;
}) {
  const language = useLanguage();
  if (!progress || progress.state === "idle") return null;
  const total = progress.bytes_total;
  const downloaded = progress.bytes_downloaded;
  const percent = total && total > 0
    ? Math.max(0, Math.min(100, Math.round(downloaded / total * 100)))
    : null;
  const stateLabel = progress.state === "complete"
    ? translate("اكتمل التنزيل", language)
    : progress.state === "error"
      ? progress.error ?? translate("تعذّر التنزيل", language)
      : translate("جارٍ التنزيل", language);

  return (
    <div className={`model-download-progress state-${progress.state}`} role="status" aria-live="polite">
      <div className="model-download-progress-heading">
        {progress.state === "complete"
          ? <CheckCircle2 size={16} aria-hidden="true" />
          : progress.state === "error"
            ? <AlertCircle size={16} aria-hidden="true" />
            : <LoaderCircle size={16} className="model-download-spinner" aria-hidden="true" />}
        <strong>{label}</strong>
        {percent !== null && <span>{percent}%</span>}
      </div>
      <div
        className="model-download-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
        aria-valuetext={total ? `${formatDownloadBytes(downloaded)} من ${formatDownloadBytes(total)}` : stateLabel}
      >
        <span style={{ width: `${percent ?? 0}%` }} />
      </div>
      <div className="model-download-progress-detail">
        {progress.state === "error"
          ? <span className="model-download-error">{stateLabel}</span>
          : total
          ? <span>{formatDownloadBytes(downloaded)} / {formatDownloadBytes(total)} · {translate("المتبقي", language)} {formatDownloadBytes(Math.max(0, total - downloaded))}</span>
          : <span>{stateLabel}{downloaded > 0 ? ` · ${translate("تم تنزيل", language)} ${formatDownloadBytes(downloaded)}` : ""}</span>}
      </div>
    </div>
  );
}
