
import { useMemo, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  ExternalLink,
  KeyRound,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  AlertTriangle,
  FolderKanban,
  FileText,
  Mic,
  Bot,
} from "lucide-react";

import "./HelpCenter.css";
import { useLanguage, translate } from "./localization";

type Section = "start" | "providers" | "skills" | "design" | "tasks" | "projects" | "speaking" | "telegram" | "markdown" | "accounts" | "engines" | "ai-bridge" | "security" | "troubleshooting";

const sections: { id: Section; title: string; icon: typeof BookOpen }[] = [
  { id: "start", title: "البداية السريعة", icon: Sparkles },
  { id: "providers", title: "مزوّدو AI", icon: BrainCircuit },
  { id: "skills", title: "المهارات المخصصة", icon: FolderKanban },
  { id: "design", title: "استوديو التصميم", icon: FileText },
  { id: "tasks", title: "إدارة المهام", icon: CheckCircle2 },
  { id: "projects", title: "المشاريع", icon: FolderKanban },
  { id: "speaking", title: "مدرّب المحادثة الصوتي", icon: Mic },
  { id: "telegram", title: "بوت تيليجرام", icon: Bot },
  { id: "markdown", title: "مستند Markdown", icon: FileText },
  { id: "accounts", title: "الحسابات وتعدد المستخدمين", icon: KeyRound },
  { id: "engines", title: "الشبكة والمحركات", icon: ShieldCheck },
  { id: "ai-bridge", title: "طبقة ترجمة أوامر AI", icon: BrainCircuit },
  { id: "security", title: "الأمان والخصوصية", icon: ShieldCheck },
  { id: "troubleshooting", title: "حل المشكلات", icon: AlertTriangle },
];

const providers = [
  { name: "Google Gemini", model: "gemini-2.5-flash", url: "https://aistudio.google.com/app/apikey", description: "نماذج Google Gemini، مناسبة للمحادثة والمهام الذكية." },
  { name: "OpenAI", model: "gpt-4o-mini", url: "https://platform.openai.com/api-keys", description: "نماذج OpenAI عبر واجهة API." },
  { name: "Groq", model: "llama-3.3-70b-versatile", url: "https://console.groq.com/keys", description: "استضافة نماذج مفتوحة بسرعة استجابة عالية." },
  { name: "OpenRouter", model: "openai/gpt-4o-mini", url: "https://openrouter.ai/keys", description: "الوصول إلى نماذج متعددة من خلال واجهة موحدة." },
  { name: "DeepSeek", model: "deepseek-chat", url: "https://platform.deepseek.com/api_keys", description: "نماذج للمحادثة والبرمجة والاستدلال." },
  { name: "Mistral AI", model: "mistral-small-latest", url: "https://console.mistral.ai/api-keys/", description: "نماذج Mistral عبر API." },
  { name: "Ollama", model: "qwen2.5:3b", url: "https://ollama.com/download", description: "تشغيل نماذج الذكاء الاصطناعي محليًا على جهازك." },
  { name: "Custom Provider", model: "حسب المزود", url: "", description: "إضافة أي خدمة تدعم واجهة OpenAI-compatible." },
];

