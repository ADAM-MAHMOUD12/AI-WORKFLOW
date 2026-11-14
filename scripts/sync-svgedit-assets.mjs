import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(projectRoot, "node_modules/svgedit");
const editorSource = resolve(packageRoot, "dist/editor");
const editorTarget = resolve(projectRoot, "public/vendor/svgedit");
const fileAccessSource = resolve(projectRoot, "node_modules/browser-fs-access");
const fileAccessTarget = resolve(editorTarget, "extensions/vendor/browser-fs-access");

if (!existsSync(editorSource)) {
  throw new Error("SVG-Edit assets are missing. Run npm install before starting the app.");
}

rmSync(editorTarget, { recursive: true, force: true });
mkdirSync(editorTarget, { recursive: true });
cpSync(editorSource, editorTarget, {
  recursive: true,
  force: true,
  filter: (sourcePath) => !/(^|[\\/])tests([\\/]|$)/.test(sourcePath),
});
copyFileSync(resolve(packageRoot, "LICENSE-MIT.txt"), resolve(editorTarget, "LICENSE-MIT.txt"));
copyFileSync(resolve(packageRoot, "licenseInfo.json"), resolve(editorTarget, "licenseInfo.json"));
mkdirSync(fileAccessTarget, { recursive: true });
copyFileSync(resolve(fileAccessSource, "dist/index.modern.js"), resolve(fileAccessTarget, "index.modern.js"));
copyFileSync(resolve(fileAccessSource, "LICENSE"), resolve(fileAccessTarget, "LICENSE"));

const editorHtmlPath = resolve(editorTarget, "index.html");
const editorHtml = readFileSync(editorHtmlPath, "utf8");
const editorHtmlBranded = editorHtml
  .replace("<title>SVG-edit</title>", "<title>AI-TENSORFLOW LOGO DESIGN TOOL</title>")
  .replace('<link href="./svgedit.css" rel="stylesheet" media="all">', '<link href="./svgedit.css" rel="stylesheet" media="all">\n  <link href="./taskflow-theme.css" rel="stylesheet" media="all">');
if (editorHtmlBranded === editorHtml) {
  throw new Error("SVG-Edit index template changed; review the brand/theme injection points.");
}
writeFileSync(editorHtmlPath, editorHtmlBranded);

const themeCss = `
.svg_editor { background: #12121d; color: #eeedf7; font-family: Tahoma, "Segoe UI", sans-serif; }
#tools_top, #tools_left, #tools_bottom, #sidepanels, #title_panel, #rulers, #ruler_corner, #main_button { background-color: #12121d; border-color: #252536; color: #eeedf7; }
#workarea { background-color: #0b0b12; border-color: #252536; }
#svgcanvas { background: #ffffff; }
#title_panel > p { color: #d7c5ff; }
#tools_left, #tools_top, #tools_bottom, #sidepanels { box-shadow: none; }
se-button { --icon-bg-color: #12121d; --icon-bg-color-hover: #252536; }
se-button[pressed] { --icon-bg-color: #33254c; }
se-menu { color: #eeedf7; }
se-menu-item:hover { background-color: #252536; }
input, select, textarea { accent-color: #8b5cf6; }
`;
writeFileSync(resolve(editorTarget, "taskflow-theme.css"), themeCss);

const editorBundlePath = resolve(editorTarget, "Editor.js");
const editorBundle = readFileSync(editorBundlePath, "utf8");
const upstreamMenuLabel = 'label=\\"SVG-Edit\\"';
if (!editorBundle.includes(upstreamMenuLabel)) {
  throw new Error("SVG-Edit main menu label changed; review the local branding patch.");
}
writeFileSync(editorBundlePath, editorBundle.replace(upstreamMenuLabel, 'label=\\"AI-TENSORFLOW LOGO DESIGN TOOL\\"'));

const openSavePath = resolve(editorTarget, "extensions/ext-opensave/ext-opensave.js");
const openSaveBundle = readFileSync(openSavePath, "utf8");
const upstreamPath = "../node_modules/browser-fs-access/dist/index.modern.js";
if (!openSaveBundle.includes(upstreamPath)) {
  throw new Error("SVG-Edit open/save import path changed; review the local asset sync before updating the patch.");
}
writeFileSync(openSavePath, openSaveBundle.replace(upstreamPath, "../vendor/browser-fs-access/index.modern.js"));