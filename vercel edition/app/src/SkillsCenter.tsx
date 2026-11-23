import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileUp, FolderUp, Plus, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { API_BASE, apiFetch } from "./api";
import {
  CUSTOM_SKILLS_STORAGE_KEY,
  parseSkillFileContent,
  quickSkillPresets,
  readCustomSkills,
  selectSkillFiles,
  SKILL_FILE_ACCEPT,
  skillSuggestions,
  toSkillShortcut,
  type SkillSuggestion,
} from "./skills";
import { usePersistentAppData } from "./appData";
import "./SkillsCenter.css";
import { useLanguage, translate } from "./localization";

const TASKFLOW_SKILLS_CATALOG = "https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/catalog.json";
const TASKFLOW_SKILLS_ASSETS = "https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/";
type TaskflowLibrarySkill = { id: string; name: string; description: string; asset: string };
type PublicLibrarySkill = { id: string; source: string; skill_id: string; name: string; installs: number; official: boolean };
const publicSkillLocalId = (source: string, skillId: string) => `skills-sh:${source}/${skillId}`;

export default function SkillsCenter() {
  const language = useLanguage();
  const [localSkills] = useState<SkillSuggestion[]>(readCustomSkills);
  const [skills, setSkills] = usePersistentAppData<SkillSuggestion[]>("skills", localSkills, [CUSTOM_SKILLS_STORAGE_KEY]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [taskflowLibrary, setTaskflowLibrary] = useState<TaskflowLibrarySkill[]>([]);
  const [taskflowLibraryLoading, setTaskflowLibraryLoading] = useState(true);
  const [popularSkills, setPopularSkills] = useState<PublicLibrarySkill[]>([]);
  const [popularSearch, setPopularSearch] = useState("");
  const [popularLoading, setPopularLoading] = useState(true);
  const [installingSkill, setInstallingSkill] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(TASKFLOW_SKILLS_CATALOG, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`تعذّر تحميل مكتبة TaskFlow (${response.status}).`);
        const catalog = await response.json() as { version?: unknown; skills?: unknown };
        if (catalog.version !== 1 || !Array.isArray(catalog.skills)) throw new Error("فهرس مهارات TaskFlow غير صالح.");
        const items = catalog.skills.filter((item): item is TaskflowLibrarySkill =>
          typeof item === "object" && item !== null &&
          "id" in item && typeof item.id === "string" &&
          "name" in item && typeof item.name === "string" &&
          "description" in item && typeof item.description === "string" &&
          "asset" in item && typeof item.asset === "string" &&
          /^skills\/[a-z0-9-]+\/SKILL\.md$/.test(item.asset),
        );
        if (active) setTaskflowLibrary(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر تحميل مكتبة TaskFlow.");
      })
      .finally(() => {
        if (active) setTaskflowLibraryLoading(false);
      });

    apiFetch(`${API_BASE}/api/skills/library/popular`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`تعذّر تحميل المهارات الشائعة (${response.status}).`);
        const result = await response.json() as { skills?: unknown };
        if (!Array.isArray(result.skills)) throw new Error("استجابة مكتبة المهارات الشائعة غير صالحة.");
        if (active) setPopularSkills(result.skills as PublicLibrarySkill[]);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذّر الاتصال بمكتبة المهارات الشائعة.");
      })
      .finally(() => {
        if (active) setPopularLoading(false);
      });

    function syncAISkills(event: Event) {
      const next = (event as CustomEvent<SkillSuggestion[]>).detail;
      if (Array.isArray(next)) setSkills(next);
    }
    window.addEventListener("taskflow:ai-skills-updated", syncAISkills);
    return () => {
      active = false;
      window.removeEventListener("taskflow:ai-skills-updated", syncAISkills);
    };
  }, [setSkills]);

  async function addLibrarySkill(skill: TaskflowLibrarySkill | PublicLibrarySkill) {
    const external = "skill_id" in skill;
    const id = external
      ? publicSkillLocalId(skill.source, skill.skill_id)
      : `taskflow-${skill.id}`;
    setInstallingSkill(id);
    setError("");
    setNotice("");
    try {
      let content: string;
      let source: string;
      if (external) {
        const params = new URLSearchParams({ source: skill.source, skill_id: skill.skill_id });
        const response = await apiFetch(`${API_BASE}/api/skills/library/content?${params}`);
        const result = await response.json() as { content?: unknown; source_url?: unknown; detail?: unknown };
        if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : `تعذّر تحميل المهارة (${response.status}).`);
        if (typeof result.content !== "string" || typeof result.source_url !== "string") throw new Error("ملف المهارة المستورد غير صالح.");
        content = result.content;
        source = `skills.sh:${skill.source}`;
      } else {
        if (!/^skills\/[a-z0-9-]+\/SKILL\.md$/.test(skill.asset)) throw new Error("مسار ملف المهارة غير صالح.");
        const response = await fetch(`${TASKFLOW_SKILLS_ASSETS}${skill.asset}`, { headers: { Accept: "text/markdown" } });
        if (!response.ok) throw new Error(`تعذّر تحميل مهارة TaskFlow (${response.status}).`);
        content = await response.text();
        source = "TaskFlow Skills";
      }

      const parsed = parseSkillFileContent(`${id}/SKILL.md`, content);
      if (!parsed) throw new Error("تعذّر قراءة تعليمات المهارة.");
      const imported: SkillSuggestion = {
        ...parsed,
        id,
        label: skill.name,
        shortcut: toSkillShortcut(skill.name),
        description: ("description" in skill ? skill.description : "") || parsed.description,
        source,
        kind: "custom",
      };
      if (skills.some((item) => item.id === id)) {
        setNotice(`المهارة ${skill.name} مضافة بالفعل إلى حسابك وتعمل في محادثة AI.`);
      } else {
        setSkills((current) => current.some((item) => item.id === id) ? current : [imported, ...current]);
        setNotice(`أُضيفت ${skill.name} إلى مهارات حسابك؛ أصبحت متاحة في محادثات AI لهذا الحساب.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّرت إضافة المهارة.");
    } finally {
      setInstallingSkill("");
    }
  }

  async function searchPopularLibrary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = popularSearch.trim();
    if (query.length < 2) {
      setError("اكتب حرفين على الأقل للبحث في skills.sh.");
      return;
    }
    setPopularLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query });
      const response = await apiFetch(`${API_BASE}/api/skills/library/search?${params}`);
      const result = await response.json() as { skills?: unknown; detail?: unknown };
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : `تعذّر البحث (${response.status}).`);
      if (!Array.isArray(result.skills)) throw new Error("استجابة البحث في skills.sh غير صالحة.");
      setPopularSkills(result.skills as PublicLibrarySkill[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذّر البحث في skills.sh.");
    } finally {
      setPopularLoading(false);
    }
  }

  async function importSkillFiles(files: FileList | null) {
    if (!files?.length) return;
    const supported = selectSkillFiles(Array.from(files));
    if (!supported.length) {
      setError("لم يتم العثور على ملفات مهارات نصية مدعومة.");
      setNotice("");
      return;
    }

    const imported: SkillSuggestion[] = [];
    for (const file of supported) {
      if (file.size > 1024 * 1024) continue;
      try {
        const skill = parseSkillFileContent(file.webkitRelativePath || file.name, await file.text());
        if (skill) imported.push(skill);
      } catch {
        // Skip unreadable files and continue with the rest of the selection.
      }
    }

    if (!imported.length) {
      setError("لم يتم العثور على تعليمات صالحة. الحد الأقصى لحجم الملف الواحد 1 ميغابايت.");
      setNotice("");
      return;
    }

    setSkills((current) => {
      const next = [...current];
      for (const skill of imported) {
        if (!next.some((item) => item.label.toLowerCase() === skill.label.toLowerCase() && item.template === skill.template)) next.unshift(skill);
      }
      return next;
    });
    setError("");
    setNotice(`تم استيراد ${imported.length} مهارة.`);
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  function addPreset(key: keyof typeof quickSkillPresets) {
    const preset = quickSkillPresets[key];
    setSkills((current) => current.some((skill) => skill.label.toLowerCase() === preset.label.toLowerCase())
      ? current
      : [{ ...preset, id: `${preset.id}-${crypto.randomUUID()}` }, ...current]);
    setError("");
    setNotice(`أضيفت مهارة ${preset.label}.`);
  }

  function addManualSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = name.trim();
    const template = instructions.trim();
    if (!label || !template) return;
    const skill: SkillSuggestion = {
      id: `manual-${crypto.randomUUID()}`,
      label,
      shortcut: toSkillShortcut(label),
      description: description.trim() || "مهارة مخصصة",
      template,
      accent: "#10b981",
      kind: "custom",
      source: "manual",
    };
    setSkills((current) => [skill, ...current]);
    setName("");
    setDescription("");
    setInstructions("");
    setShowManualForm(false);
    setError("");
    setNotice(`أضيفت مهارة ${label}.`);
  }

  function openFolderPicker() {
    const input = folderInput.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.click();
  }

  function removeSkill(id: string) {
    const skill = skills.find((item) => item.id === id);
    if (!skill || !window.confirm(translate(`حذف مهارة «${skill.label}»؟`, language))) return;
    setSkills((current) => current.filter((item) => item.id !== id));
    setNotice(`حُذفت مهارة ${skill.label}.`);
  }

  return (
    <section className="skills-center" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="skills-center-heading">
        <div>
          <span className="skills-center-kicker"><Sparkles size={14} /> AI SKILLS</span>
          <h2>{translate("المهارات", language)}</h2>
          <p>{translate("أدر مهاراتك واستدعها داخل المحادثة بكتابة / ثم اختيار المهارة. تُرسل تعليمات المهارة إلى المزوّد المحدد في المحادثة.", language)}</p>
        </div>
        <div className="skills-center-actions">
          <input ref={fileInput} className="skills-file-input" type="file" accept={SKILL_FILE_ACCEPT} multiple onChange={(event) => void importSkillFiles(event.currentTarget.files)} />
          <input ref={folderInput} className="skills-file-input" type="file" accept={SKILL_FILE_ACCEPT} multiple onChange={(event) => void importSkillFiles(event.currentTarget.files)} />
          <button type="button" className="skills-action-button" onClick={() => fileInput.current?.click()}><FileUp size={16} /> {translate("رفع ملفات", language)}</button>
          <button type="button" className="skills-action-button" onClick={openFolderPicker}><FolderUp size={16} /> {translate("رفع مجلد", language)}</button>
          <button type="button" className="skills-action-button primary" onClick={() => setShowManualForm((current) => !current)}><Plus size={16} /> {translate("مهارة جديدة", language)}</button>
        </div>
      </header>

      {error && <div className="skills-feedback error" role="alert">{translate(error, language)}</div>}
      {notice && <div className="skills-feedback" role="status">{translate(notice, language)}</div>}

      <section className="skills-libraries-section">
        <div className="skills-section-heading"><div><h3>{translate("مكتبات المهارات", language)}</h3><p>{translate("أضف المهارة إلى حسابك فتظهر مباشرة في محادثات AI عبر المزوّد المحدد.", language)}</p></div></div>
        <div className="skills-library-columns">
          <section className="skills-library-panel" aria-label="مكتبة TaskFlow">
            <div className="skills-library-heading"><div><h4>{translate("مكتبة TaskFlow", language)}</h4><small>{translate("مهاراتنا الرسمية، مشتركة بين المنصة والمحرر.", language)}</small></div><a href="https://github.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS" target="_blank" rel="noreferrer">GitHub</a></div>
            {taskflowLibraryLoading ? <p className="skills-library-state" role="status">{translate("جارٍ تحميل مكتبة TaskFlow...", language)}</p>
              : taskflowLibrary.length ? <div className="skills-library-list">{taskflowLibrary.map((skill) => {
                const id = `taskflow-${skill.id}`;
                const added = skills.some((item) => item.id === id);
                return <article className="skills-library-item" key={skill.id}>
                  <div><strong>{skill.name}</strong><p>{skill.description}</p></div>
                  <button type="button" className="skills-action-button" disabled={added || installingSkill === id || Boolean(installingSkill)} onClick={() => void addLibrarySkill(skill)}>
                    {added ? translate("مضافة", language) : installingSkill === id ? translate("جارٍ الإضافة...", language) : translate("إضافة", language)}
                  </button>
                </article>;
              })}</div> : <p className="skills-library-state">{translate("لا توجد مهارات في المكتبة حاليًا.", language)}</p>}
          </section>

          <section className="skills-library-panel public" aria-label="مكتبة skills.sh">
            <div className="skills-library-heading"><div><h4>skills.sh</h4><small>{translate("دليل عام متجدد لمهارات مجتمع الوكلاء.", language)}</small></div><a href="https://skills.sh/" target="_blank" rel="noreferrer">skills.sh</a></div>
            <form className="skills-library-search" onSubmit={(event) => void searchPopularLibrary(event)}>
              <input value={popularSearch} onChange={(event) => setPopularSearch(event.target.value)} minLength={2} maxLength={100} placeholder={translate("ابحث عن React أو التصميم أو الاختبارات...", language)} aria-label={translate("البحث في skills.sh", language)} />
              <button type="submit" className="skills-action-button" disabled={popularLoading}><Search size={15} />{translate("بحث", language)}</button>
            </form>
            {popularLoading ? <p className="skills-library-state" role="status">{translate("جارٍ تحميل المهارات الشائعة...", language)}</p>
              : popularSkills.length ? <div className="skills-library-list">{popularSkills.map((skill) => {
                const id = publicSkillLocalId(skill.source, skill.skill_id);
                const added = skills.some((item) => item.id === id);
                const detailsUrl = `https://skills.sh/${skill.source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(skill.skill_id)}`;
                return <article className="skills-library-item" key={skill.id}>
                  <div><strong>{skill.name}</strong><p><span>{skill.source}</span> · {skill.installs.toLocaleString()} {translate("تثبيت", language)}{skill.official ? ` · ${translate("رسمي", language)}` : ""}</p></div>
                  <div className="skills-library-item-actions">
                    <a href={detailsUrl} target="_blank" rel="noreferrer" aria-label={`${translate("تفاصيل", language)} ${skill.name}`}><ExternalLink size={15} /></a>
                    <button type="button" className="skills-action-button" disabled={added || installingSkill === id || Boolean(installingSkill)} onClick={() => void addLibrarySkill(skill)}>
                      {added ? translate("مضافة", language) : installingSkill === id ? translate("جارٍ الإضافة...", language) : translate("إضافة", language)}
                    </button>
                  </div>
                </article>;
              })}</div> : <p className="skills-library-state">{translate("لم يُعثر على مهارات. جرّب بحثًا آخر.", language)}</p>}
          </section>
        </div>
      </section>

      <section className="skills-presets-section">
        <div className="skills-section-heading"><div><h3>{translate("إضافة سريعة", language)}</h3><p>{translate("أضف قوالب جاهزة إلى قائمتك.", language)}</p></div></div>
        <div className="skills-preset-list">
          {(Object.keys(quickSkillPresets) as Array<keyof typeof quickSkillPresets>).map((key) => {
            const preset = quickSkillPresets[key];
            const added = skills.some((skill) => skill.label.toLowerCase() === preset.label.toLowerCase());
            return <button key={key} type="button" className="skills-preset" style={{ "--skill-accent": preset.accent } as React.CSSProperties} onClick={() => addPreset(key)} disabled={added}>
              <span className="skills-preset-mark">{preset.label.slice(0, 1)}</span>
              <span><strong>{translate(preset.label, language)}</strong><small>{translate(preset.description, language)}</small></span>
              <span className="skills-preset-action">{added ? translate("مضافة", language) : translate("إضافة", language)}</span>
            </button>;
          })}
        </div>
      </section>

      {showManualForm && <form className="skills-manual-form" onSubmit={addManualSkill}>
        <label><span>{translate("اسم المهارة", language)}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={translate("مثال: مراجعة الكود", language)} maxLength={60} required /></label>
        <label><span>{translate("وصف مختصر", language)}</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={translate("ما الذي تفعله المهارة؟", language)} maxLength={180} /></label>
        <label className="skills-manual-instructions"><span>{translate("التعليمات", language)}</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={translate("اكتب تعليمات المهارة التي ستُدرج في المحادثة...", language)} maxLength={12000} required rows={5} /></label>
        <button className="skills-action-button primary" type="submit" disabled={!name.trim() || !instructions.trim()}><Plus size={15} /> {translate("حفظ المهارة", language)}</button>
      </form>}

      <section className="skills-list-section">
        <div className="skills-section-heading"><div><h3>{translate("مهاراتك", language)}</h3><p>{skills.length} {translate("مهارة مخصصة محفوظة على هذا الجهاز.", language)}</p></div></div>
        {skills.length ? <div className="skills-grid">
          {skills.map((skill) => <article className="skills-card" key={skill.id} style={{ "--skill-accent": skill.accent } as React.CSSProperties}>
            <div className="skills-card-top"><span className="skills-card-mark"><Sparkles size={17} /></span><span className="skills-card-kind">{skill.source === "preset" ? translate("جاهزة", language) : skill.source === "manual" ? translate("يدوية", language) : translate("مخصصة", language)}</span></div>
            <h4>{skill.label}</h4>
            <code>{skill.shortcut}</code>
            <p>{skill.description}</p>
            <div className="skills-card-footer"><small>{skill.source && !["preset", "manual", "local"].includes(skill.source) ? skill.source.split(/[\\/]/).pop() : translate("جاهزة للاستدعاء من الشات", language)}</small><button type="button" title={translate(`حذف ${skill.label}`, language)} aria-label={translate(`حذف ${skill.label}`, language)} onClick={() => removeSkill(skill.id)}><Trash2 size={15} /></button></div>
          </article>)}
        </div> : <div className="skills-empty"><Upload size={23} /><strong>{translate("لا توجد مهارات مخصصة بعد", language)}</strong><span>{translate("ارفع ملفاتك أو أضف قالبًا جاهزًا أو أنشئ مهارة يدوية.", language)}</span></div>}
      </section>

      <section className="skills-builtins-section">
        <div className="skills-section-heading"><div><h3>{translate("مدمجة", language)}</h3><p>{translate("متاحة دائمًا عند كتابة / في محادثة AI.", language)}</p></div></div>
        <div className="skills-builtin-list">{skillSuggestions.map((skill) => <div key={skill.id}><span>{translate(skill.label, language)}</span><code>{skill.shortcut}</code><small>{translate(skill.description, language)}</small></div>)}</div>
      </section>
    </section>
  );
}
