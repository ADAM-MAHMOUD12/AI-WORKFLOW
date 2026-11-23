import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, GitBranch, LoaderCircle, Link2 } from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import { useAuth } from "./authContext";
import { translate, useLanguage } from "./localization";
import "./GitHubAccountSettings.css";

type GitHubAccount = {
  connected: boolean;
  github_login: string | null;
  updated_at: string | null;
};

type DeviceFlow = {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === "string"
      ? body.detail
      : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  if (!isRecord(body)) throw new Error("استجابة GitHub غير صالحة.");
  return body;
}

export default function GitHubAccountSettings() {
  const { status } = useAuth();
  const language = useLanguage();
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void apiFetch(`${API_BASE}/api/github/account`)
      .then(readJson)
      .then((result) => {
        if (!mounted.current) return;
        const githubLogin = result.github_login;
        const updatedAt = result.updated_at;
        if (typeof result.connected !== "boolean" ||
          !isNullableString(githubLogin) ||
          !isNullableString(updatedAt)) {
          throw new Error("استجابة حالة ربط GitHub غير صالحة.");
        }
        setAccount({
          connected: result.connected,
          github_login: githubLogin,
          updated_at: updatedAt,
        });
      })
      .catch((reason: unknown) => {
        if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => { mounted.current = false; };
  }, []);

  async function connectGitHub() {
    setBusy(true);
    setNotice("");
    setError("");
    const popup = window.open("about:blank", "taskflow-github-link", "popup,width=520,height=720");
    let authorizationPageOpened = false;
    try {
      const startResponse = await apiFetch(`${API_BASE}/api/auth/github/device/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "link" }),
      });
      const start = await readJson(startResponse);
      if (typeof start.flow_id !== "string" ||
        typeof start.user_code !== "string" ||
        typeof start.verification_uri !== "string" ||
        typeof start.interval !== "number" ||
        typeof start.expires_in !== "number") {
        throw new Error("استجابة بدء ربط GitHub غير صالحة.");
      }

      const verificationUrl = typeof start.verification_uri_complete === "string"
        ? start.verification_uri_complete
        : start.verification_uri;
      const nextFlow: DeviceFlow = {
        flowId: start.flow_id,
        userCode: start.user_code,
        verificationUrl,
        interval: start.interval,
        expiresIn: start.expires_in,
      };
      setFlow(nextFlow);
      if (popup) {
        popup.location.replace(verificationUrl);
        authorizationPageOpened = true;
      }

      let retryAfter = nextFlow.interval;
      const expiresAt = Date.now() + nextFlow.expiresIn * 1000;
      while (Date.now() < expiresAt && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, retryAfter * 1000));
        if (!mounted.current) return;
        const pollResponse = await apiFetch(`${API_BASE}/api/auth/github/device/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flow_id: nextFlow.flowId }),
        });
        const poll = await readJson(pollResponse);
        if (poll.status === "pending") {
          retryAfter = typeof poll.retry_after === "number" ? poll.retry_after : nextFlow.interval;
          continue;
        }
        if (poll.status !== "connected" || typeof poll.github_login !== "string") {
          throw new Error("تعذّر حفظ ربط حساب GitHub.");
        }

        const accountResult = await readJson(await apiFetch(`${API_BASE}/api/github/account`));
        if (accountResult.connected !== true || accountResult.github_login !== poll.github_login) {
          throw new Error("لم يتم تأكيد حفظ ربط حساب GitHub.");
        }
        setAccount({
          connected: true,
          github_login: poll.github_login,
          updated_at: typeof accountResult.updated_at === "string" ? accountResult.updated_at : null,
        });
        setFlow(null);
        setNotice(translate("تم ربط حساب GitHub وحفظه على هذا الجهاز.", language));
        return;
      }
      if (mounted.current) throw new Error("انتهت صلاحية رمز GitHub. ابدأ الربط مرة أخرى.");
    } catch (reason) {
      if (mounted.current) {
        setFlow(null);
        setError(reason instanceof Error ? reason.message : translate("تعذّر ربط حساب GitHub.", language));
      }
    } finally {
      if (popup && !popup.closed && !authorizationPageOpened) popup.close();
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="settings-card github-account-settings">
      <h3><GitBranch size={18} aria-hidden="true" /> {translate("حساب GitHub", language)}</h3>
      <p>{translate("اربط حساب GitHub بحساب TaskFlow الحالي لاستخدامه من إعدادات المنصة ومحرر TF CODE.", language)}</p>
      <div className={`github-account-status${account?.connected ? " is-connected" : ""}`} aria-live="polite">
        {loading
          ? <><LoaderCircle size={16} className="github-settings-spin" aria-hidden="true" /> {translate("جارٍ التحقق من حالة الربط...", language)}</>
          : account?.connected
            ? <><CheckCircle2 size={16} aria-hidden="true" /> {translate("مرتبط بحساب", language)} @{account.github_login}</>
            : <><Link2 size={16} aria-hidden="true" /> {translate("لا يوجد حساب GitHub مرتبط.", language)}</>}
      </div>
      <p className="github-account-permissions">{translate("سيطلب GitHub صلاحية المستودعات عند الربط. يتم حفظ رمز الوصول مشفّرًا في قاعدة بيانات هذا الجهاز.", language)}</p>
      {!status?.github_oauth_enabled && (
        <p className="github-account-permissions">{translate("ربط GitHub غير مفعّل؛ على مسؤول الموقع إعداد GitHub OAuth Client ID في إعدادات الجهاز.", language)}</p>
      )}
      {flow && <div className="github-device-flow" aria-live="polite">
        <p>{translate("افتح صفحة GitHub وأدخل رمز التحقق لإكمال الربط.", language)}</p>
        <code>{flow.userCode}</code>
        <div>
          <a href={flow.verificationUrl} target="_blank" rel="noreferrer">{translate("فتح GitHub", language)}</a>
          <button type="button" onClick={() => {
            void navigator.clipboard.writeText(flow.userCode)
              .then(() => setNotice(translate("تم نسخ رمز GitHub.", language)))
              .catch(() => setError(translate("تعذّر نسخ الرمز إلى الحافظة.", language)));
          }}>
            <Copy size={14} aria-hidden="true" /> {translate("نسخ الرمز", language)}
          </button>
        </div>
        <span>{translate("بانتظار موافقتك في GitHub...", language)}</span>
      </div>}
      {error && <p className="github-account-error" role="alert">{error}</p>}
      {notice && <p className="github-account-notice" role="status">{notice}</p>}
      <div className="github-account-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() => void connectGitHub()}
          disabled={busy || loading || !status?.github_oauth_enabled}
        >
          {busy ? <LoaderCircle size={15} className="github-settings-spin" aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
          {busy
            ? translate("بانتظار موافقة GitHub...", language)
            : account?.connected
              ? translate("إعادة ربط GitHub", language)
              : translate("ربط حساب GitHub", language)}
        </button>
      </div>
    </section>
  );
}
