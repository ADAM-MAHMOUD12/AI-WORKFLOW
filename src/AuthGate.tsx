import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  API_BASE,
  apiFetch,
  getSavedAccounts,
  getSessionToken,
  removeSavedAccount,
  saveSavedAccount,
  setSessionToken,
  type SavedAuthAccount,
} from "./api";
import { clearAppDataCache } from "./appData";
import { Workflow } from "lucide-react";
import { saveLanguage, translate, useLanguage } from "./localization";
import { AuthContext, type AuthStatus, type AuthUser } from "./authContext";
import GlassAppearanceControl from "./GlassAppearanceControl";
import "./AuthGate.css";

function messageFrom(response: Response, body: unknown) {
  return isRecord(body) && typeof body.detail === "string"
    ? body.detail
    : `Request failed (${response.status}).`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootError, setBootError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const language = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const refreshStatus = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/auth/status`);
    if (!response.ok) throw new Error(`Could not load service status (${response.status}).`);
    const next = await response.json() as AuthStatus;
    setStatus(next);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/status`);
        if (!response.ok) throw new Error(`Could not connect to AI TaskFlow (${response.status}).`);
        const next = await response.json() as AuthStatus;
        if (!active) return;
        setStatus(next);
        const token = getSessionToken();
        if (token) {
          const current = await apiFetch(`${API_BASE}/api/auth/me`);
          if (current.ok) {
            const result = await current.json() as { user: AuthUser };
            if (active) {
              setUser(result.user);
              saveSavedAccount({
                id: result.user.id,
                username: result.user.username,
                role: result.user.role,
                status: result.user.status,
                is_blocked: result.user.is_blocked,
                block_note: result.user.block_note,
                created_at: result.user.created_at,
                token,
              });
            }
          } else {
            setSessionToken(null);
          }
        }
      } catch (reason) {
        if (active) setBootError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const path = creating ? "/api/auth/register" : "/api/auth/login";
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { detail?: string; access_token?: string | null; user?: AuthUser };
      if (!response.ok) throw new Error(messageFrom(response, result));
      if (result.access_token && result.user) {
        clearAppDataCache();
        setSessionToken(result.access_token);
        setUser(result.user);
        saveSavedAccount({
          id: result.user.id,
          username: result.user.username,
          role: result.user.role,
          status: result.user.status,
          is_blocked: result.user.is_blocked,
          block_note: result.user.block_note,
          created_at: result.user.created_at,
          token: result.access_token,
        });
        await refreshStatus();
        setPassword("");
      } else {
        setNotice(result.user?.status === "pending"
          ? translate("تم إرسال طلبك. انتظر موافقة مسؤول الجهاز.", language)
          : translate("تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.", language));
        setCreating(false);
        await refreshStatus();
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const logout = useCallback(async () => {
    const token = getSessionToken();
    if (token) {
      const response = await apiFetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error(`Sign out failed (${response.status}).`);
    }
    setSessionToken(null);
    clearAppDataCache();
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    const response = await apiFetch(`${API_BASE}/api/auth/account`, { method: "DELETE" });
    if (!response.ok) {
      const body: unknown = await response.json();
      throw new Error(messageFrom(response, body));
    }
    const currentUserId = user?.id;
    if (currentUserId) removeSavedAccount(currentUserId);
    setSessionToken(null);
    clearAppDataCache();
    setUser(null);
    await refreshStatus();
  }, [refreshStatus, user]);

  const switchAccount = useCallback(async (accountId: string) => {
    const account = getSavedAccounts().find((item) => item.id === accountId);
    if (!account) throw new Error("هذا الحساب لم يعد محفوظًا على هذا الجهاز.");
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    if (!response.ok) {
      removeSavedAccount(accountId);
      throw new Error("جلسة الحساب لم تعد صالحة. أضفه مجددًا باسم المستخدم وكلمة المرور.");
    }
    const result = await response.json() as { user: AuthUser };
    setSessionToken(account.token);
    clearAppDataCache();
    setUser(result.user);
    saveSavedAccount({ ...account, ...result.user, token: account.token });
    window.location.reload();
  }, []);

  const addAccount = useCallback(async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await response.json() as { detail?: string; access_token?: string; user?: AuthUser };
    if (!response.ok) throw new Error(messageFrom(response, result));
    if (!result.access_token || !result.user) throw new Error("استجابة تسجيل الحساب البديل غير مكتملة.");
    const account: SavedAuthAccount = {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
      status: result.user.status,
      is_blocked: result.user.is_blocked,
      block_note: result.user.block_note,
      created_at: result.user.created_at,
      token: result.access_token,
    };
    setSessionToken(result.access_token);
    clearAppDataCache();
    setUser(result.user);
    saveSavedAccount(account);
    window.location.reload();
  }, []);

  const removeSavedAccountOnly = useCallback(async (accountId: string) => {
    const account = getSavedAccounts().find((item) => item.id === accountId);
    if (!account) return;
    if (accountId === user?.id) {
      await logout();
      removeSavedAccount(accountId);
      return;
    }
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.token}` },
      });
    } finally {
      removeSavedAccount(accountId);
    }
  }, [logout, user]);

  const deleteSavedAccount = useCallback(async (accountId: string) => {
    const account = getSavedAccounts().find((item) => item.id === accountId);
    if (!account) throw new Error("هذا الحساب غير موجود في الحسابات المحفوظة.");
    if (accountId === user?.id) {
      await deleteAccount();
      return;
    }

    const currentToken = getSessionToken();
    const currentUser = user;
    setSessionToken(account.token);
    const response = await fetch(`${API_BASE}/api/auth/account`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${account.token}` },
    });
    if (currentToken) {
      setSessionToken(currentToken);
      setUser(currentUser);
    } else {
      setSessionToken(null);
      setUser(null);
    }
    if (!response.ok) {
      const body: unknown = await response.json();
      throw new Error(messageFrom(response, body));
    }
    removeSavedAccount(accountId);
    clearAppDataCache();
    await refreshStatus();
  }, [deleteAccount, refreshStatus, user]);

  const context = useMemo(() => ({
    user, status, refreshStatus, logout, deleteAccount,
    switchAccount, addAccount, removeSavedAccount: removeSavedAccountOnly,
    deleteSavedAccount,
  }), [user, status, refreshStatus, logout, deleteAccount, switchAccount, addAccount, removeSavedAccountOnly, deleteSavedAccount]);
  const isAccountMode = Boolean(status && (status.multi_user_enabled || status.account_count === 0 || (status.account_count > 0 && !user)));

  if (bootError) {
    return <main className="auth-screen" dir={language === "ar" ? "rtl" : "ltr"}>
      <section className="auth-card"><h1>AI TaskFlow</h1><p>{bootError}</p><button onClick={() => window.location.reload()}>{translate("إعادة المحاولة", language)}</button></section>
    </main>;
  }
  if (!status) return <main className="auth-screen"><section className="auth-card"><p>{translate("جارٍ الاتصال بالخادم...", language)}</p></section></main>;
  if (isAccountMode && !user) {
    return <main className="auth-screen" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="auth-backdrop-mark" aria-hidden="true">
        <Workflow />
        <span>من الفكرة إلى الإنجاز</span>
      </div>
      <GlassAppearanceControl language={language} placement="auth" />
      <section className="auth-card">
        <div className="auth-card-heading">
          <div className="auth-brand-mark"><Workflow size={25} aria-hidden="true" /></div>
          <div className="auth-language" aria-label={translate("لغة الواجهة", language)}>
            <button type="button" className={language === "ar" ? "active" : ""} onClick={() => saveLanguage("ar")}>العربية</button>
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => saveLanguage("en")}>English</button>
          </div>
        </div>
        <span className="auth-brand">AI TASKFLOW</span>
        <h1>{creating ? translate("إنشاء حساب", language) : translate("ابدأ مساحة عملك", language)}</h1>
        <p>{status.account_count === 0
          ? translate("أنشئ حسابك المحلي وابدأ بتحويل أفكارك إلى إنجاز.", language)
          : translate("سجّل الدخول للعودة إلى مشاريعك ومساحة عملك.", language)}</p>
        {!creating && getSavedAccounts().length > 0 && <div className="auth-saved-accounts">
          <div className="auth-saved-accounts-heading"><strong>{translate("الحسابات المحفوظة", language)}</strong><small>{translate("بدّل الحساب دون إدخال كلمة المرور مجددًا", language)}</small></div>
          {getSavedAccounts().map((account) => <button
            type="button"
            key={account.id}
            disabled={busy}
            onClick={() => void switchAccount(account.id)}
          >
            <span>{account.username}</span>
            <small>{account.role === "admin" ? translate("مسؤول", language) : translate("مستخدم", language)}</small>
          </button>)}
        </div>}
        <form onSubmit={(event) => void submit(event)}>
          <label><span>{translate("اسم المستخدم", language)}</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required /></label>
          <label><span>{translate("كلمة المرور", language)}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creating ? "new-password" : "current-password"} minLength={12} maxLength={256} required /></label>
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? translate("جارٍ التنفيذ...", language) : creating ? translate("إنشاء حساب", language) : translate("دخول إلى مساحة العمل", language)}</button>
        </form>
        {status.registration_open && <button className="auth-switch" type="button" onClick={() => { setCreating(!creating); setNotice(""); }}>
          {creating ? translate("لديك حساب؟ سجّل الدخول", language) : translate("إنشاء حساب جديد", language)}
        </button>}
        <small className="auth-privacy-note">{status.approval_required && status.account_count > 0
          ? translate("قد يتطلب الحساب الجديد موافقة المسؤول.", language)
          : translate("بيانات الحساب محفوظة محليًا على هذا الجهاز.", language)}</small>
      </section>
    </main>;
  }

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
