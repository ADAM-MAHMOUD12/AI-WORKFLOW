import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Cpu,
  GitBranch,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import "./AIProviders.css";
import { useLanguage, translate } from "./localization";


type ProviderKind = "openai_compatible" | "ollama" | "github_copilot";
type PresetId = "openai" | "gemini" | "gemma" | "grok" | "groq" | "openrouter" | "deepseek" | "together" | "mistral" | "ollama" | "custom";
type ProviderPreset = { id: PresetId; label: string; kind: ProviderKind; base_url: string; model: string; key_url: string; docs_url: string; instructions: string; note: string };
const PRESETS: ProviderPreset[] = [
 {id:"openai",label:"OpenAI",kind:"openai_compatible",base_url:"https://api.openai.com/v1",model:"gpt-4o-mini",key_url:"https://platform.openai.com/api-keys",docs_url:"https://developers.openai.com/api/docs/quickstart",instructions:"أنشئ مفتاحًا من صفحة API keys في منصة OpenAI ثم الصقه هنا.",note:"استخدام API منفصل عن اشتراك ChatGPT وقد يتطلب تفعيل الفوترة."},
 {id:"gemini",label:"Google Gemini",kind:"openai_compatible",base_url:"https://generativelanguage.googleapis.com/v1beta/openai",model:"gemini-2.5-flash",key_url:"https://aistudio.google.com/app/apikey",docs_url:"https://ai.google.dev/gemini-api/docs/openai",instructions:"افتح Google AI Studio، أنشئ API key من صفحة المفاتيح، ثم الصقه هنا. اختر موديل Gemini متاحًا لحسابك.",note:"يستخدم Gemini واجهة Google المتوافقة مع OpenAI؛ اترك /openai في نهاية عنوان API."},
 {id:"gemma",label:"Google Gemma",kind:"openai_compatible",base_url:"https://generativelanguage.googleapis.com/v1beta/openai",model:"gemma-4-31b-it",key_url:"https://aistudio.google.com/app/apikey",docs_url:"https://ai.google.dev/gemini-api/docs/openai",instructions:"استخدم مفتاح Google AI Studio نفسه، واختر موديل Gemma متاحًا لحسابك. Gemma مناسب للنصوص وقد لا يدعم الصور أو رسائل النظام.",note:"يُستخدم Gemma عبر واجهة Google المتوافقة مع OpenAI؛ يجب اختيار موديل Gemma مدعوم فعليًا في حسابك."},
 {id:"grok",label:"xAI Grok",kind:"openai_compatible",base_url:"https://api.x.ai/v1",model:"grok-3-mini",key_url:"https://console.x.ai",docs_url:"https://docs.x.ai/docs/api-reference",instructions:"أنشئ API key من xAI Console، ثم الصقه هنا. استخدم اسم موديل Grok كما يظهر في كتالوج الحساب.",note:"يدعم Grok واجهة Chat Completions المتوافقة مع OpenAI، ويمكن ضبط قائمة الموديلات تلقائيًا من الصفحة."},
 {id:"groq",label:"Groq",kind:"openai_compatible",base_url:"https://api.groq.com/openai/v1",model:"llama-3.3-70b-versatile",key_url:"https://console.groq.com/keys",docs_url:"https://console.groq.com/docs/openai",instructions:"أنشئ مفتاحًا من Groq Console > API Keys ثم الصقه هنا.",note:"قد تتغير أسماء الموديلات المتاحة؛ راجع التوثيق."},
 {id:"openrouter",label:"OpenRouter",kind:"openai_compatible",base_url:"https://openrouter.ai/api/v1",model:"openai/gpt-4o-mini",key_url:"https://openrouter.ai/settings/keys",docs_url:"https://openrouter.ai/docs/quickstart",instructions:"أنشئ API key من إعدادات OpenRouter واختر معرّف موديل من الكتالوج.",note:"معرّف الموديل عادة يتضمن الشركة/الموديل مثل openai/gpt-4o-mini."},
 {id:"deepseek",label:"DeepSeek",kind:"openai_compatible",base_url:"https://api.deepseek.com",model:"deepseek-chat",key_url:"https://platform.deepseek.com/api_keys",docs_url:"https://api-docs.deepseek.com/",instructions:"أنشئ مفتاحًا من صفحة API Keys في منصة DeepSeek.",note:"استخدم اسم موديل مدعومًا في حسابك."},
 {id:"together",label:"Together AI",kind:"openai_compatible",base_url:"https://api.together.xyz/v1",model:"meta-llama/Llama-3.3-70B-Instruct-Turbo",key_url:"https://api.together.ai/settings/api-keys",docs_url:"https://docs.together.ai/docs/openai-api-compatibility",instructions:"أنشئ مفتاح API من إعدادات Together AI واختر اسم موديل من صفحة النماذج.",note:"انسخ معرّف الموديل كما يظهر في الكتالوج."},
 {id:"mistral",label:"Mistral AI",kind:"openai_compatible",base_url:"https://api.mistral.ai/v1",model:"mistral-small-latest",key_url:"https://console.mistral.ai/api-keys/",docs_url:"https://docs.mistral.ai/api/",instructions:"أنشئ API key من Mistral AI Studio > API Keys.",note:"قد تتطلب بعض الموديلات خطة أو تفعيل فوترة."},
 {id:"ollama",label:"Ollama (محلي)",kind:"ollama",base_url:"http://localhost:11434/v1",model:"qwen2.5:3b",key_url:"https://ollama.com/download",docs_url:"https://ollama.com/docs",instructions:"ثبّت Ollama، اسحب موديلًا باستخدام ollama pull، ثم اكتب اسمه كما يظهر في ollama list.",note:"تأكد أن Ollama يعمل على جهازك؛ المفتاح غير مطلوب عادة."},
 {id:"custom",label:"مزوّد مخصص",kind:"openai_compatible",base_url:"https://api.example.com/v1",model:"your-model-name",key_url:"",docs_url:"",instructions:"أدخل Base URL واسم الموديل ومفتاح API من توثيق مزوّدك.",note:"يجب أن يدعم Chat Completions المتوافق مع OpenAI. الواجهات ذات التنسيق المختلف تحتاج دعمًا خاصًا في الباكيند."}
];

