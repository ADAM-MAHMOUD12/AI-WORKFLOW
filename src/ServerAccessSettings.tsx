import { useEffect, useState } from "react";
import { Check, LogOut, RefreshCw, Shield, X } from "lucide-react";
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
  const { status, refreshStatus, logout } = useAuth();
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetchAdminAccounts()
      .then((result) => { if (active) setAccounts(result); })
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
            <span><strong>{account.username}</strong><small>{translate(account.role === "admin" ? "مسؤول الجهاز" : "مستخدم", language)} · {translate(account.status === "pending" ? "بانتظار الموافقة" : account.status === "approved" ? "مفعّل" : "مرفوض", language)}</small></span>
            {account.status === "pending" && <div>
              <button type="button" aria-label="Approve account" title={translate("موافقة", language)} disabled={busy} onClick={() => void changeAccount(account.id, "approve")}><Check size={16} /></button>
              <button type="button" aria-label="Reject account" title={translate("رفض", language)} disabled={busy} onClick={() => void changeAccount(account.id, "reject")}><X size={16} /></button>
            </div>}
          </div>
        ))}
      </div>
      <button className="server-logout" type="button" onClick={() => void logout()}><LogOut size={15} />{translate("تسجيل الخروج", language)}</button>
    </section>
  );
}
