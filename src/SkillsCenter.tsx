import { useEffect, useRef, useState } from "react";
import { FileUp, FolderUp, Plus, Sparkles, Trash2, Upload } from "lucide-react";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function syncAISkills(event: Event) {
      const next = (event as CustomEvent<SkillSuggestion[]>).detail;
      if (Array.isArray(next)) setSkills(next);
    }
    window.addEventListener("taskflow:ai-skills-updated", syncAISkills);
    return () => window.removeEventListener("taskflow:ai-skills-updated", syncAISkills);
  }, []);

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
          <p>{translate("أدر مهاراتك واستدعها داخل المحادثة بكتابة / ثم اختيار المهارة.", language)}</p>
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