type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  model: string;
  has_api_key: boolean;
  is_default: boolean;
  created_at: string;
};

type ProviderForm = {
  name: string;
  kind: ProviderKind;
  base_url: string;
  model: string;
  api_key: string;
  is_default: boolean;
};

const emptyForm: ProviderForm = {
  name: "OpenAI",
  kind: "openai_compatible",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  api_key: "",
  is_default: false,
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      "تعذّر الاتصال بالباكيند. تأكد أن نافذة Uvicorn ما زالت تعمل على المنفذ 8000."
    );
  }

  if (!response.ok) {
    let message = `حدث خطأ (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the fallback error message.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export default function AIProviders() {
  const language = useLanguage();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const [selectedPreset, setSelectedPreset] = useState<PresetId>("openai");
  const [showGuide, setShowGuide] = useState(true);
  const activePreset = PRESETS.find((item) => item.id === selectedPreset) ?? PRESETS[0];

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<Provider[]>("/api/providers");
      setProviders(data);
      setNotice(null);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذّر تحميل المزوّدين.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProviders(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProviders]);

  useEffect(() => {
    function reloadAIProviders() { void loadProviders(); }
    window.addEventListener("taskflow:ai-providers-updated", reloadAIProviders);
    return () => window.removeEventListener("taskflow:ai-providers-updated", reloadAIProviders);
  }, [loadProviders]);

  function updateForm<K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handlePresetChange(id: PresetId) {
    const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
    setSelectedPreset(id);
    setForm((current) => ({ ...current, name: id === "custom" ? "" : preset.label, kind: preset.kind, base_url: preset.base_url, model: preset.model, api_key: preset.kind === "ollama" ? "" : current.api_key }));
  }

  async function saveProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.model.trim() || !form.base_url.trim()) {
      setNotice({ type: "error", text: "اكتب اسم المزوّد وعنوان API واسم الموديل." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        is_default: form.is_default || providers.length === 0,
        ...(form.api_key.trim() ? { api_key: form.api_key.trim() } : {}),
      };
      await apiRequest<Provider>("/api/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setForm(emptyForm);
      setShowForm(false);
      setNotice({ type: "success", text: "تم حفظ المزوّد في الباكيند." });
      await loadProviders();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذّر حفظ المزوّد.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function testProvider(provider: Provider) {
    setBusyId(provider.id);
    setNotice(null);
    try {
      const result = await apiRequest<{ message: string }>(
        `/api/providers/${provider.id}/test`,
        { method: "POST" }
      );
      setNotice({
        type: "success",
        text: `الاتصال ناجح مع ${provider.name}. ردّ الموديل: ${result.message}`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "فشل اختبار الاتصال.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function fetchModels(provider: Provider) {
    setBusyId(provider.id);
    setNotice(null);
    try {
      const result = await apiRequest<{ models: string[] }>(
        `/api/providers/${provider.id}/models`
      );
      setModelLists((current) => ({ ...current, [provider.id]: result.models }));
      setNotice({
        type: result.models.length ? "success" : "error",
        text: result.models.length
          ? `تم جلب ${result.models.length} موديل من ${provider.name}.`
          : "الاتصال نجح لكن لم يرجع المزوّد قائمة موديلات عبر /models.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذّر جلب الموديلات.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function selectModel(provider: Provider, model: string) {
    setBusyId(provider.id);
    setNotice(null);
    try {
      await apiRequest<Provider>(`/api/providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ model }),
      });
      setNotice({ type: "success", text: `تم تحديث موديل ${provider.name} إلى ${model}.` });
      await loadProviders();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "تعذّر تحديث الموديل." });
    } finally {
      setBusyId(null);
    }
  }

  async function makeDefault(provider: Provider) {
    setBusyId(provider.id);
    setNotice(null);
    try {
      await apiRequest<Provider>(`/api/providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_default: true }),
      });
      setNotice({ type: "success", text: `تم تعيين ${provider.name} كمزوّد افتراضي.` });
      await loadProviders();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذّر تحديث المزوّد.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProvider(provider: Provider) {
    if (!window.confirm(`هل تريد حذف المزوّد "${provider.name}"؟`)) return;
    setBusyId(provider.id);
    setNotice(null);
    try {
      await apiRequest<void>(`/api/providers/${provider.id}`, { method: "DELETE" });
      setModelLists((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setNotice({ type: "success", text: "تم حذف المزوّد." });
      await loadProviders();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "تعذّر حذف المزوّد.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="provider-hub" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="provider-hub-heading">
        <div>
          <div className="provider-eyebrow"><Cpu size={15} /> AI PROVIDER HUB</div>
          <h2>{translate("مزوّدو الذكاء الاصطناعي", language)}</h2>
          <p>{translate("اربط النماذج المحلية والسحابية من مكان واحد.", language)}</p>
        </div>
        <div className="provider-heading-actions">
          <button className="provider-btn provider-btn-ghost" onClick={() => void loadProviders()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {translate("تحديث", language)}
          </button>
          <button className="provider-btn provider-btn-primary" onClick={() => { setShowForm((value) => !value); setNotice(null); }}>
            {showForm ? <X size={17} /> : <Plus size={17} />}
            {showForm ? translate("إغلاق", language) : translate("إضافة مزوّد", language)}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`provider-notice ${notice.type}`} role="status">
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <span>{translate(notice.text, language)}</span>
          <button aria-label={translate("إغلاق التنبيه", language)} onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}

      {showForm && (
        <form className="provider-form-card" onSubmit={saveProvider}>
          <div className="provider-form-title">
            <div className="provider-form-icon"><Plus size={19} /></div>
            <div><h3>{translate("إعداد مزوّد جديد", language)}</h3><p>{translate("مفتاح API يُرسل إلى الباكيند فقط ولا يُحفظ في المتصفح.", language)}</p></div>
          </div>

          <div className="provider-form-grid">
            <label className="provider-form-wide"><span>{translate("اختر المزوّد أو النموذج", language)}</span><div className="provider-select-wrap"><select value={selectedPreset} onChange={(e) => handlePresetChange(e.target.value as PresetId)}>{PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{translate(preset.label, language)}</option>)}</select><ChevronDown size={15} /></div><small>{translate("اختيار مزوّد جاهز يملأ عنوان API واسم موديل مقترح، ويمكنك تعديلهما.", language)}</small></label>
            <label><span>{translate("اسم المزوّد داخل TaskFlow", language)}</span><input value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder={translate("مثال: Gemini للعمل", language)} required maxLength={80} /></label>
            <label><span>{translate("نوع الاتصال", language)}</span><input value={form.kind === "ollama" ? "Ollama" : "OpenAI-compatible"} readOnly /></label>
            <label className="provider-form-wide"><span>Base URL</span><input value={form.base_url} onChange={(e) => updateForm("base_url", e.target.value)} placeholder="https://api.example.com/v1" required type="url" /><small>{translate("العنوان الأساسي فقط؛ لا تضف /chat/completions في النهاية.", language)}</small></label>
            <label><span>{translate("اسم الموديل / Model ID", language)}</span><input value={form.model} onChange={(e) => updateForm("model", e.target.value)} placeholder="gpt-4o-mini" required maxLength={160} /></label>
            <label><span>{translate("مفتاح API", language)} <em>{form.kind === "ollama" ? translate("(اختياري)", language) : translate("(مطلوب غالبًا)", language)}</em></span><input value={form.api_key} onChange={(e) => updateForm("api_key", e.target.value)} placeholder={translate("الصق المفتاح هنا", language)} type="password" autoComplete="new-password" /></label>
          </div>
          <section className="provider-guide"><button type="button" className="provider-guide-toggle" onClick={() => setShowGuide((value) => !value)}><span><ShieldCheck size={16} /> {translate("دليل إعداد", language)} {translate(activePreset.label, language)}</span><ChevronDown className={showGuide ? "guide-chevron open" : "guide-chevron"} size={16} /></button>{showGuide && <div className="provider-guide-body"><p>{translate(activePreset.instructions, language)}</p><div className="provider-guide-links">{activePreset.key_url && <a href={activePreset.key_url} target="_blank" rel="noreferrer">{translate("الحصول على API Key ↗", language)}</a>}{activePreset.docs_url && <a href={activePreset.docs_url} target="_blank" rel="noreferrer">{translate("التوثيق الرسمي ↗", language)}</a>}</div><small>{translate(activePreset.note, language)}</small></div>}</section>
          <label className="provider-default-toggle">
            <input type="checkbox" checked={form.is_default || providers.length === 0} onChange={(e) => updateForm("is_default", e.target.checked)} disabled={providers.length === 0} />
            <span>{translate("تعيين كمزوّد افتراضي", language)}</span>
          </label>

          <div className="provider-form-footer">
            <span><ShieldCheck size={15} /> {translate("مفاتيح API مشفّرة في قاعدة بيانات الباكيند.", language)}</span>
            <button className="provider-btn provider-btn-primary" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
              {saving ? translate("جارٍ الحفظ...", language) : translate("حفظ المزوّد", language)}
            </button>
          </div>
        </form>
      )}

      <div className="provider-summary-row">
        <div className="provider-summary-card">
          <span className="provider-summary-icon"><Server size={18} /></span>
          <div><span>{translate("المزوّدون المحفوظون", language)}</span><strong>{providers.length}</strong></div>
        </div>
        <div className="provider-summary-card">
          <span className="provider-summary-icon green"><Activity size={18} /></span>
          <div><span>{translate("مزوّد افتراضي", language)}</span><strong>{providers.some((item) => item.is_default) ? translate("مُعيّن", language) : translate("غير معيّن", language)}</strong></div>
        </div>
      </div>

      <div className="provider-list-heading">
        <div><h3>{translate("اتصالاتك", language)}</h3><p>{translate("حالة الاتصال لا تعتبر ناجحة إلا بعد الاختبار.", language)}</p></div>
        <span className="provider-count">{providers.length} {translate("مزوّد", language)}</span>
      </div>

      {loading ? (
        <div className="provider-empty"><LoaderCircle className="spin" size={23} /><span>{translate("جارٍ تحميل المزوّدين...", language)}</span></div>
      ) : providers.length === 0 ? (
        <div className="provider-empty">
          <div className="provider-empty-icon"><Cpu size={28} /></div>
          <h3>{translate("لسه مفيش مزوّد متضاف", language)}</h3>
          <p>{translate("أضف اتصالًا سحابيًا أو نموذجًا محليًا لبدء اختبار الذكاء الاصطناعي.", language)}</p>
          <button className="provider-btn provider-btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> {translate("إضافة أول مزوّد", language)}</button>
        </div>
      ) : (
        <div className="provider-cards">
          {providers.map((provider) => (
            <article className="provider-item-card" key={provider.id}>
              <div className="provider-item-top">
                <div className={`provider-item-icon ${provider.kind === "ollama" ? "local" : provider.kind === "github_copilot" ? "github" : "cloud"}`}>
                  {provider.kind === "ollama" ? <Cpu size={22} /> : provider.kind === "github_copilot" ? <GitBranch size={22} /> : <BrainCircuitIcon />}
                </div>
                <div className="provider-item-main">
                  <div className="provider-item-title">
                    <h3>{provider.name}</h3>
                    {provider.is_default && <span className="provider-default-badge"><CheckCircle2 size={12} /> {translate("الافتراضي", language)}</span>}
                  </div>
                  <p>{provider.kind === "ollama"
                    ? translate("نموذج محلي عبر Ollama", language)
                    : provider.kind === "github_copilot"
                      ? translate("يستخدم اشتراك Copilot لحساب GitHub المرتبط", language)
                      : translate("واجهة API متوافقة مع OpenAI", language)}</p>
                </div>
                {provider.kind !== "github_copilot" && <button className="provider-delete-btn" onClick={() => void deleteProvider(provider)} disabled={busyId === provider.id} title={translate("حذف المزوّد", language)} aria-label={translate(`حذف ${provider.name}`, language)}><Trash2 size={17} /></button>}
              </div>

              <div className="provider-details">
                <div><span>{translate("الموديل", language)}</span><code>{provider.model}</code></div>
                <div><span>{translate("عنوان API", language)}</span><code dir="ltr">{provider.base_url}</code></div>
                <div><span>{translate(provider.kind === "github_copilot" ? "حساب GitHub" : "مفتاح API", language)}</span><strong>{provider.kind === "github_copilot"
                  ? translate("يستخدم ربط GitHub المحفوظ", language)
                  : provider.has_api_key ? translate("محفوظ بشكل مشفّر", language) : translate("بدون مفتاح", language)}</strong></div>
              </div>

              {modelLists[provider.id] && (
                <div className="provider-model-list">
                  <strong>{translate("الموديلات المتاحة (", language)}{modelLists[provider.id].length})</strong>
                  {modelLists[provider.id].length
                    ? <div>{modelLists[provider.id].map((model) => <button key={model} type="button" disabled={busyId === provider.id || model === provider.model} aria-pressed={model === provider.model} onClick={() => void selectModel(provider, model)}>{model}{model === provider.model ? translate(" · حالي", language) : translate(" · اختر", language)}</button>)}</div>
                    : <p>{translate("لم يرجع المزوّد أي موديلات.", language)}</p>}
                </div>
              )}

              <div className="provider-item-footer">
                <span className="provider-key-state"><ShieldCheck size={14} /> {provider.kind === "github_copilot"
                  ? translate("يستخدم ربط GitHub المحفوظ", language)
                  : provider.has_api_key ? translate("المفتاح محفوظ بأمان", language) : translate("لا يوجد مفتاح محفوظ", language)}</span>
                <div className="provider-item-actions">
                  {provider.kind !== "github_copilot" && !provider.is_default && <button className="provider-btn provider-btn-ghost small" onClick={() => void makeDefault(provider)} disabled={busyId === provider.id}>{translate("تعيين افتراضي", language)}</button>}
                  <button className="provider-btn provider-btn-ghost small" onClick={() => void fetchModels(provider)} disabled={busyId === provider.id}>
                    {busyId === provider.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                    {translate("الموديلات", language)}
                  </button>
                  <button className="provider-btn provider-btn-test small" onClick={() => void testProvider(provider)} disabled={busyId === provider.id}>
                    {busyId === provider.id ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />}
                    {translate("اختبر الاتصال", language)}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="provider-security-note">
        <ShieldCheck size={17} />
        <span>{translate("الواجهة لا تحفظ مفاتيح API في localStorage. لا تفتح الباكيند للإنترنت قبل إضافة مصادقة مستخدمين وحماية مناسبة.", language)}</span>
      </div>
    </div>
  );
}

function BrainCircuitIcon() {
  return <Cpu size={22} />;
}
