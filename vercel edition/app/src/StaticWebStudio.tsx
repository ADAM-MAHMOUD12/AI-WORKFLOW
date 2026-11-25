import { useEffect, useState } from "react";
import { Code2, Copy, Download, ExternalLink, Monitor, RefreshCw } from "lucide-react";
import "./StaticWebStudio.css";

const START_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TaskFlow Static Site</title>
</head>
<body>
  <main>
    <h1>مرحبًا في موقعك الجديد</h1>
    <p>عدّل HTML وCSS وJavaScript وشاهد النتيجة مباشرة.</p>
  </main>
</body>
</html>`;

const START_CSS = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Tahoma,Arial;background:linear-gradient(135deg,#0e1726,#26364f);color:#eff6ff}
main{max-width:760px;margin:auto;padding:15vh 24px}h1{font-size:48px;margin:0 0 12px}p{font-size:20px;color:#b9cbe2}`;

const START_JS = `document.querySelector('h1')?.addEventListener('click',()=>{alert('شغّال!')});`;

export default function StaticWebStudio() {
  const [html, setHtml] = useState(() => localStorage.getItem("taskflow-static-html") ?? START_HTML);
  const [css, setCss] = useState(() => localStorage.getItem("taskflow-static-css") ?? START_CSS);
  const [js, setJs] = useState(() => localStorage.getItem("taskflow-static-js") ?? START_JS);
  const [tab, setTab] = useState<"html" | "css" | "js">("html");
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem("taskflow-static-html", html);
    localStorage.setItem("taskflow-static-css", css);
    localStorage.setItem("taskflow-static-js", js);
  }, [html, css, js]);

  const buildSrcDoc = () => {
    const safeJs = js.replace(/<\/script/gi, "<\\/script");
    return html.includes("</head>")
      ? html.replace("</head>", `<style>${css}</style></head>`).replace("</body>", `<script>${safeJs}</script></body>`)
      : `<!doctype html><html><head><style>${css}</style></head><body>${html}<script>${safeJs}</script></body></html>`;
  };
  const srcDoc = buildSrcDoc();

  const download = () => {
    const blob = new Blob([srcDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "taskflow-static-site.html";
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(srcDoc);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const activeCode = tab === "html" ? html : tab === "css" ? css : js;
  const setActiveCode = tab === "html" ? setHtml : tab === "css" ? setCss : setJs;

  return (
    <section className="static-studio">
      <header className="static-studio-header">
        <div><Code2 size={22} /><span><strong>محرر الويب الثابت</strong><small>HTML · CSS · JavaScript</small></span></div>
        <div className="static-actions">
          <button type="button" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15}/> تحديث المعاينة</button>
          <button type="button" onClick={copy}><Copy size={15}/>{copied ? "تم النسخ" : "نسخ الكود"}</button>
          <button type="button" onClick={download}><Download size={15}/> تنزيل HTML</button>
        </div>
      </header>
      <div className="static-studio-grid">
        <div className="static-code-panel">
          <nav>
            <button type="button" className={tab === "html" ? "active" : ""} onClick={() => setTab("html")}>HTML</button>
            <button type="button" className={tab === "css" ? "active" : ""} onClick={() => setTab("css")}>CSS</button>
            <button type="button" className={tab === "js" ? "active" : ""} onClick={() => setTab("js")}>JavaScript</button>
          </nav>
          <textarea value={activeCode} onChange={(event) => setActiveCode(event.target.value)} spellCheck={false} />
        </div>
        <div className="static-preview-panel">
          <header><span><Monitor size={15}/> معاينة مباشرة</span><button type="button" onClick={() => setRevision((value) => value + 1)}><ExternalLink size={14}/></button></header>
          <iframe key={revision} title="معاينة الويب الثابت" srcDoc={srcDoc} sandbox="allow-scripts allow-modals" />
        </div>
      </div>
    </section>
  );
}
