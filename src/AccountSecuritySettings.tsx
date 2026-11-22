import { useState, type FormEvent } from "react";
import { AlertTriangle, LogOut, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { getSavedAccounts, type SavedAuthAccount } from "./api";
import { useAuth } from "./authContext";
import { translate, useLanguage } from "./localization";
import "./AccountSecuritySettings.css";

export default function AccountSecuritySettings() {
  const { user, logout, deleteAccount, switchAccount, addAccount, removeSavedAccount, deleteSavedAccount } = useAuth();
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accounts, setAccounts] = useState<SavedAuthAccount[]>(() => getSavedAccounts());


  function refreshAccounts() {
    setAccounts(getSavedAccounts());
  }

  async function signOut() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await logout();
      refreshAccounts();
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
      refreshAccounts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addAlternative(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await addAccount(username.trim(), password);
      setPassword("");
      setUsername("");
      setShowAdd(false);
      refreshAccounts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(accountId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await switchAccount(accountId);
    } catch (reason) {
      refreshAccounts();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromDevice(accountId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removeSavedAccount(accountId);
      refreshAccounts();
      setNotice(translate("أُزيل الحساب من هذا الجهاز.", language));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFromServer(accountId: string) {
    if (!window.confirm(translate(
      "سيحذف هذا الحساب نهائيًا من TaskFlow وجميع مزوّدي AI وبياناته المرتبطة به. هل تريد المتابعة؟",
      language,
    ))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteSavedAccount(accountId);
      refreshAccounts();
      setNotice(translate("حُذف الحساب من الخادم.", language));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card account-security-settings">
      <h3>{translate("الحسابات والربط", language)}</h3>
      <p>{translate("أضف حسابًا بديلًا، بدّل الحساب النشط، أو احذف حسابًا محفوظًا.", language)}</p>
      {error && <p className="account-security-error" role="alert">{error}</p>}
      {notice && <p className="account-security-notice" role="status">{notice}</p>}

      <div className="account-list">
        {accounts.map((account) => (
          <article className={`account-row${account.id === user?.id ? " active" : ""}`} key={account.id}>
            <div className="account-avatar"><UserRound size={16} aria-hidden="true" /></div>
            <div className="account-copy">
              <strong>{account.username}</strong>
              <small>{account.id === user?.id ? translate("الحساب النشط", language) : translate("حساب محفوظ", language)} · {account.role === "admin" ? translate("مسؤول", language) : translate("مستخدم", language)}</small>
            </div>
            {account.id !== user?.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => void switchTo(account.id)}><RefreshCw size={14} /> {translate("تبديل", language)}</button>}
            <button type="button" className="account-remove-button" disabled={busy} onClick={() => void removeFromDevice(account.id)}>{translate("إزالة من الجهاز", language)}</button>
            <button type="button" className="account-delete-button" disabled={busy} onClick={() => void deleteFromServer(account.id)}><Trash2 size={14} /> {translate("حذف نهائي", language)}</button>
          </article>
        ))}
        {accounts.length === 0 && <p className="account-empty">{translate("لا توجد حسابات محفوظة حاليًا.", language)}</p>}
      </div>

      {showAdd ? <form className="account-add-form" onSubmit={(event) => void addAlternative(event)}>
        <label><span>{translate("اسم المستخدم", language)}</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required /></label>
        <label><span>{translate("كلمة المرور", language)}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={12} maxLength={256} required /></label>
        <div>
          <button type="submit" className="primary-button" disabled={busy}><Plus size={15} /> {translate("إضافة وتبديل", language)}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowAdd(false)}>{translate("إلغاء", language)}</button>
        </div>
      </form> : <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowAdd(true)}><Plus size={15} /> {translate("إضافة حساب بديل", language)}</button>}

      <div className="account-security-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void signOut()}>
          <LogOut size={15} aria-hidden="true" /> {translate("تسجيل الخروج", language)}
        </button>
        <button type="button" className="account-delete-button" disabled={busy} onClick={() => void removeAccount()}>
          <Trash2 size={15} aria-hidden="true" /> {translate("حذف الحساب النشط", language)}
        </button>
      </div>
      <small><AlertTriangle size={13} aria-hidden="true" /> {translate("الحذف النهائي يزيل بيانات الحساب ومزوّدي AI وحساب GitHub المرتبط به ولا يمكن التراجع عنه.", language)}</small>
    </section>
  );
}
