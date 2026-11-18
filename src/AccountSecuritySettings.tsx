import { useState } from "react";
import { AlertTriangle, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "./authContext";
import { translate, useLanguage } from "./localization";
import "./AccountSecuritySettings.css";

export default function AccountSecuritySettings() {
  const { logout, deleteAccount } = useAuth();
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await logout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!window.confirm(translate(
      "حذف الحساب نهائي ولا يمكن التراجع عنه، وسيحذف بياناته ومزوّدي AI المرتبطين به. هل تريد المتابعة؟",
      language,
    ))) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <section className="settings-card account-security-settings">
      <h3>{translate("أمان الحساب", language)}</h3>
      <p>{translate("سجّل الخروج من هذا الجهاز أو احذف حسابك وبياناته نهائيًا.", language)}</p>
      {error && <p className="account-security-error" role="alert">{error}</p>}
      <div className="account-security-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void signOut()}>
          <LogOut size={15} aria-hidden="true" /> {translate("تسجيل الخروج", language)}
        </button>
        <button type="button" className="account-delete-button" disabled={busy} onClick={() => void removeAccount()}>
          <Trash2 size={15} aria-hidden="true" /> {translate("حذف حسابي", language)}
        </button>
      </div>
      <small><AlertTriangle size={13} aria-hidden="true" /> {translate("حذف الحساب يزيل بيانات الحساب ومزوّدي AI وحساب GitHub المرتبط به.", language)}</small>
    </section>
  );
}
