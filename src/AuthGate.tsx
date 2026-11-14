import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { API_BASE, apiFetch, getSessionToken, setSessionToken } from "./api";
import { clearAppDataCache } from "./appData";
import { saveLanguage, translate, useLanguage } from "./localization";
import { AuthContext, type AuthStatus, type AuthUser } from "./authContext";
import "./AuthGate.css";

function messageFrom(response: Response, body: { detail?: string }) {
  return body.detail || `Request failed (${response.status}).`;
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
            if (active) setUser(result.user);
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

  const context = useMemo(() => ({ user, status, refreshStatus, logout }), [user, status, refreshStatus, logout]);
  const isAccountMode = Boolean(status && (status.multi_user_enabled || status.account_count === 0 || (status.account_count > 0 && !user)));

  if (bootError) {
    return <main className="auth-screen" dir={language === "ar" ? "rtl" : "ltr"}>
      <section className="auth-card"><h1>AI TaskFlow</h1><p>{bootError}</p><button onClick={() => window.location.reload()}>{translate("إعادة المحاولة", language)}</button></section>
    </main>;
  }
  if (!status) return <main className="auth-screen"><section className="auth-card"><p>{translate("جارٍ الاتصال بالخادم...", language)}</p></section></main>;
  if (isAccountMode && !user) {
    return <main className="auth-screen" dir={language === "ar" ? "rtl" : "ltr"}>
      <section className="auth-card">
        <div className="auth-language">
          <button type="button" className={language === "ar" ? "active" : ""} onClick={() => saveLanguage("ar")}>العربية</button>
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => saveLanguage("en")}>English</button>
        </div>
        <span className="auth-brand">OPENFILM-AI TASKFLOW EDITION</span>
        <h1>{creating ? translate("إنشاء حساب", language) : translate("تسجيل الدخول", language)}</h1>
        <p>{status.account_count === 0
          ? translate("أول حساب على هذا الجهاز يصبح المسؤول.", language)
          : translate("بيانات كل حساب محفوظة بشكل منفصل.", language)}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label><span>{translate("اسم المستخدم", language)}</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required /></label>
          <label><span>{translate("كلمة المرور", language)}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creating ? "new-password" : "current-password"} minLength={12} maxLength={256} required /></label>
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? translate("جارٍ التنفيذ...", language) : creating ? translate("إنشاء حساب", language) : translate("دخول", language)}</button>
        </form>
        {status.registration_open && <button className="auth-switch" type="button" onClick={() => { setCreating(!creating); setNotice(""); }}>
          {creating ? translate("لديك حساب؟ سجّل الدخول", language) : translate("إنشاء حساب جديد", language)}
        </button>}
        {status.approval_required && status.account_count > 0 && <small>{translate("قد يتطلب الحساب الجديد موافقة المسؤول.", language)}</small>}
      </section>
    </main>;
  }

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
