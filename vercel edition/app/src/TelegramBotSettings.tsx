import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Bot, Check, Copy, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import "./TelegramBotSettings.css";

type Provider = { id: string; name: string; model: string; is_default: boolean };
type Section = "chat" | "tasks" | "projects";
type BotSettings = {
  configured: boolean;
  has_token: boolean;
  enabled: boolean;
  provider_id: string;
  model: string;
  bot_name: string;
  description: string;
  system_prompt: string;
  enabled_sections: Section[];
  command_descriptions: Record<string, string>;
  bot_username: string;
  linked: boolean;
  linked_username: string;
  last_error: string;
};
type LinkCode = { code: string; expires_in_seconds: number; bot_username: string };

const emptySettings: BotSettings = {
  configured: false,
  has_token: false,
  enabled: true,
  provider_id: "",
  model: "",
  bot_name: "",
  description: "",
  system_prompt: "",
  enabled_sections: ["chat", "tasks", "projects"],
  command_descriptions: {},
  bot_username: "",
  linked: false,
  linked_username: "",
  last_error: "",
};

const commandFields = [
  ["help", "/help"],
  ["chat", "/chat"],
  ["tasks", "/tasks"],
  ["task", "/task"],
  ["projects", "/projects"],
  ["project", "/project"],
] as const;
const sectionCommands: Record<Section, string[]> = {
  chat: ["chat"],
  tasks: ["tasks", "task"],
  projects: ["projects", "project"],
};

async function readJson<T>(response: Response): Promise<T> {
  let result: { detail?: unknown };
  try {
    result = await response.json() as { detail?: unknown };
  } catch {
    throw new Error(response.ok
      ? "الخادم أرجع استجابة غير JSON صالحة."
      : `تعذّر إكمال الطلب (${response.status}).`);
  }
  if (!response.ok) {
    const detail = result.detail;
    if (typeof detail === "string") throw new Error(detail);
    if (Array.isArray(detail)) {
      const messages = detail.flatMap((item) => {
        if (!item || typeof item !== "object" || !("msg" in item) || typeof item.msg !== "string") return [];
        return [item.msg.replace(/^Value error,\s*/i, "")];
      });
      if (messages.length) throw new Error(messages.join("؛ "));
    }
    throw new Error(`تعذّر إكمال الطلب (${response.status}). تحقق من بيانات البوت والمزوّد وحاول مجددًا.`);
  }
  return result as T;
}

