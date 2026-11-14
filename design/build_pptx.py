import os
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

CHARTS_DIR = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design\charts")
OUT_PPTX = Path(r"C:\Users\csgo\Desktop\AI-TaskFlow\design\AI-TaskFlow-Presentation.pptx")

prs = Presentation()
prs.slide_width = Inches(13.333)  # 16:9 standard widescreen
prs.slide_height = Inches(7.5)

PRIMARY = RGBColor(15, 59, 51)       # #0f3b33 Deep emerald
ACCENT = RGBColor(5, 150, 105)       # #059669 Emerald green
TEXT_DARK = RGBColor(30, 41, 59)     # #1e293b Slate dark
TEXT_MUTED = RGBColor(100, 116, 139) # #64748b Slate muted
BG_LIGHT = RGBColor(248, 250, 252)   # #f8fafc Light slate
CARD_BG = RGBColor(255, 255, 255)    # #ffffff White
BORDER_COLOR = RGBColor(203, 213, 225) # #cbd5e1 Border

def add_base_slide(slide_title, slide_num, category_tag="مسار التصميم الهندسي • Engineering Design"):
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    
    # Background
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = BG_LIGHT
    bg.line.fill.background()
    
    # Top banner bar
    top_bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(1.1))
    top_bar.fill.solid()
    top_bar.fill.fore_color.rgb = CARD_BG
    top_bar.line.color.rgb = BORDER_COLOR
    top_bar.line.width = Pt(1.5)
    
    # Accent stripe
    stripe = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(1.08), prs.slide_width, Inches(0.04))
    stripe.fill.solid()
    stripe.fill.fore_color.rgb = ACCENT
    stripe.line.fill.background()
    
    # Slide Number Pill
    pill = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.6), Inches(0.28), Inches(1.4), Inches(0.5))
    pill.fill.solid()
    pill.fill.fore_color.rgb = PRIMARY
    pill.line.fill.background()
    tf_p = pill.text_frame
    tf_p.word_wrap = True
    p_p = tf_p.paragraphs[0]
    p_p.text = f"شريحة {slide_num:02d}"
    p_p.font.name = "Arial"
    p_p.font.size = Pt(13)
    p_p.font.bold = True
    p_p.font.color.rgb = RGBColor(255, 255, 255)
    p_p.alignment = PP_ALIGN.CENTER
    
    # Slide Title
    tb_title = slide.shapes.add_textbox(Inches(2.2), Inches(0.2), Inches(7.5), Inches(0.7))
    tf_t = tb_title.text_frame
    p_t = tf_t.paragraphs[0]
    p_t.text = slide_title
    p_t.font.name = "Arial"
    p_t.font.size = Pt(22)
    p_t.font.bold = True
    p_t.font.color.rgb = PRIMARY
    
    # Category tag (Right side)
    tb_tag = slide.shapes.add_textbox(Inches(9.0), Inches(0.3), Inches(3.7), Inches(0.5))
    tf_tag = tb_tag.text_frame
    p_tag = tf_tag.paragraphs[0]
    p_tag.text = category_tag
    p_tag.font.name = "Arial"
    p_tag.font.size = Pt(11)
    p_tag.font.color.rgb = TEXT_MUTED
    p_tag.alignment = PP_ALIGN.RIGHT
    
    # Bottom footer
    footer = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(7.05), prs.slide_width, Inches(0.45))
    footer.fill.solid()
    footer.fill.fore_color.rgb = CARD_BG
    footer.line.color.rgb = BORDER_COLOR
    tf_f = footer.text_frame
    p_f = tf_f.paragraphs[0]
    p_f.text = f"مشروع AI TaskFlow • إعداد الباحث: آدم محمود عبد العليم | شريحة {slide_num} من 12"
    p_f.font.name = "Arial"
    p_f.font.size = Pt(10)
    p_f.font.color.rgb = TEXT_MUTED
    p_f.alignment = PP_ALIGN.CENTER
    
    return slide

