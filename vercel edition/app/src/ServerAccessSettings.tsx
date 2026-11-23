import { useEffect, useState } from "react";
import { Ban, Check, ExternalLink, RefreshCw, Shield, ShieldOff, Trash2, X } from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import { useAuth, type AuthStatus, type AuthUser } from "./authContext";
import { translate, useLanguage } from "./localization";
import "./ServerAccessSettings.css";

type Settings = Pick<AuthStatus,
  "multi_user_enabled" | "approval_required" | "local_only" |
  "engine_2d_enabled" | "engine_3d_enabled" | "engine_openfilm_enabled">;

const settingLabels: Array<[keyof Settings, string]> = [
  ["local_only", "تشغيل على هذا الجهاز فقط"],
  ["multi_user_enabled", "تفعيل حسابات متعددة"],
  ["approval_required", "موافقة المسؤول على الحسابات الجديدة"],
  ["engine_2d_enabled", "محرك المخططات ثنائية الأبعاد"],
  ["engine_3d_enabled", "محرك المخططات ثلاثية الأبعاد"],
  ["engine_openfilm_enabled", "محرك OpenFilm للموشن جرافيك"],
];

function settingsFromStatus(status: AuthStatus): Settings {
  return {
    multi_user_enabled: status.multi_user_enabled,
    approval_required: status.approval_required,
    local_only: status.local_only,
    engine_2d_enabled: status.engine_2d_enabled,
    engine_3d_enabled: status.engine_3d_enabled,
    engine_openfilm_enabled: status.engine_openfilm_enabled,
  };
}

async function fetchAdminAccounts(): Promise<AuthUser[]> {
  const response = await apiFetch(`${API_BASE}/api/auth/admin/users`);
  const result = await response.json() as AuthUser[] | { detail?: string };
  if (!response.ok || !Array.isArray(result)) {
    throw new Error(Array.isArray(result) ? `Request failed (${response.status}).` : result.detail ?? `Request failed (${response.status}).`);
  }
  return result;
}