export default function TelegramBotSettings() {
  const [settings, setSettings] = useState<BotSettings>(emptySettings);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [token, setToken] = useState("");
  const [pairingUrl, setPairingUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch(`${API_BASE}/api/telegram-bot`).then(readJson<BotSettings>),
      apiFetch(`${API_BASE}/api/providers`).then(readJson<Provider[]>),
    ]).then(([botSettings, providerList]) => {
      if (!active) return;
      setSettings(botSettings);
      setProviders(providerList);
      if (!botSettings.provider_id) {
        const preferred = providerList.find((provider) => provider.is_default) ?? providerList[0];
        if (preferred) setSettings((current) => ({ ...current, provider_id: preferred.id, model: preferred.model }));
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل إعدادات بوت تيليجرام.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function updateSection(section: Section, checked: boolean) {
    const enabledSections = checked
      ? [...new Set([...settings.enabled_sections, section])]
      : settings.enabled_sections.filter((item) => item !== section);
    if (!enabledSections.length) {
      setError("يجب تفعيل قسم واحد على الأقل للبوت.");
      return;
    }
    setSettings({ ...settings, enabled_sections: enabledSections });
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.provider_id) {
      setError("أضف مزوّد AI إلى حسابك واختره للبوت.");
      return;
    }
    if (!settings.has_token && !token.trim()) {
      setError("أدخل توكن البوت الذي حصلت عليه من BotFather.");
      return;
    }
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const saved = await readJson<BotSettings>(await apiFetch(`${API_BASE}/api/telegram-bot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: settings.provider_id,
          model: settings.model,
          bot_name: settings.bot_name,
          description: settings.description,
          system_prompt: settings.system_prompt,
          enabled_sections: settings.enabled_sections,
          command_descriptions: settings.command_descriptions,
          enabled: settings.enabled,
          bot_token: token.trim() || undefined,
        }),
      }));
      setSettings(saved);
      setToken("");
      setNotice("تم حفظ الإعدادات. البوت يعمل على الجهاز المستضيف.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر حفظ إعدادات البوت.");
    } finally {
      setBusy(false);
    }
  }

  async function createPairingLink() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const link = await readJson<LinkCode>(await apiFetch(`${API_BASE}/api/telegram-bot/link-code`, { method: "POST" }));
      if (!link.bot_username) throw new Error("تعذّر الحصول على اسم مستخدم البوت.");
      setPairingUrl(`https://t.me/${link.bot_username}?start=${encodeURIComponent(link.code)}`);
      setNotice("رابط الربط صالح لمدة 10 دقائق ويعمل مرة واحدة.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر إنشاء رابط الربط.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const body = new FormData();
      body.append("photo", file);
      await readJson<{ updated: boolean }>(await apiFetch(`${API_BASE}/api/telegram-bot/photo`, { method: "POST", body }));
      setNotice("تم تحديث صورة البوت.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر تحديث صورة البوت.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBot() {
    if (!window.confirm("سيتم حذف ربط البوت وإيقافه. هل تريد المتابعة؟")) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/api/telegram-bot`, { method: "DELETE" });
      if (!response.ok) throw new Error(`تعذّر حذف البوت (${response.status}).`);
      setSettings(emptySettings);
      setToken("");
      setPairingUrl("");
      setNotice("تم حذف إعدادات البوت وإيقافه.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر حذف البوت.");
    } finally {
      setBusy(false);
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === settings.provider_id);

  return (
    <section className="settings-card telegram-bot-settings">
      <h3><Bot size={18} /> بوت تيليجرام لحسابك</h3>
      <p>أنشئ بوتك عبر BotFather واربطه بحساب TaskFlow. يعمل البوت على الجهاز المستضيف، ولا يقرأ أو يعدّل إلا بيانات حسابك.</p>
      <div className="telegram-security-note"><ShieldCheck size={17} /><span>التوكن يُحفظ مشفّرًا على الخادم ولا يظهر مجددًا. لا تشارك رابط الربط؛ يتيح الوصول إلى بوت حسابك.</span></div>
      {loading ? <div className="telegram-loading"><LoaderCircle size={16} className="telegram-spin" /> جارٍ تحميل الإعدادات...</div> : (
        <form className="telegram-settings-form" onSubmit={(event) => void save(event)}>
          <label>
            <span>توكن البوت من BotFather</span>
            <input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={settings.has_token ? "التوكن محفوظ ومشفّر؛ اتركه فارغًا للإبقاء عليه" : "123456789:AA..."} maxLength={256} />
          </label>

          <div className="telegram-fields">
            <label>
              <span>مزوّد الذكاء الاصطناعي الخاص بحسابك</span>
              <select value={settings.provider_id} onChange={(event) => {
                const provider = providers.find((item) => item.id === event.target.value);
                setSettings({ ...settings, provider_id: event.target.value, model: provider?.model ?? "" });
              }}>
                <option value="">اختر مزوّدًا</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label>
              <span>النموذج</span>
              <input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} maxLength={160} placeholder={selectedProvider?.model || "اسم النموذج"} />
            </label>
          </div>
          {!providers.length && <small className="telegram-hint">أضف مزوّدًا أولًا من قسم «مزوّدو AI»؛ البوت يستخدم مزوّد حسابك فقط.</small>}

          <div className="telegram-fields">
            <label>
              <span>اسم البوت</span>
              <input value={settings.bot_name} onChange={(event) => setSettings({ ...settings, bot_name: event.target.value })} maxLength={64} placeholder="مساعدي في TaskFlow" />
            </label>
            <label>
              <span>وصف البوت</span>
              <input value={settings.description} onChange={(event) => setSettings({ ...settings, description: event.target.value })} maxLength={512} placeholder="مساعد شخصي لإدارة مساحة العمل" />
            </label>
          </div>

          <label>
            <span>تعليمات وسلوك المساعد</span>
            <textarea value={settings.system_prompt} onChange={(event) => setSettings({ ...settings, system_prompt: event.target.value })} maxLength={6000} rows={3} placeholder="مثال: أجب بالعربية وباختصار، وركّز على تنظيم المهام." />
          </label>

          <fieldset className="telegram-sections">
            <legend>الأقسام والأوامر المفعّلة</legend>
            <label><input type="checkbox" checked={settings.enabled_sections.includes("chat")} onChange={(event) => updateSection("chat", event.target.checked)} /><span><strong>محادثة AI</strong><small>/chat — محادثة خاصة بالمزوّد الذي اخترته</small></span></label>
            <label><input type="checkbox" checked={settings.enabled_sections.includes("tasks")} onChange={(event) => updateSection("tasks", event.target.checked)} /><span><strong>المهام</strong><small>/tasks للعرض و/task لإنشاء أو تحديث مهمة</small></span></label>
            <label><input type="checkbox" checked={settings.enabled_sections.includes("projects")} onChange={(event) => updateSection("projects", event.target.checked)} /><span><strong>المشروعات</strong><small>/projects للعرض و/project لإنشاء أو تحديث مشروع</small></span></label>
          </fieldset>

          <details className="telegram-command-editor">
            <summary>تعديل أوصاف أوامر تيليجرام</summary>
            <div className="telegram-command-grid">
              {commandFields.filter(([key]) => key === "help" || settings.enabled_sections.some((section) => sectionCommands[section].includes(key))).map(([key, command]) => (
                <label key={key}>
                  <span>{command}</span>
                  <input value={settings.command_descriptions[key] ?? ""} onChange={(event) => setSettings({
                    ...settings,
                    command_descriptions: { ...settings.command_descriptions, [key]: event.target.value },
                  })} maxLength={256} placeholder="الوصف الافتراضي" />
                </label>
              ))}
            </div>
          </details>

          <label className="telegram-enabled">
            <span><strong>تشغيل البوت على الجهاز المستضيف</strong><small>يعمل استقبال رسائل تيليجرام عند تشغيل خدمة AI TaskFlow.</small></span>
            <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
          </label>

          <div className="telegram-form-actions">
            <button type="submit" className="primary-button" disabled={busy || loading || providers.length === 0}>
              {busy ? <><LoaderCircle size={15} className="telegram-spin" /> جارٍ الحفظ...</> : <><Check size={15} /> حفظ وتشغيل البوت</>}
            </button>
            {settings.has_token && <button className="secondary-button" type="button" disabled={busy} onClick={() => void deleteBot()}><Trash2 size={15} /> حذف البوت</button>}
            {settings.has_token && <label className="telegram-photo-button"><ImagePlus size={15} /> تغيير الصورة<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={(event) => void uploadPhoto(event)} /></label>}
          </div>
        </form>
      )}

      {settings.has_token && <div className="telegram-link-panel">
        <div>
          <strong>{settings.linked ? `مرتبط بحساب تيليجرام${settings.linked_username ? ` @${settings.linked_username}` : ""}` : "اربط حساب تيليجرام الخاص بك"}</strong>
          <small>{settings.bot_username ? `البوت: @${settings.bot_username}` : "احفظ الإعدادات أولًا لبدء الربط."}</small>
        </div>
        {settings.enabled && <button type="button" className="secondary-button" disabled={busy} onClick={() => void createPairingLink()}><RefreshCw size={14} /> {settings.linked ? "إعادة الربط" : "إنشاء رابط ربط"}</button>}
        {pairingUrl && <div className="telegram-pairing-url"><a href={pairingUrl} target="_blank" rel="noreferrer">{pairingUrl}</a><button type="button" aria-label="نسخ رابط الربط" onClick={() => void navigator.clipboard.writeText(pairingUrl)}><Copy size={15} /></button></div>}
      </div>}
      {settings.last_error && <p className="telegram-error" role="status">حالة البوت: {settings.last_error}</p>}
      {error && <p className="telegram-error" role="alert">{error}</p>}
      {notice && <p className="telegram-success" role="status">{notice}</p>}
    </section>
  );
}
