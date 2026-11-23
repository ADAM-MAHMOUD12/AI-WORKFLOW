import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../node_modules/openfilm/", import.meta.url);

async function replaceOnce(path, before, after) {
  const file = new URL(path, root);
  const source = await readFile(file, "utf8");
  if (source.includes(after)) return;
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one OpenFilm patch target in ${path}; found ${occurrences}.`);
  }
  await writeFile(file, source.replace(before, after), "utf8");
}

await replaceOnce(
  "studio/server/server.mjs",
  "editor.listen(port, '127.0.0.1',",
  "editor.listen(port, process.env.OPENFILM_HOST || '127.0.0.1',",
);
await replaceOnce(
  "studio/server/server.mjs",
  "origin = `http://127.0.0.1:${address.port}`;",
  "origin = `http://${process.env.OPENFILM_ADVERTISED_HOST || '127.0.0.1'}:${address.port}`;",
);
await replaceOnce(
  "studio/server/pages.mjs",
  "const names = ['127.0.0.1', 'localhost', '[::1]'];",
  "const advertised = process.env.OPENFILM_ADVERTISED_HOST?.toLowerCase();\n  const names = ['127.0.0.1', 'localhost', '[::1]', ...(advertised ? [advertised] : [])];",
);
await replaceOnce(
  "studio/server/pages.mjs",
  "server.listen(port, '127.0.0.1',",
  "server.listen(port, process.env.OPENFILM_HOST || '127.0.0.1',",
);
await replaceOnce(
  "studio/server/pages.mjs",
  "const origin = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;",
  "const origin = `http://${process.env.OPENFILM_ADVERTISED_HOST || 'localhost'}:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;",
);

const productFile = new URL("product.json", root);
const product = JSON.parse(await readFile(productFile, "utf8"));
if (Object.hasOwn(product, "desktop")) {
  delete product.desktop;
  await writeFile(productFile, `${JSON.stringify(product, null, 2)}\n`, "utf8");
}

const htmlFile = new URL("studio/ui/dist/index.html", root);
let html = await readFile(htmlFile, "utf8");
html = html.replace("<title>OpenFilm Studio</title>", "<title>OPENFILM-AI TASKFLOW EDITION</title>");
html = html.replace('aria-label%3D%22OpenFilm%22', 'aria-label%3D%22OPENFILM-AI%20TASKFLOW%20EDITION%22');
html = html.replace("%3Ctitle%3EOpenFilm%3C%2Ftitle%3E", "%3Ctitle%3EOPENFILM-AI%20TASKFLOW%20EDITION%3C%2Ftitle%3E");
await writeFile(htmlFile, html, "utf8");