export default function ServerAccessSettings() {
  const { status, refreshStatus } = useAuth();
  const language = useLanguage();
  const [settings, setSettings] = useState<Settings>(() => status ? settingsFromStatus(status) : {
    multi_user_enabled: false,
    approval_required: false,
    local_only: true,
    engine_2d_enabled: true,
    engine_3d_enabled: true,
    engine_openfilm_enabled: true,
  });
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  const [githubClientId, setGithubClientId] = useState("");
  const [blockNotes, setBlockNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetchAdminAccounts()
      .then((result) => { if (active) setAccounts(result); })
      .catch((reason: unknown) => { if (active) setNotice(reason instanceof Error ? reason.message : String(reason)); });
    void apiFetch(`${API_BASE}/api/auth/admin/github-oauth`)
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== "object" || !("client_id" in result) ||
          typeof result.client_id !== "string") {
          const detail = result && typeof result === "object" && "detail" in result &&
            typeof result.detail === "string" ? result.detail : `Request failed (${response.status}).`;
          throw new Error(detail);
        }
        if (active) setGithubClientId(result.client_id);
      })
      .catch((reason: unknown) => { if (active) setNotice(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);

  async function loadAccounts() {
    setNotice("");
    try {
      setAccounts(await fetchAdminAccounts());
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? `Request failed (${response.status}).`);
      }
      await refreshStatus();
      setNotice(translate("تم حفظ الإعدادات. أعد تشغيل start-all.bat لتطبيق تغييرات اتصال الشبكة والمحركات.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveGithubClientId() {
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/github-oauth`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: githubClientId.trim() }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const detail = result && typeof result === "object" && "detail" in result &&
          typeof result.detail === "string" ? result.detail : `Request failed (${response.status}).`;
        throw new Error(detail);
      }
      await refreshStatus();
      setNotice(translate("تم حفظ GitHub OAuth Client ID لجميع حسابات الموقع.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(userId: string, action: "approve" | "reject") {
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/users/${encodeURIComponent(userId)}/${action}`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? `Request failed (${response.status}).`);
      }
      await loadAccounts();
      setNotice(translate("تم تحديث حالة الحساب.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function blockAccount(account: AuthUser) {
    const note = blockNotes[account.id]?.trim() ?? "";
    if (!note) {
      setNotice(translate("اكتب ملاحظة توضح سبب الحظر.", language));
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/users/${encodeURIComponent(account.id)}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? `Request failed (${response.status}).`);
      }
      await loadAccounts();
      setNotice(translate("تم حظر الحساب وإلغاء جلساته. ستظهر الملاحظة لصاحبه عند محاولة الدخول.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function unblockAccount(userId: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/users/${encodeURIComponent(userId)}/unblock`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? `Request failed (${response.status}).`);
      }
      await loadAccounts();
      setNotice(translate("تم إلغاء حظر الحساب. يجب على صاحبه تسجيل الدخول مجددًا.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(account: AuthUser) {
    if (!window.confirm(translate(
      "حذف الحساب نهائيًا مع بياناته ومزوّدي AI المرتبطين به. هل تريد المتابعة؟",
      language,
    ) + ` (${account.username})`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/api/auth/admin/users/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? `Request failed (${response.status}).`);
      }
      await loadAccounts();
      setNotice(translate("تم حذف الحساب وبياناته.", language));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const restartRequired = Boolean(status && (
    status.local_only !== settings.local_only ||
    status.engine_2d_enabled !== settings.engine_2d_enabled ||
    status.engine_3d_enabled !== settings.engine_3d_enabled ||
    status.engine_openfilm_enabled !== settings.engine_openfilm_enabled
  ));

  return (
    <section className="settings-card server-access-settings">
      <h3><Shield size={17} /> {translate("إعدادات الجهاز والحسابات والمحركات", language)}</h3>
      <p>{translate("أول حساب يُنشأ على الجهاز المضيف يصبح المسؤول. بيانات كل حساب ومزوّدي AI الخاصين به معزولة في قاعدة البيانات.", language)}</p>
      <div className="server-setting-list">
        {settingLabels.map(([key, arabic]) => (
          <label className="settings-toggle" key={key}>
            <span><strong>{translate(arabic, language)}</strong><small>{key.startsWith("engine_")
              ? translate("إيقاف المحرك يمنع تشغيل خدمته ويوفر موارد الجهاز.", language)
              : key === "local_only"
                ? translate("إلغاء هذا الخيار يسمح بالوصول من الشبكة المحلية بعد إعادة التشغيل.", language)
                : translate("إعداد مركزي يتحكم به مسؤول الجهاز.", language)}</small></span>
            <input type="checkbox" checked={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} />
          </label>
        ))}
      </div>
      <div className="server-github-oauth">
        <label htmlFor="server-github-oauth-client-id">{translate("GitHub OAuth Client ID", language)}</label>
        <input
          id="server-github-oauth-client-id"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={128}
          value={githubClientId}
          onChange={(event) => setGithubClientId(event.target.value)}
          placeholder="Iv1.xxxxxxxxxxxxxxxx"
        />
        <p>{translate("إعداد مركزي يستخدمه جميع الحسابات لربط GitHub. Client ID معرّف عام؛ لا تضع Client Secret هنا. فعّل Device Flow في إعدادات OAuth App.", language)}</p>
        <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">
          {translate("إنشاء OAuth App في GitHub", language)} <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void saveGithubClientId()}>
          {translate("حفظ Client ID لجميع الحسابات", language)}
        </button>
      </div>
      {restartRequired && <p className="server-restart-note">{translate("تغييرات الشبكة ومحركات 2D/3D تتطلب إيقاف التشغيل ثم تشغيل start-all.bat مجددًا.", language)}</p>}
      <div className="settings-card-footer">
        <span role="status">{notice}</span>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void saveSettings()}>{translate("حفظ إعدادات الجهاز", language)}</button>
      </div>

      <div className="server-users-heading">
        <h4>{translate("الحسابات المسجلة", language)}</h4>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadAccounts()}><RefreshCw size={15} />{translate("تحديث", language)}</button>
      </div>
      <div className="server-user-list">
        {accounts.map((account) => (
          <div className="server-user-row" key={account.id}>
            <span>
              <strong>{account.username}</strong>
              <small>{translate(account.role === "admin" ? "مسؤول الجهاز" : "مستخدم", language)} · {account.is_blocked
                ? translate("محظور", language)
                : translate(account.status === "pending" ? "بانتظار الموافقة" : account.status === "approved" ? "مفعّل" : "مرفوض", language)}</small>
              {account.is_blocked && account.block_note && <small className="server-user-note">{translate("ملاحظة الحظر:", language)} {account.block_note}</small>}
              {account.role !== "admin" && <label className="server-user-block-note">
                <span>{translate("ملاحظة الحظر", language)}</span>
                <textarea
                  value={blockNotes[account.id] ?? account.block_note ?? ""}
                  onChange={(event) => setBlockNotes({ ...blockNotes, [account.id]: event.target.value })}
                  maxLength={500}
                  rows={2}
                  placeholder={translate("اكتب سبب الحظر ليظهر للمستخدم عند تسجيل الدخول", language)}
                />
              </label>}
            </span>
            <div className="server-user-actions">
              {account.status === "pending" && !account.is_blocked && <>
                <button type="button" aria-label={translate("موافقة", language)} title={translate("موافقة", language)} disabled={busy} onClick={() => void changeAccount(account.id, "approve")}><Check size={16} /></button>
                <button type="button" aria-label={translate("رفض", language)} title={translate("رفض", language)} disabled={busy} onClick={() => void changeAccount(account.id, "reject")}><X size={16} /></button>
              </>}
              {account.role !== "admin" && <>
                {account.is_blocked
                  ? <button type="button" aria-label={translate("إلغاء الحظر", language)} title={translate("إلغاء الحظر", language)} disabled={busy} onClick={() => void unblockAccount(account.id)}><ShieldOff size={16} /></button>
                  : <button type="button" aria-label={translate("حظر الحساب", language)} title={translate("حظر الحساب", language)} disabled={busy || !(blockNotes[account.id]?.trim() || account.block_note?.trim())} onClick={() => void blockAccount(account)}><Ban size={16} /></button>}
                <button type="button" aria-label={translate("حذف الحساب", language)} title={translate("حذف الحساب", language)} disabled={busy} onClick={() => void deleteAccount(account)}><Trash2 size={16} /></button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
