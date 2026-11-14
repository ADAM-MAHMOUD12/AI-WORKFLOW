# AI TaskFlow Privacy Notice

## English

AI TaskFlow runs on the host device by default. Application records and generated editor projects are stored locally in the SQLite database and project folders. Provider API keys are encrypted at rest using the key in `backend/.env`; account passwords use salted PBKDF2 hashes, and session tokens are stored as hashes.

When an AI feature is used, the request and user-selected attachments may be sent to the configured AI provider. The provider's terms, privacy policy, retention, and charges apply. Motion Graphics samples a reference video into still frames in the browser; those frames may be sent to the selected provider. Voiceover audio remains in the local OpenFilm project. Local silence analysis sends only timing results, not the audio.

Local-network access is disabled by default. If the host administrator enables it, devices on the trusted local network can access the application. Use a separate account per person and enable registration approval when appropriate. Do not expose the development services directly to the public internet.

The application does not send telemetry to its author. External requests are made only when needed for a chosen provider, web search, image search, or runtime/library installation.

## العربية

يعمل AI TaskFlow على الجهاز المضيف افتراضيًا. تُحفظ بيانات التطبيق ومشروعات المحررات محليًا في قاعدة SQLite ومجلدات المشروعات. تُشفّر مفاتيح مزوّدي AI باستخدام المفتاح في `backend/.env`، وتُخزّن كلمات المرور بتجزئة PBKDF2 مملّحة، كما تُحفظ تجزئات رموز الجلسات.

عند استخدام ميزة AI، قد يُرسل الطلب والمرفقات التي يختارها المستخدم إلى مزوّد الذكاء الاصطناعي المُعدّ. تسري شروط المزوّد وسياسة الخصوصية والاحتفاظ والرسوم الخاصة به. يحوّل استوديو الموشن جرافيك الفيديو المرجعي إلى لقطات ثابتة في المتصفح، وقد تُرسل اللقطات إلى المزوّد المختار. يبقى الفويس أوفر داخل مشروع OpenFilm المحلي. يرسل تحليل الصمت المحلي التوقيتات فقط، وليس الملف الصوتي.

الوصول عبر الشبكة المحلية متوقف افتراضيًا. إذا فعّله مسؤول الجهاز، يمكن للأجهزة على الشبكة المحلية الموثوقة الوصول إلى التطبيق. استخدم حسابًا مستقلًا لكل شخص وفعّل موافقة التسجيل عند الحاجة. لا تعرض خدمات التطوير مباشرة على الإنترنت العام.

لا يرسل التطبيق بيانات استخدام إلى مطوّره. تُجرى اتصالات خارجية فقط عند الحاجة إلى مزوّد مختار أو بحث ويب أو بحث صور أو تثبيت أوقات التشغيل والمكتبات.

## Installer agreement

The bilingual installer presents the applicable language version of this notice and requires the user to accept it before proceeding. See `installer/privacy-en.txt` and `installer/privacy-ar.txt`.
