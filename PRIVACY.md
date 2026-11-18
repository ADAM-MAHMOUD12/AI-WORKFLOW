# AI TaskFlow Privacy Notice

## English

AI TaskFlow runs on the host device by default. Application records and generated editor projects are stored locally in the SQLite database and project folders. Provider API keys are encrypted at rest using the key in `backend/.env`; account passwords use salted PBKDF2 hashes, and session tokens are stored as hashes.

When an AI feature is used, the request and user-selected attachments may be sent to the configured AI provider. The provider's terms, privacy policy, retention, and charges apply. Motion Graphics extracts three still frames from a reference video in the browser and analyzes them locally with Florence-2. The full video is never uploaded. If the selected provider accepts images, the still frames may be sent; otherwise only the local text descriptions are sent. Voiceover audio remains in the local OpenFilm project. Local silence analysis sends only timing results, not the audio.

The Design Studio can download a pinned Florence-2 ONNX model on request. Reference images, library-image previews, and rendered SVG screenshots are analyzed by the local backend and are not sent as image files to the configured provider. Captions, OCR text, detected regions, and the W2M prompt may be sent to that provider to generate or repair the design. After the model is downloaded, vision inference works offline. The model download itself requires an internet connection.

Local-network access is disabled by default. If the host administrator enables it, devices on the trusted local network can access the application. Use a separate account per person and enable registration approval when appropriate. Do not expose the development services directly to the public internet.

The application does not send telemetry to its author. External requests are made only when needed for a chosen provider, web search, image search, or runtime/library installation.

## العربية

يعمل AI TaskFlow على الجهاز المضيف افتراضيًا. تُحفظ بيانات التطبيق ومشروعات المحررات محليًا في قاعدة SQLite ومجلدات المشروعات. تُشفّر مفاتيح مزوّدي AI باستخدام المفتاح في `backend/.env`، وتُخزّن كلمات المرور بتجزئة PBKDF2 مملّحة، كما تُحفظ تجزئات رموز الجلسات.

عند استخدام ميزة AI، قد يُرسل الطلب والمرفقات التي يختارها المستخدم إلى مزوّد الذكاء الاصطناعي المُعدّ. تسري شروط المزوّد وسياسة الخصوصية والاحتفاظ والرسوم الخاصة به. يستخرج استوديو الموشن جرافيك ثلاث لقطات ثابتة من الفيديو المرجعي في المتصفح ويحللها Florence-2 محليًا؛ لا يُرفع الفيديو الكامل. إذا كان المزوّد يقبل الصور فقد تُرسل إليه اللقطات، وإلا يُرسل إليه وصفها النصي المحلي فقط. يبقى الفويس أوفر داخل مشروع OpenFilm المحلي. يرسل تحليل الصمت المحلي التوقيتات فقط، وليس الملف الصوتي.

يمكن لاستوديو التصميم تنزيل نموذج Florence-2 ONNX مثبت الإصدار عند الطلب. يحلل الباكيند المحلي الصور المرجعية ومعاينات صور المكتبة ولقطات SVG، ولا يرسل ملفات الصور نفسها إلى المزوّد المُعدّ. لكن قد تُرسل أوصاف الصور ونصوص OCR والمناطق المكتشفة وطلب W2M إلى ذلك المزوّد لتوليد التصميم أو إصلاحه. يعمل التحليل دون اتصال بعد تنزيل النموذج؛ أما تنزيله فيحتاج إلى الإنترنت.

الوصول عبر الشبكة المحلية متوقف افتراضيًا. إذا فعّله مسؤول الجهاز، يمكن للأجهزة على الشبكة المحلية الموثوقة الوصول إلى التطبيق. استخدم حسابًا مستقلًا لكل شخص وفعّل موافقة التسجيل عند الحاجة. لا تعرض خدمات التطوير مباشرة على الإنترنت العام.

لا يرسل التطبيق بيانات استخدام إلى مطوّره. تُجرى اتصالات خارجية فقط عند الحاجة إلى مزوّد مختار أو بحث ويب أو بحث صور أو تثبيت أوقات التشغيل والمكتبات.

## Installer agreement

The bilingual installer presents the applicable language version of this notice and requires the user to accept it before proceeding. See `installer/privacy-en.txt` and `installer/privacy-ar.txt`.