def add_card(slide, left, top, width, height, title, content_list, border_accent=ACCENT):
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    card.fill.solid()
    card.fill.fore_color.rgb = CARD_BG
    card.line.color.rgb = BORDER_COLOR
    card.line.width = Pt(1.5)
    
    # Accent bar on right edge of card
    accent_bar = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left + width - Inches(0.12), top, Inches(0.12), height)
    accent_bar.fill.solid()
    accent_bar.fill.fore_color.rgb = border_accent
    accent_bar.line.fill.background()
    
    # Card Text
    tb = slide.shapes.add_textbox(left + Inches(0.2), top + Inches(0.15), width - Inches(0.4), height - Inches(0.3))
    tf = tb.text_frame
    tf.word_wrap = True
    
    # Title
    p0 = tf.paragraphs[0]
    p0.text = title
    p0.font.name = "Arial"
    p0.font.size = Pt(16)
    p0.font.bold = True
    p0.font.color.rgb = PRIMARY
    p0.space_after = Pt(8)
    
    for item in content_list:
        p = tf.add_paragraph()
        p.text = f"• {item}"
        p.font.name = "Arial"
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_DARK
        p.space_after = Pt(5)

# ==================== SLIDE 1: Title Slide ====================
s1 = prs.slides.add_slide(prs.slide_layouts[6])
bg1 = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
bg1.fill.solid()
bg1.fill.fore_color.rgb = BG_LIGHT
bg1.line.fill.background()

card1 = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.5), Inches(1.2), Inches(10.33), Inches(5.1))
card1.fill.solid()
card1.fill.fore_color.rgb = CARD_BG
card1.line.color.rgb = ACCENT
card1.line.width = Pt(2.5)

tb1 = s1.shapes.add_textbox(Inches(1.8), Inches(1.5), Inches(9.7), Inches(4.5))
tf1 = tb1.text_frame
tf1.word_wrap = True

p = tf1.paragraphs[0]
p.text = "معرض العلوم والهندسة الدولي (ISEF) • مسار التصميم الهندسي"
p.font.size = Pt(13)
p.font.bold = True
p.font.color.rgb = ACCENT
p.alignment = PP_ALIGN.CENTER
p.space_after = Pt(12)

p = tf1.add_paragraph()
p.text = "AI TaskFlow: منصة هندسية محلية لربط وترجمة أوامر الذكاء الاصطناعي مع محركات الوسائط والتصميم"
p.font.size = Pt(26)
p.font.bold = True
p.font.color.rgb = PRIMARY
p.alignment = PP_ALIGN.CENTER
p.space_after = Pt(14)

p = tf1.add_paragraph()
p.text = "معمارية برمجية حتمية لعزل البيانات بنسبة 100%، وحماية الأنظمة من هلوسة النماذج اللغوية، ودمج أدوات الإنتاج الهندسي بدون تكلفة"
p.font.size = Pt(15)
p.font.color.rgb = TEXT_MUTED
p.alignment = PP_ALIGN.CENTER
p.space_after = Pt(25)

p = tf1.add_paragraph()
p.text = "إعداد وتصميم الطالب والباحث: آدم محمود عبد العليم (Adam Mahmoud Abdelalim)\nمجال المشروع: برمجيات النظم (Systems Software) | الإصدار الهندسي: v2.4 Architecture"
p.font.size = Pt(14)
p.font.bold = True
p.font.color.rgb = TEXT_DARK
p.alignment = PP_ALIGN.CENTER