export default function HelpCenter({ onClose }: { onClose: () => void }) {
  const language = useLanguage();
  const [active, setActive] = useState<Section>("start");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(s => s.title.toLowerCase().includes(q) || translate(s.title, language).toLowerCase().includes(q));
  }, [search, language]);

  function openProvider(url: string) {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="help-overlay" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section className="help-window" dir={language === "ar" ? "rtl" : "ltr"}>
        <header className="help-header">
          <div className="help-brand">
            <div className="help-logo"><CircleHelp size={23} /></div>
            <div>
              <h2>{translate("مركز المساعدة", language)}</h2>
              <p>{translate("دليلك الكامل لاستخدام AI TaskFlow", language)}</p>
            </div>
          </div>
          <button className="help-close" onClick={onClose} aria-label={translate("إغلاق", language)}>
            <X size={21} />
          </button>
        </header>

        <div className="help-search">
          <Search size={18} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={translate("ابحث في دليل الاستخدام...", language)} />
        </div>

        <div className="help-body">
          <aside className="help-sidebar">
            <span className="help-nav-label">{translate("الدليل", language)}</span>
            {filtered.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id}
                  className={`help-nav-item ${active === item.id ? "active" : ""}`}
                  onClick={() => setActive(item.id)}>
                  <Icon size={17} />
                  {translate(item.title, language)}
                  <ChevronLeft size={15} />
                </button>
              );
            })}
            {filtered.length === 0 && <p className="help-empty">{translate("لا توجد نتائج.", language)}</p>}
          </aside>

          <main className="help-article">
            {active === "start" && <>
              <span className="help-kicker">{translate("ابدأ هنا", language)}</span>
              <h1>{translate("أهلاً بك في TaskFlow 👋", language)}</h1>
              <p className="help-lead">{translate("مساحة واحدة لتنظيم مهامك ومشاريعك والاستفادة من مزوّدي الذكاء الاصطناعي.", language)}</p>
              <div className="help-callout">
                <Sparkles size={20} />
                <div><strong>{translate("ابدأ في 3 خطوات", language)}</strong><p>{translate("أنشئ مشروعًا، أضف مهامك، ثم اربط مزوّد AI إذا أردت استخدام ميزات الذكاء الاصطناعي.", language)}</p></div>
              </div>
              <h3>{translate("التعرف على الواجهة", language)}</h3>
              <div className="help-info-grid">
                <article><BookOpen /><strong>{translate("نظرة عامة", language)}</strong><p>{translate("ملخص المهام والمشاريع ونسبة الإنجاز.", language)}</p></article>
                <article><CheckCircle2 /><strong>{translate("الاستخدام اليومي", language)}</strong><p>{translate("تابع المهام التي لم تنتهِ منها.", language)}</p></article>
                <article><Workflow /><strong>{translate("مخطط التدفق", language)}</strong><p>{translate("اعرض خطوات العمل بصريًا.", language)}</p></article>
                <article><BrainCircuit /><strong>{translate("مزوّدو AI", language)}</strong><p>{translate("أضف خدمات الذكاء الاصطناعي واختبر اتصالها.", language)}</p></article>
              </div>
            </>}

            {active === "providers" && <>
              <span className="help-kicker">AI PROVIDERS</span>
              <h1>{translate("إعداد مزوّدي الذكاء الاصطناعي", language)}</h1>
              <p className="help-lead">{translate("اربط الخدمة التي تفضلها باستخدام مفتاح API الخاص بك.", language)}</p>
              <div className="help-callout"><KeyRound size={20}/><div><strong>{translate("ما هو API Key؟", language)}</strong><p>{translate("مفتاح سري يسمح للتطبيق بالاتصال بخدمة الذكاء الاصطناعي نيابة عنك. لا تشاركه مع أحد.", language)}</p></div></div>
              <h3>{translate("المزوّدون المدعومون في الدليل", language)}</h3>
              <div className="provider-help-list">
                {providers.map(p => <article className="provider-help-card" key={p.name}>
                  <div className="provider-help-top">
                    <div><strong>{p.name}</strong><p>{translate(p.description, language)}</p></div>
                    <span className="provider-help-tag">{p.model}</span>
                  </div>
                  {p.url && <button className="help-link" onClick={() => openProvider(p.url)}>
                    {translate("الحصول على المفتاح", language)} <ExternalLink size={14}/>
                  </button>}
                </article>)}
              </div>
              <h3>{translate("طريقة إضافة مزوّد", language)}</h3>
              <ol className="help-steps">
                <li>{translate("افتح صفحة «مزوّدو الذكاء الاصطناعي» من القائمة الجانبية.", language)}</li>
                <li>{translate("اختر المزوّد المطلوب أو Custom.", language)}</li>
                <li>{translate("أدخل اسم المزوّد ومفتاح API وعنوان الخدمة إذا طُلب.", language)}</li>
                <li>{translate("أدخل اسم النموذج الصحيح الذي توفره الخدمة.", language)}</li>
                <li>{translate("احفظ الإعدادات ثم استخدم زر اختبار الاتصال.", language)}</li>
              </ol>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("أسماء النماذج وعناوين API قد تتغير. استخدم القيم الرسمية من وثائق المزوّد، وتأكد أن الخطة تسمح باستخدام API.", language)}</p></div>
              <h3>{translate("ما معنى Custom Provider؟", language)}</h3>
              <p>{translate("يُستخدم لإضافة خدمة أخرى تدعم واجهة OpenAI-compatible. تحتاج عادةً إلى Base URL واسم النموذج ومفتاح API إن كان مطلوبًا.", language)}</p>
            </>}

            {active === "skills" && <>
              <span className="help-kicker">CUSTOM SKILLS</span>
              <h1>{translate("المهارات المخصصة", language)}</h1>
              <p className="help-lead">{translate("أضف تعليمات متكررة مرة واحدة، ثم استدعها من أي محادثة باختصار يبدأ بـ /.", language)}</p>
              <div className="help-callout"><Sparkles size={20}/><div><strong>{translate("نمط المهارة", language)}</strong><p>{translate("تظهر المهارات في كروت ملونة مربعة مع تمييز واضح، ويمكن إدراجها فورًا في الرسالة برمز /.", language)}</p></div></div>
              <h3>{translate("الملفات المدعومة", language)}</h3>
              <ul className="help-bullets">
                <li>.md / .mdx / .markdown / .rst / .adoc</li>
                <li>.txt / .text</li>
                <li>.json</li>
                <li>.yaml / .yml / .toml / .xml</li>
                <li>.prompt / .prompt.md</li>
                <li>.instructions / .instructions.md / .agent / .agent.md</li>
                <li>{translate(".mdc / .rules / .cursorrules / .windsurfrules / .clinerules / .roorules / .skill النصي", language)}</li>
              </ul>
              <h3>{translate("رفع المهارات", language)}</h3>
              <ol className="help-steps">
                <li>{translate("افتح قسم «المهارات» من القائمة الجانبية.", language)}</li>
                <li>{translate("استخدم «رفع ملفات» لرفع ملف، أو «رفع مجلد» لاختيار مجلد كامل.", language)}</li>
                <li>{translate("مجلد Claude القياسي يُقرأ من ملف SKILL.md؛ لا تُحوّل ملفات references إلى مهارات منفصلة.", language)}</li>
                <li>{translate("أضف مهارات Claude أو GPT أو Gemini الجاهزة من قسم «إضافة سريعة»، أو أنشئ مهارة يدوية.", language)}</li>
                <li>{translate("اكتب / في المحادثة، ثم اختر بطاقة المهارة الملونة لإدراج تعليماتها في الرسالة.", language)}</li>
                <li>{translate("تُحفظ المهارات المضافة في قاعدة البيانات المحلية، وتبقى متاحة في المحادثات التالية.", language)}</li>
              </ol>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("استخدم ملفات نصية. في JSON/YAML يمكن توفير name أو title و description و prompt أو template؛ وفي Markdown يُستخدم نص الملف كتعليمات، ويمكن أن يحتوي SKILL.md على ترويسة YAML. الملفات الثنائية وملفات ZIP غير مستوردة.", language)}</p></div>
            </>}

            {active === "design" && <>
              <span className="help-kicker">DESIGN STUDIO</span>
              <h1>{translate("استوديو التصميم", language)}</h1>
              <p className="help-lead">{translate("مصمّم شعارات مرحلي ولوحة Vector محلية، ولا يحتاج إنشاء العلامة إلى دعم توليد الصور من الموديل.", language)}</p>
              <ul className="help-bullets">
                <li><strong>{translate("الرسم:", language)}</strong> {translate("استخدم التحديد والتحريك أو الفرشاة، وأضف مستطيلات ودوائر ونصوصًا.", language)}</li>
                <li><strong>{translate("الصور:", language)}</strong> {translate("ارفع صورة وأدرجها كطبقة قابلة للتحريك والتحجيم.", language)}</li>
                <li><strong>{translate("الطبقات:", language)}</strong> {translate("حدد العنصر، أخفه أو غيّر ترتيبه، واحذفه عند الحاجة.", language)}</li>
                <li><strong>{translate("التراجع:", language)}</strong> {translate("استخدم زري التراجع والإعادة للعودة بين تغييرات اللوحة.", language)}</li>
                <li><strong>{translate("التصدير:", language)}</strong> {translate("نزّل اللوحة كصورة PNG عالية الدقة.", language)}</li>
                <li><strong>{translate("إنشاء الشعار:", language)}</strong> {translate("اكتب اسم العلامة ونشاطها وجمهورها وأسلوبها، ثم راقب بناء الفكرة والرمز والكتابة والألوان على اللوحة.", language)}</li>
                <li><strong>{translate("الإيقاف:", language)}</strong> {translate("أوقف التوليد في أي وقت؛ المراحل المنجزة تبقى على اللوحة.", language)}</li>
              </ul>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("التصميم يُحفظ تلقائيًا محليًا في المتصفح. الصور الكبيرة قد تستهلك مساحة التخزين؛ الحد الأقصى للملف الواحد 12 ميغابايت.", language)}</p></div>
            </>}

            {active === "tasks" && <>
              <span className="help-kicker">TASK MANAGEMENT</span>
              <h1>{translate("إدارة المهام", language)}</h1>
              <p className="help-lead">{translate("حوّل أهدافك إلى خطوات صغيرة قابلة للتنفيذ.", language)}</p>
              <ul className="help-bullets">
                <li><strong>{translate("إضافة مهمة:", language)}</strong> {translate("اضغط زر + واكتب اسم المهمة.", language)}</li>
                <li><strong>{translate("إكمال المهمة:", language)}</strong> {translate("اضغط مربع التحديد بجانبها.", language)}</li>
                <li><strong>{translate("الأولوية:", language)}</strong> {translate("استخدم عالية أو متوسطة أو منخفضة لتنظيم الأهمية.", language)}</li>
                <li><strong>{translate("البحث:", language)}</strong> {translate("استخدم مربع البحث أعلى التطبيق للوصول إلى مهمة بسرعة.", language)}</li>
                <li><strong>{translate("مهام اليوم:", language)}</strong> {translate("تعرض المهام غير المكتملة.", language)}</li>
              </ul>
            </>}

            {active === "projects" && <>
              <span className="help-kicker">PROJECTS</span>
              <h1>{translate("إدارة المشاريع", language)}</h1>
              <p className="help-lead">{translate("اجمع المهام المرتبطة داخل مشاريع منفصلة.", language)}</p>
              <ul className="help-bullets">
                <li>{translate("افتح «المشاريع» من القائمة الجانبية.", language)}</li>
                <li>{translate("اضغط «مشروع جديد» وأدخل اسم المشروع.", language)}</li>
                <li>{translate("تابع نسبة التقدم المعروضة في بطاقة المشروع.", language)}</li>
                <li>{translate("استخدم زر عرض سير المشروع للانتقال إلى مخطط التدفق.", language)}</li>
              </ul>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("في النسخة الحالية، إنشاء المهام يربطها تلقائيًا بأول مشروع في القائمة. تغيير المشروع لكل مهمة يحتاج إلى تطوير إضافي.", language)}</p></div>
            </>}

            {active === "speaking" && <>
              <span className="help-kicker">SPEAKING PRACTICE</span>
              <h1>{translate("مدرّب المحادثة الصوتي", language)}</h1>
              <p className="help-lead">{translate("تدرّب على أجزاء المحادثة، وسجّل إجابتك أو اكتبها لتحصل على ملاحظات من مزوّد AI الذي تختاره.", language)}</p>
              <ol className="help-steps">
                <li>{translate("افتح «مدرّب المحادثة» واختر مزوّد AI من حسابك. تُستخدم خدمة المزوّد للتقييم وتوليد الأسئلة.", language)}</li>
                <li>{translate("اختر الجزء الأول أو الثاني أو الثالث، ثم حدّد أسلوب سامي: مشجّع أو ساخر بلطف أو هادئ أو حازم.", language)}</li>
                <li>{translate("استخدم السؤال الجاهز، أو اكتب موضوعًا في خانة طلب الأسئلة الجديدة ليولّد المزوّد أسئلة تدريبية.", language)}</li>
                <li>{translate("اكتب إجابتك أو سجّلها بالميكروفون. عند أول استخدام، نزّل نموذج Whisper المحلي مرة واحدة (نحو 148 ميغابايت) واسمح للمتصفح باستخدام الميكروفون.", language)}</li>
                <li>{translate("راجع التقييم ثم اطلب قراءة الملاحظات أو السؤال بصوت محلي. نزّل صوت Piper العربي أو الإنجليزي المطلوب عند أول استخدام.", language)}</li>
              </ol>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("التسجيل والتفريغ الصوتي وتوليد الصوت محلية على الجهاز. أما التقييم والأسئلة الجديدة وتشكيل النص العربي قبل القراءة فتُرسل إلى مزوّد AI المختار وقد تخضع لتسعيرته. تقييم IELTS المعروض تدريبي وغير رسمي.", language)}</p></div>
            </>}

            {active === "telegram" && <>
              <span className="help-kicker">TELEGRAM BOT</span>
              <h1>{translate("إعداد بوت تيليجرام لحسابك", language)}</h1>
              <p className="help-lead">{translate("استخدم مساحة العمل من تيليجرام عبر بوت يعمل على الجهاز المضيف، مع بقاء بياناته ومزوّد AI خاصين بحسابك.", language)}</p>
              <ol className="help-steps">
                <li>{translate("أنشئ بوتًا من BotFather في تيليجرام، ثم انسخ التوكن إلى «الإعدادات» ثم «بوت تيليجرام لحسابك». لا تشارك التوكن أو رابط الربط.", language)}</li>
                <li>{translate("أضف مزوّد AI إلى حسابك أولًا، ثم اختره والنموذج في إعدادات البوت. أضف الاسم والوصف والتعليمات، وحدّد أقسام المحادثة والمهام والمشروعات.", language)}</li>
                <li>{translate("احفظ الإعدادات لتشغيل البوت على الجهاز المستضيف. يمكنك تعديل أوصاف الأوامر وإضافة صورة للبوت من الصفحة نفسها.", language)}</li>
                <li>{translate("أنشئ رابط الربط وافتحه من حساب تيليجرام الذي تريد ربطه. استخدمه في محادثة خاصة خلال 10 دقائق؛ الرابط صالح لمرة واحدة.", language)}</li>
                <li>{translate("استخدم /help للتعرّف على الأوامر، و/chat للمحادثة، و/tasks أو /task للمهام، و/projects أو /project للمشروعات.", language)}</li>
              </ol>
              <div className="help-callout"><ShieldCheck size={20}/><div><strong>{translate("خصوصية وربط الحساب", language)}</strong><p>{translate("يُحفظ التوكن مشفّرًا ولا يظهر مجددًا. لا يستجيب البوت إلا لحساب تيليجرام المرتبط، ويصل إلى بيانات حساب TaskFlow الذي أنشأه فقط. يجب أن تظل خدمة الباكيند على الجهاز المضيف قيد التشغيل لاستقبال الرسائل.", language)}</p></div></div>
              <div className="help-warning"><AlertTriangle size={18}/><p>{translate("رسائل المحادثة وأوامر الإنشاء أو التحديث تستخدم مزوّد AI المحدد وقد تترتب عليها رسوم. تيليجرام ومزوّد AI يخضعان لشروطهما الخاصة.", language)}</p></div>
            </>}

            {active === "markdown" && <>
              <span className="help-kicker">DOCUMENTATION</span>
              <h1>{translate("مستند Markdown", language)}</h1>
              <p className="help-lead">{translate("اكتب مستندات المشاريع بخفة وعاين تنسيقها مباشرة.", language)}</p>
              <ul className="help-bullets">
                <li><strong>{translate("المحرر:", language)}</strong> {translate("كتابة وتعديل النص.", language)}</li>
                <li><strong>{translate("تقسيم:", language)}</strong> {translate("المحرر والمعاينة جنبًا إلى جنب.", language)}</li>
                <li><strong>{translate("المعاينة:", language)}</strong> {translate("مشاهدة المستند بعد التنسيق.", language)}</li>
                <li><strong>{translate("إنشاء من المهام:", language)}</strong> {translate("إنشاء مسودة من المشاريع والمهام الحالية.", language)}</li>
              </ul>
              <div className="help-code">{translate("# عنوان رئيسي", language)}{"\n\n"}{translate("## عنوان فرعي", language)}{"\n\n"}{translate("- مهمة أولى", language)}{"\n"}{translate("- مهمة ثانية", language)}{"\n\n"}{translate("**نص عريض**", language)}</div>
            </>}

            {active === "accounts" && <>
              <span className="help-kicker">ACCOUNTS</span>
              <h1>{translate("الحسابات وتعدد المستخدمين", language)}</h1>
              <p className="help-lead">{translate("كل حساب له مساحة بيانات ومزوّدو AI مستقلون عن بقية الحسابات.", language)}</p>
              <ol className="help-steps">
                <li>{translate("أنشئ أول حساب على الجهاز المضيف؛ يصبح هذا الحساب مسؤول الجهاز.", language)}</li>
                <li>{translate("أنشئ حسابًا مستقلًا لكل مستخدم بكلمة مرور لا تقل عن 12 حرفًا.", language)}</li>
                <li>{translate("يمكن للمسؤول تفعيل موافقة التسجيل من الإعدادات ثم قبول الطلبات أو رفضها.", language)}</li>
                <li>{translate("يسجل كل مستخدم الدخول من الجهاز الذي يصل إلى رابط المضيف، وتُحفظ بياناته تحت هويته في قاعدة البيانات.", language)}</li>
                <li>{translate("أضف مفاتيح AI داخل حساب المستخدم المناسب، ولا تشاركها بين الحسابات.", language)}</li>
              </ol>
            </>}

            {active === "engines" && <>
              <span className="help-kicker">HOST & ENGINES</span>
              <h1>{translate("الشبكة والمحركات", language)}</h1>
              <p className="help-lead">{translate("وضع الجهاز فقط هو الافتراضي. مشاركة الشبكة مخصصة لشبكة محلية موثوقة وليست للنشر على الإنترنت.", language)}</p>
              <ol className="help-steps">
                <li>{translate("افتح الإعدادات بحساب المسؤول، وأوقف خيار «تشغيل على هذا الجهاز فقط» إذا أردت اتصال أجهزة الشبكة.", language)}</li>
                <li>{translate("احفظ التغيير ثم أعد تشغيل start-all.bat؛ سيعرض عنوان IP ورابط الواجهة.", language)}</li>
                <li>{translate("اسمح للخدمات في جدار حماية Windows على الشبكة المحلية فقط عند ظهور التنبيه.", language)}</li>
                <li>{translate("أوقف محرك OpenCalque 2D أو AI TaskFlow 3D أو OpenFilm إذا لم تكن تحتاجه؛ لا يبدأ المحرك المعطّل بعد إعادة التشغيل.", language)}</li>
                <li>{translate("إعدادات الشبكة ومحركات 2D/3D تحتاج إعادة تشغيل المشغّل. يبدأ OpenFilm عند فتح قسم الموشن.", language)}</li>
              </ol>
            </>}

            {active === "ai-bridge" && <>
              <span className="help-kicker">AI COMMAND TRANSLATION</span>
              <h1>{translate("طبقة ترجمة أوامر AI", language)}</h1>
              <p className="help-lead">{translate("طبقة تكامل خاصة بالمشروع، أنشأها ADAM MAHMOUD ABDELALIM، تجعل النموذج النصي قادرًا على استخدام أدوات TaskFlow والمحركات دون اتصال مباشر بها.", language)}</p>
              <ol className="help-steps">
                <li>{translate("تجمع الطبقة طلب المستخدم وسياق مساحة العمل والمزوّد المتاح.", language)}</li>
                <li>{translate("تطلب استجابة منظمة: أوامر TaskFlow محددة، أو JSON للمخطط المعماري ومشروع OpenFilm، أو رسالة للمحرك.", language)}</li>
                <li>{translate("تتحقق من بنية النتيجة والحقول والمعرّفات والحدود؛ تُرفض الاستجابة غير الصالحة بدل تنفيذها كنص حر.", language)}</li>
                <li>{translate("ينفذ التطبيق الأوامر الموافق عليها، ويرسل هندسة المشهد إلى المحرك ويحفظ الحالة في قاعدة البيانات.", language)}</li>
              </ol>
              <p>{translate("هذه خوارزمية ربط وتطبيع وتنفيذ خاصة بالمشروع، وليست نموذجًا مدرّبًا جديدًا. النموذج لا يتحكم مباشرة بالمحرك.", language)}</p>
            </>}

            {active === "security" && <>
              <span className="help-kicker">PRIVACY & SECURITY</span>
              <h1>{translate("الأمان والخصوصية", language)}</h1>
              <div className="help-callout"><ShieldCheck size={20}/><div><strong>{translate("حافظ على مفاتيحك السرية", language)}</strong><p>{translate("لا ترسل API Keys في لقطات الشاشة أو المحادثات أو ملفات عامة.", language)}</p></div></div>
              <ul className="help-bullets">
                <li>{translate("بيانات الحسابات ومساحات العمل ومزوّدي AI تُحفظ في قاعدة البيانات المحلية؛ لكل مستخدم نطاق مستقل عند تفعيل تعدد المستخدمين.", language)}</li>
                <li>{translate("مفاتيح مزوّدي AI مشفّرة في قاعدة البيانات، ويجب الاحتفاظ بمفتاح التشفير في backend/.env.", language)}</li>
                <li>{translate("تُرسل الطلبات والمرفقات المختارة إلى المزوّد عند استخدام ميزة AI؛ راجع شروط المزوّد.", language)}</li>
                <li>{translate("الفويس أوفر يبقى محليًا، وتُرسل توقيتات المقاطع الهادئة فقط؛ قد تُرسل لقطات الفيديو المرجعي إلى المزوّد.", language)}</li>
                <li>{translate("الجهاز فقط هو الوضع الافتراضي. لا تعرض خدمات التطوير أو المحركات مباشرة على الإنترنت العام.", language)}</li>
              </ul>
            </>}

            {active === "troubleshooting" && <>
              <span className="help-kicker">TROUBLESHOOTING</span>
              <h1>{translate("حل المشكلات الشائعة", language)}</h1>
              <div className="help-faq">
                <strong>{translate("اختبار المزوّد يفشل", language)}</strong>
                <p>{translate("تحقق من صحة المفتاح، واسم النموذج، وBase URL، والاتصال بالإنترنت، وحدود الاستخدام لدى المزوّد.", language)}</p>
              </div>
              <div className="help-faq">
                <strong>{translate("Ollama لا يتصل", language)}</strong>
                <p>{translate("تأكد أن Ollama مثبت ويعمل، وأن النموذج تم تنزيله، وأن عنوان الخدمة صحيح ويمكن الوصول إليه من Backend.", language)}</p>
              </div>
              <div className="help-faq">
                <strong>{translate("بياناتي اختفت", language)}</strong>
                <p>{translate("تأكد أنك سجلت الدخول إلى الحساب نفسه، وأن backend يعمل وأن مجلد backend/data لم يُنقل أو يُحذف.", language)}</p>
              </div>
              <div className="help-faq">
                <strong>{translate("المعاينة لا تظهر", language)}</strong>
                <p>{translate("جرّب تحديث الصفحة، وتأكد من عدم وجود أخطاء في Console.", language)}</p>
              </div>
              <div className="help-faq">
                <strong>{translate("هل التطبيق يعمل دون AI؟", language)}</strong>
                <p>{translate("نعم، يمكنك استخدام المهام والمشاريع والمستندات دون إضافة أي مزوّد ذكاء اصطناعي.", language)}</p>
              </div>
            </>}
          </main>
        </div>

        <footer className="help-footer">
          <span><span className="status-dot"/> {translate("دليل AI TaskFlow", language)}</span>
          <span>{translate("نسخة تجريبية · قد تختلف بعض الميزات حسب إصدار التطبيق", language)}</span>
        </footer>
      </section>
    </div>
  );
}