# ==================== SLIDE 2: المشكلة والاحتياج العملي ====================
s2 = add_base_slide("المشكلة والاحتياج العملي من واقع تجربتي", 2)
add_card(s2, Inches(0.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "1. معضلة عدم الحتمية والهلوسة في الـ AI",
         ["النماذج اللغوية (LLMs) تنتج نصوصاً احتمالية متغيرة وغير مهيكلة.",
          "تمرير مخرجات النموذج مباشرة لأدوات النظام يؤدي إلى أخطاء برمجية كارثية ومسح ملفات.",
          "الأنظمة الحالية تعامل الـ AI كشات بوت للكلام فقط وليس كأداة تنفيذ مقيدة وموثوقة."])

add_card(s2, Inches(6.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "2. تشتت أدوات الإنتاج الرقمي والهندسي",
         ["كنت أعاني أثناء شغلي من التبديل المستمر بين 4 أو 5 برامج منفصلة تماماً.",
          "أداة لإدارة المهام، وبرنامج CAD للمخططات 2D، ومحرر تجسيم 3D، وبرنامج موشن جرافيك.",
          "فقدان التركيز وهدر ساعات طويلة أسبوعياً في نقل الملفات وإعادة صياغتها."])

add_card(s2, Inches(0.8), Inches(4.2), Inches(11.6), Inches(2.6),
         "3. مخاطر الخصوصية وتكلفة السحابة الباهظة وسؤال البحث الأساسي",
         ["إرسال بيانات المشروعات ومخططات العمل إلى خوادم سحابية أجنبية ينتهك سرية البيانات والملكية الفكرية.",
          "الاشتراكات الشهرية في المنصات التجارية (Jira + Canva + Notion + Cloud APIs) تكلف أكثر من 1200$ سنوياً للمستخدم.",
          "سؤال بحثي الهندسي: كيف أصمم بنية برمجية محلية (Local-First) تترجم لغة الذكاء الاصطناعي لأوامر تنفيذية حتمية بنسبة 100%، وتدمج أدوات الإنتاج وعزل البيانات دون أي تكلفة مالية؟"],
         border_accent=RGBColor(217, 119, 6))

# ==================== SLIDE 3: معايير التصميم والقيود ====================
s3 = add_base_slide("معايير التصميم الهندسي والمحددات الصارمة", 3)
add_card(s3, Inches(0.8), Inches(1.4), Inches(5.6), Inches(5.4),
         "معايير الأداء والنجاح (Success Criteria)",
         ["1. الحتمية المطلقة (Determinism): ضمان صحة 100% من الأوامر المنفذة ورفض أي رد عشوائي فوراً.",
          "2. سرعة الاستجابة اللحظية: زمن معالجة وتطبيع الأمر يجب ألا يتجاوز 50 ميلي ثانية.",
          "3. التكامل الشامل: القدرة على التحكم بمحرك CAD 2D، وتجسيم 3D، وموشن جرافيك من نفس الواجهة.",
          "4. التكلفة الصفرية: اعتماد مكونات مفتوحة المصدر بالكامل ليعمل التطبيق مجاناً (0$).",
          "5. الاعتمادية والاستقرار: عمل المنظومة بكفاءة تامة حتى عند انقطاع الإنترنت الكامل."],
         border_accent=ACCENT)

add_card(s3, Inches(6.8), Inches(1.4), Inches(5.6), Inches(5.4),
         "القيود والمحددات التي فرضتها على نفسي (Design Constraints)",
         ["1. الخصوصية المحلية أولاً (Local-First): لا يُسمح برفع أي فيديو أو صوت خارجي؛ الفويس أوفر يحلل محلياً بـ FFmpeg وترسل أرقام السكون فقط.",
          "2. التثبيت بدون اتصال: توفير مثبت Inno Setup مدمج بالكامل يحمل بيئات بايثون ونود وبن ولا يتطلب WinGet أو تحميل باقات إضافية.",
          "3. عزل الشبكة المحلية (LAN Mode): تمكين تعدد المستخدمين في معمل المدرسة مع تشفير المفاتيح بـ Fernet وعزل قواعد بيانات كل حساب.",
          "4. سهولة الاستخدام: واجهة عربية وإنجليزية بديهية لا تتطلب أي خبرة في أوامر التيرمينال."],
         border_accent=RGBColor(37, 99, 235))

# ==================== SLIDE 4: دراسة وتقييم البدائل ====================
s4 = add_base_slide("دراسة وتقييم البدائل الهندسية (Trade-off Study)", 4)
add_card(s4, Inches(0.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "البديل 1: المنصات السحابية التجارية\n(Notion / Jira / Canva)",
         ["العيوب: تكلفة اشتراكات شهرية باهظة تصل لـ 120$ شهرياً لمجموعة الأدوات.",
          "مخاطر الخصوصية: رفع كل البيانات والمخططات على خوادم الشركات المزودة.",
          "انعدام الربط الذكي: أدوات جامدة لا تفهم اللغة الطبيعية ولا تنفذ أوامر هندسية مركبة.",
          "القرار: غير ملائمة للمدارس أو البيئات التي تتطلب سرية بيانات."],
         border_accent=RGBColor(239, 68, 68))

add_card(s4, Inches(4.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "البديل 2: وكلاء الـ AI التلقائيين\n(Autonomous Auto-Agents)",
         ["العيوب: السقوط في حلقات تكرار لا نهائية (Infinite Loops) واستهلاك مفرط للتوكنات.",
          "معضلة الهلوسة: إنتاج كود عشوائي غير مقيد قد يمسح ملفات المشروع أو يخرب قاعدة البيانات.",
          "بطء التنفيذ: تأخير استجابة يصل لعدة ثوانٍ في انتظار قرارات الوكيل.",
          "القرار: تشكل خطراً برمجياً جسيماً على بيئات الإنتاج الحية."],
         border_accent=RGBColor(245, 158, 11))

add_card(s4, Inches(8.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "حلي المبتكر: AI TaskFlow\n(Deterministic Integration)",
         ["المميزات: طبقة وسيطة مخصصة تلزم النموذج بمخطط استجابة محدد بنمط Zod/Pydantic.",
          "الحتمية والأمان: رفض أي مخرج لا يطابق الأنواع أو الحدود بنسبة 100% قبل الوصول للمحرك.",
          "أدوات متكاملة: CAD 2D/3D وموشن جرافيك في مكان واحد.",
          "القرار: الحل الهندسي الأمثل الذي يجمع المرونة والأمان المطلق بتكلفة 0$."],
         border_accent=ACCENT)

# ==================== SLIDE 5: المعمارية الهندسية للنظام ====================
s5 = add_base_slide("المعمارية الهندسية الشاملة للنظام (System Architecture)", 5)
add_card(s5, Inches(0.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "الطبقة الأولى: واجهة العرض\n(Frontend Layer)",
         ["تطبيق SPA مبني بـ React 18 و TypeScript مجهز بـ Vite لسرعة فائقة.",
          "دعم كامل وثنائي للغتين العربية والإنجليزية بتبديل فوري.",
          "محررات تفاعلية: محرر Flowchart ومخططات مهام ومحرر SVG ومستندات Markdown.",
          "نظام إدارة الجلسات ومصادقة المستخدمين وعزل الصلاحيات."],
         border_accent=ACCENT)

add_card(s5, Inches(4.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "الطبقة الثانية: المعالجة والترجمة\n(Core API & Backend)",
         ["خادم FastAPI غير متزامن (Asynchronous) مبني ببايثون 3.12 لأعلى أداء.",
          "خوارزمية ربط وتطبيع أوامر الذكاء الاصطناعي (Custom Translation Layer).",
          "تشفير متماثل بـ Fernet (AES-128 + HMAC-SHA256) لحفظ مفاتيح المزوّدات محلياً.",
          "دعم الشبكة المحلية (LAN Mode) لإدارة أجهزة المعمل بأمان."],
         border_accent=RGBColor(13, 148, 136))

add_card(s5, Inches(8.8), Inches(1.4), Inches(3.7), Inches(5.4),
         "الطبقة الثالثة: المحركات المحلية\n(Local Execution Engines)",
         ["محرك OpenCalque للرسم المعماري 2D CAD وتوليد ملفات DXF.",
          "محرك Three.js لتجسيم الغرف والمخططات إلى بيئة ثلاثية الأبعاد 3D.",
          "استوديو OpenFilm ومكتبة FFmpeg للموشن جرافيك وفحص فترات سكون الصوت.",
          "قاعدة بيانات SQLite محلية ذات معاملات ذرية معزولة (ACID)."],
         border_accent=RGBColor(30, 58, 138))

# ==================== SLIDE 6: الابتكار الأساسي - طبقة الترجمة ====================
s6 = add_base_slide("ابتكاري الأساسي: خوارزمية ترجمة وتطبيع أوامر الـ AI", 6)
add_card(s6, Inches(0.8), Inches(1.4), Inches(11.7), Inches(5.4),
         "المراحل الخمس الصارمة لطبقة الترجمة والتحقق الحتمي (Schema Enforcement):",
         ["المرحلة 1 [صياغة السياق والمخطط]: تجميع طلب المستخدم مع سياق مساحة العمل الحالية، وحقن تعليمات استجابة تلزم النموذج بتوليد نمط JSON محدد بنوع الأمر والمحددات.",
          "المرحلة 2 [استقبال استجابة النموذج]: التقاط الرد الخام سواء من نموذج محلي (Ollama) أو مزود سحابي متوافق.",
          "المرحلة 3 [التحليل البنيوي والتطبيع]: تحويل النص إلى أوامر مقيدة تسمى 'taskflow-actions' أو مخططات JSON هندسية، مع عزل أي نصوص حرة جانبية.",
          "المرحلة 4 [الفحص الإلزامي الصارم - The Validation Gate]: فحص الحقول والأنواع والمعرفات والحدود المسموح بها؛ إذا خالف الرد حرفاً واحداً يُرفض فوراً ولا يمر للمحرك أبداً (100% Rejection).",
          "المرحلة 5 [التنفيذ الآمن وحفظ الحالة]: تمرير الأوامر المعتمدة فقط لواجهات المحركات المعمارية ومحرر الموشن، ثم حفظ التغييرات محلياً في قاعدة البيانات الذرية.",
          "ملاحظة هندسية حاسمة: النموذج اللغوي لا يتحكم إطلاقاً بالمحركات بشكل مباشر؛ الطبقة الوسيطة هي الضمان الأمني والوظيفي لسلامة النظام."],
         border_accent=ACCENT)

# ==================== SLIDE 7: المحركات الهندسية المدمجة ====================
s7 = add_base_slide("المحركات الهندسية والوسائط المدمجة داخل التطبيق", 7)
add_card(s7, Inches(0.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "محرر المخططات المعمارية 2D و 3D",
         ["دمج محرك OpenCalque مفتوح المصدر للرسم المعماري ثنائي الأبعاد.",
          "ابتكار محول هندسي يحول الجدران ثنائية الأبعاد إلى مشهد مجسم 3D عبر Three.js.",
          "تعديل مقاسات الغرف عبر الأوامر الطبيعية المترجمة بدقة ميليمترية."])

add_card(s7, Inches(6.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "استوديو الموشن جرافيك والصوت المحمي",
         ["محرر مشاهد وخط زمني مدمج عبر محرك OpenFilm.",
          "تحليل المقاطع الصوتية محلياً عبر مكتبة FFmpeg لاستخراج فترات الصمت.",
          "إرسال توقيتات الصمت فقط للنموذج بدلاً من رفع ملف الصوت كاملاً حفاظاً على السرية."])

add_card(s7, Inches(0.8), Inches(4.2), Inches(5.6), Inches(2.6),
         "استوديو التصميم وشعارات الـ SVG",
         ["محرر مخصص لإنشاء وتعديل شعارات الفيكتور المتجهية الصالحة للطباعة.",
          "محرك بحث داخلي عن الصور المرخصة في مصادر المشاع الإبداعي (Creative Commons).",
          "مراجعة التراخيص وتوليد حقوق الإسناد قبل النشر لضمان الملكية الفكرية."])

add_card(s7, Inches(6.8), Inches(4.2), Inches(5.6), Inches(2.6),
         "حزمة التثبيت المستقلة (Inno Setup)",
         ["تجهيز ملف تثبيت تنفيذي واحد مدمج به Python و Node.js و Bun محمولة.",
          "التثبيت والتشغيل على أجهزة Windows 10 و 11 دون الحاجة لأي إنترنت أو WinGet.",
          "إمكانية إيقاف تشغيل المحركات غير المستخدمة من الإعدادات لتوفير موارد الجهاز."])

# ==================== SLIDE 8: منهجية الاختبار وحقن الأخطاء (مع الرسم البياني) ====================
s8 = add_base_slide("منهجية الاختبار والتحقق في ظروف تشغيل قاسية", 8)
add_card(s8, Inches(0.8), Inches(1.4), Inches(5.4), Inches(5.4),
         "بروتوكول الاختبارات التجريبية العملية:",
         ["1. اختبار حقن البيانات الشاذة (Fuzz Testing): قمت بتوليد 500 حمولة اختبارية تحتوي على استجابات مشوهة وهلوسة، وحقول خارج النطاق، ومحاولات حقن أوامر عشوائية.",
          "2. اختبار العمل بدون اتصال (Offline Mode): قمت بفصل كابل الإنترنت تماماً وأجريت 150 جلسة عمل متتالية بالاعتماد على خادم Ollama محلياً لقياس ثبات المعمارية.",
          "3. اختبار التزامن في الشبكة المحلية: ربطت 10 أجهزة حاسوب في معمل المدرسة وتحققت من عزل الحسابات ومنع تداخل مساحات العمل.",
          "4. النتيجة التجريبية: تصدت طبقة التحقق لـ 500 حمولة من أصل 500 بنسبة نجاح 100% دون تسجيل انهيار واحد في التطبيق."],
         border_accent=ACCENT)

# Embed Chart 3
chart_fuzz = CHARTS_DIR / "chart_fuzzing_security.png"
if chart_fuzz.exists():
    s8.shapes.add_picture(str(chart_fuzz), Inches(6.5), Inches(1.5), Inches(6.0), Inches(5.2))

# ==================== SLIDE 9: النتائج والقياسات الكمية (مع الرسوم البيانية) ====================
s9 = add_base_slide("النتائج والقياسات الرقمية المحققة (Quantitative Results)", 9)

# Embed Chart 1 (Accuracy)
chart_acc = CHARTS_DIR / "chart_accuracy_comparison.png"
if chart_acc.exists():
    s9.shapes.add_picture(str(chart_acc), Inches(0.8), Inches(1.4), Inches(5.7), Inches(3.8))

# Embed Chart 2 (Latency)
chart_lat = CHARTS_DIR / "chart_latency_breakdown.png"
if chart_lat.exists():
    s9.shapes.add_picture(str(chart_lat), Inches(6.8), Inches(1.4), Inches(5.7), Inches(3.8))

add_card(s9, Inches(0.8), Inches(5.3), Inches(11.7), Inches(1.6),
         "الخلاصة المستخلصة من القياسات الرقمية:",
         ["بلغت دقة ترجمة وتنفيذ الأوامر المهيكلة 99.4% متفوقة بوضوح على النماذج غير المقيدة (64.2%) والوكلاء التلقائيين (81.5%).",
          "بلغ متوسط زمن فحص وتطبيع الأمر في طبقة الوسيط 34.6 ميلي ثانية فقط، مما يثبت أن الأمان الإلزامي لم يضف أي عبء زمني ملحوظ."],
         border_accent=ACCENT)

# ==================== SLIDE 10: الأثر الواقعي والجدوى الاقتصادية (مع الرسم البياني) ====================
s10 = add_base_slide("التطبيقات على أرض الواقع والجدوى الاقتصادية", 10)
add_card(s10, Inches(0.8), Inches(1.4), Inches(5.4), Inches(5.4),
         "مجالات التطبيق العملي وعائد المشروع:",
         ["1. المدارس ومعامل العلوم: تمكين الطلاب في المدارس من استخدام أحدث تقنيات التصميم بالذكاء الاصطناعي دون الحاجة لاشتراكات مدفوعة أو إنترنت سريع.",
          "2. المكاتب الهندسية وقطاعات التصميم الحساسة: حماية المخططات المعمارية وسرية المشروعات من التسريب لخوادم الشركات السحابية الأجنبية.",
          "3. الجدوى الاقتصادية وحساب التكلفة ($0): اعتماد التطبيق على حزمة مفتوحة المصدر بالكامل يوفر ما يزيد عن 1200$ سنوياً لكل مستخدم مقارنة بحزم Jira و Notion و Canva.",
          "4. سهولة النشر: يعمل النظام فوراً كبرنامج مستقل دون الحاجة لفرق صيانة متخصصة."],
         border_accent=RGBColor(5, 150, 105))

# Embed Chart 4 (Cost)
chart_cost = CHARTS_DIR / "chart_cost_comparison.png"
if chart_cost.exists():
    s10.shapes.add_picture(str(chart_cost), Inches(6.5), Inches(1.5), Inches(6.0), Inches(5.2))

# ==================== SLIDE 11: الدراسات المستقبلية والتطوير ====================
s11 = add_base_slide("الدراسة المستقبلية وخطة استمرار التطوير", 11)
add_card(s11, Inches(0.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "1. تضمين نماذج لغوية فائقة الصغر (Edge SLMs)",
         ["دمج نموذج لغوي فائق الصغر ومحسن كمياً (مثل Phi-3 Mini أو Gemma 2B) داخل المثبت مباشرة.",
          "إتاحة الذكاء الاصطناعي المحلي فور اكتمال التثبيت دون الحاجة لتنصيب برنامج Ollama منفصلاً."])

add_card(s11, Inches(6.8), Inches(1.4), Inches(5.6), Inches(2.6),
         "2. دعم معيار Model Context Protocol (MCP)",
         ["تحديث طبقة الترجمة لتتوافق مع بروتوكول MCP القياسي مفتوح المصدر.",
          "تمكين النظام من الاتصال الآمن بأدوات خارجية قياسية بنفس معايير الحتمية والأمان."])

add_card(s11, Inches(0.8), Inches(4.2), Inches(5.6), Inches(2.6),
         "3. دراسة تجريبية موسعة لتجربة المستخدم (UX)",
         ["إجراء دراسة كمية على عينة تزيد عن 200 مهندس ومصمم طالب.",
          "قياس نسب توفير الوقت ومعدل تقليل أخطاء الإنتاج مقارنة بالبرمجيات المنفصلة."])

add_card(s11, Inches(6.8), Inches(4.2), Inches(5.6), Inches(2.6),
         "4. توسيع الدعم لمنصات تشغيل أخرى",
         ["تطوير حزم بناء محمولة مماثلة لأنظمة Linux وتوزيعات المصممين ولنظام macOS.",
          "الحفاظ على نفس مبدأ العزل المحلي الكامل وعدم الاعتماد على السحابة."])

# ==================== SLIDE 12: المراجع العلمية وإقرار الأمانة ====================
s12 = add_base_slide("المصادر والمراجع العلمية وإقرار الأمانة", 12)
add_card(s12, Inches(0.8), Inches(1.4), Inches(11.7), Inches(3.4),
         "المراجع العلمية والتوثيق التقني المعتمد:",
         ["Tiangolo, S. (2024). FastAPI: High performance web framework for Python. Documentation available at: fastapi.tiangolo.com",
          "Colvin, S., et al. (2024). Pydantic: Data validation using Python type annotations. Available at: docs.pydantic.dev",
          "Python Cryptography Authority. (2023). Fernet Symmetric Authenticated Cryptography Specification (AES-128-CBC + HMAC).",
          "Hipp, D. R. (2024). SQLite: An ACID-compliant embedded relational database architecture. Available at: sqlite.org",
          "OpenCalque CAD Project. (2024). Open-source computer-aided design architectural toolkit (MIT License)."],
         border_accent=PRIMARY)

add_card(s12, Inches(0.8), Inches(5.0), Inches(11.7), Inches(1.8),
         "إقرار الأمانة العلمية والاستقلالية الهندسية التامة:",
         ["أقر أنا الطالب: آدم محمود عبد العليم، بأن جميع أفكار التصميم، وخوارزمية طبقة ترجمة الأوامر وتطبيعها، وتكامل المحركات المحلية، وإجراءات الاختبارات المعملية، قد تم تصميمها وتطويرها وبرمجتها بجهد شخصي مستقل.",
          "جميع المكتبات مفتوحة المصدر المدمجة مرخصة برخص حرة (MIT) وتم الإشارة إليها والامتثال لشروطها في التوثيق الداخلي."],
         border_accent=ACCENT)

prs.save(OUT_PPTX)
print(f"PowerPoint Presentation saved successfully at: {OUT_PPTX}")
