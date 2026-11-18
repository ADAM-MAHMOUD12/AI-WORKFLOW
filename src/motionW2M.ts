export type ProjectScene = { file: string; duration: number; html: string };
export type OpenFilmProject = {
  title: string;
  width: number;
  height: number;
  duration: number;
  film_html: string;
  scenes: ProjectScene[];
};

export type W2MDiagnostic = {
  code: string;
  line: number;
  column: number;
  message: string;
};

export class W2MCompileError extends Error {
  readonly diagnostics: W2MDiagnostic[];

  constructor(diagnostics: W2MDiagnostic[]) {
    super(diagnostics.map(({ code, line, column, message }) =>
      `${code} (سطر ${line}، عمود ${column}): ${message}`).join("\n"));
    this.name = "W2MCompileError";
    this.diagnostics = diagnostics;
  }
}

const MAX_PROJECT_SOURCE_SIZE = 900_000;
const MAX_SCENES = 16;
const DURATION_TOLERANCE = 0.1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(code: string, line: number, message: string, column = 1): W2MCompileError {
  return new W2MCompileError([{ code, line, column, message }]);
}

export function validateOpenFilmProject(value: unknown): OpenFilmProject {
  if (!isRecord(value) || typeof value.title !== "string" ||
    typeof value.width !== "number" || !Number.isInteger(value.width) || value.width < 1 || value.width > 7680 ||
    typeof value.height !== "number" || !Number.isInteger(value.height) || value.height < 1 || value.height > 4320 ||
    typeof value.duration !== "number" || !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    typeof value.film_html !== "string" || !Array.isArray(value.scenes) ||
    value.scenes.length === 0 || value.scenes.length > MAX_SCENES) {
    throw new Error("رد W2M لم يتحول إلى حزمة OpenFilm كاملة.");
  }
  const scenes = value.scenes.map((scene, index): ProjectScene => {
    if (!isRecord(scene) || typeof scene.file !== "string" ||
      !/^scene-\d{2}\.html$/.test(scene.file) ||
      typeof scene.duration !== "number" || !Number.isFinite(scene.duration) || scene.duration <= 0 ||
      typeof scene.html !== "string" || !/<html\b/i.test(scene.html) ||
      !/window\.film\s*=/.test(scene.html) || !/window\.film\s*=\s*\{[\s\S]*?\bframe\s*\(\s*t\s*\)/.test(scene.html)) {
      throw new Error(`صفحة المشهد ${index + 1} غير صالحة لـ OpenFilm.`);
    }
    return { file: scene.file, duration: scene.duration, html: scene.html };
  });
  if (new Set(scenes.map((scene) => scene.file)).size !== scenes.length ||
    Math.abs(scenes.reduce((total, scene) => total + scene.duration, 0) - value.duration) > DURATION_TOLERANCE ||
    !/<html\b/i.test(value.film_html) || !/<section\b/i.test(value.film_html)) {
    throw new Error("مسارات أو مدد مشروع OpenFilm غير متطابقة؛ يجب أن تغطي المشاهد مدة الفيديو كاملة.");
  }
  for (const scene of scenes) {
    if (!new RegExp(`<iframe\\b[^>]*\\bsrc=["']${scene.file}(?:#t=|["'])`, "i").test(value.film_html)) {
      throw new Error(`film.html لا يحتوي على مشهد ${scene.file}.`);
    }
  }
  return {
    title: value.title.trim().slice(0, 160),
    width: value.width,
    height: value.height,
    duration: value.duration,
    film_html: value.film_html,
    scenes,
  };
}

function htmlBlock(name: string, html: string): string {
  return `HTML ${name} BEGIN\n${html}\nHTML ${name} END`;
}

export function formatW2MProject(project: OpenFilmProject): string {
  const sceneBlocks = project.scenes.map((scene) => [
    `DO SCENE ${scene.file}`,
    `DURATION ${scene.duration.toFixed(3)}s`,
    htmlBlock(scene.file, scene.html),
    "END SCENE",
  ].join("\n")).join("\n");
  return [
    "W2M/2",
    "DO PROJECT",
    `TITLE ${JSON.stringify(project.title.replace(/[\r\n]+/g, " ").trim())}`,
    `CANVAS ${project.width}x${project.height}`,
    `DURATION ${project.duration.toFixed(3)}s`,
    `SCENES ${project.scenes.length}`,
    "DO FILM",
    htmlBlock("film.html", project.film_html),
    "END FILM",
    sceneBlocks,
    "END PROJECT",
    "END W2M",
  ].filter((line) => line !== "").join("\n");
}

function validateW2MTimeline(project: OpenFilmProject, sourceLines: number[]): void {
  const iframePattern = /<iframe\b([^>]*)>/gi;
  const clips = new Map<string, Array<{ at: number | null; duration: number | null; line: number }>>();
  let match: RegExpExecArray | null;
  while ((match = iframePattern.exec(project.film_html))) {
    const attributes = match[1];
    const src = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!src) continue;
    const file = src.match(/(?:^|\/)(scene-\d{2}\.html)(?:#|$)/i)?.[1];
    if (!file) continue;
    const start = attributes.match(/\bat\s*=\s*(["']?)(\d+(?:\.\d+)?)\1/i)?.[2];
    const range = src.match(/#t=0(?:\.0*)?,(\d+(?:\.\d+)?)/i)?.[1];
    const clip = {
      at: start === undefined ? null : Number(start),
      duration: range === undefined ? null : Number(range),
      line: project.film_html.slice(0, match.index).split("\n").length,
    };
    const existing = clips.get(file) ?? [];
    existing.push(clip);
    clips.set(file, existing);
  }

  let nextStart = 0;
  for (let index = 0; index < project.scenes.length; index += 1) {
    const scene = project.scenes[index];
    const sceneLine = sourceLines[index] ?? 1;
    const references = clips.get(scene.file) ?? [];
    if (references.length !== 1) {
      throw diagnostic(
        "W2M201",
        sceneLine,
        `${scene.file} يجب أن يُستخدم مرة واحدة بالضبط في HTML FILM؛ وُجد ${references.length} مرجع.`,
      );
    }
    const clip = references[0];
    if (clip.duration === null || Math.abs(clip.duration - scene.duration) > DURATION_TOLERANCE) {
      throw diagnostic(
        "W2M202",
        sceneLine,
        `مدة مقطع ${scene.file} في FILM يجب أن تساوي DURATION المشهد (${scene.duration.toFixed(3)}s).`,
      );
    }
    if (clip.at === null || Math.abs(clip.at - nextStart) > DURATION_TOLERANCE) {
      throw diagnostic(
        "W2M203",
        sceneLine,
        `بداية ${scene.file} يجب أن تكون عند ${nextStart.toFixed(3)}s حتى لا يتداخل مع المشاهد السابقة أو يترك فجوة.`,
      );
    }
    nextStart += scene.duration;
  }

  for (const file of clips.keys()) {
    if (!project.scenes.some((scene) => scene.file === file)) {
      throw diagnostic("W2M204", 1, `FILM يشير إلى ${file}، لكنه غير معرّف ككتلة DO SCENE.`);
    }
  }
}

function validateCompiledProject(project: OpenFilmProject, sceneLines: number[]): OpenFilmProject {
  let checked: OpenFilmProject;
  try {
    checked = validateOpenFilmProject(project);
  } catch (reason) {
    throw diagnostic(
      "W2M200",
      1,
      reason instanceof Error ? reason.message : "تعذر التحقق من بنية حزمة OpenFilm.",
    );
  }
  const totalSourceLength = checked.film_html.length +
    checked.scenes.reduce((total, scene) => total + scene.html.length, 0);
  if (totalSourceLength > MAX_PROJECT_SOURCE_SIZE) {
    throw diagnostic("W2M205", 1, "تجاوز مصدر المشروع حد 900,000 محرف.");
  }
  if (!checked.title) throw diagnostic("W2M206", 1, "عنوان المشروع فارغ.");
  if (!/<\/html\s*>/i.test(checked.film_html)) {
    throw diagnostic("W2M207", 1, "HTML FILM يجب أن يحتوي على وسم إغلاق </html>.");
  }
  const seen = new Set<string>();
  for (let index = 0; index < checked.scenes.length; index += 1) {
    const scene = checked.scenes[index];
    if (seen.has(scene.file)) {
      throw diagnostic("W2M208", sceneLines[index] ?? 1, `اسم المشهد ${scene.file} مكرر.`);
    }
    seen.add(scene.file);
    const expectedFile = `scene-${String(index + 1).padStart(2, "0")}.html`;
    if (scene.file !== expectedFile) {
      throw diagnostic("W2M209", sceneLines[index] ?? 1, `اسم المشهد المتوقع هو ${expectedFile} لضمان ترتيب اللقطات.`);
    }
    if (!/<\/html\s*>/i.test(scene.html) || !/<\/body\s*>/i.test(scene.html)) {
      throw diagnostic("W2M210", sceneLines[index] ?? 1, `${scene.file} يجب أن يكون مستند HTML كاملًا يحتوي على </body> و</html>.`);
    }
    const pageDuration = scene.html.match(/window\.film\s*=\s*\{[\s\S]*?\bduration\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];
    if (pageDuration !== undefined && Math.abs(Number(pageDuration) - scene.duration) > DURATION_TOLERANCE) {
      throw diagnostic(
        "W2M211",
        sceneLines[index] ?? 1,
        `window.film.duration داخل ${scene.file} لا يساوي مدة المشهد ${scene.duration.toFixed(3)}s.`,
      );
    }
  }
  validateW2MTimeline(checked, sceneLines);
  return checked;
}

function addMissingTimelineStarts(filmHtml: string, scenes: ProjectScene[]): string {
  const sceneStarts = new Map<string, number>();
  let nextStart = 0;
  for (const scene of scenes) {
    sceneStarts.set(scene.file, nextStart);
    nextStart += scene.duration;
  }

  return filmHtml.replace(/<iframe\b[^>]*>/gi, (tag) => {
    const attributes = tag.slice("<iframe".length, -1);
    const src = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!src || /\bat\s*=/.test(attributes)) return tag;
    const file = src.match(/(?:^|\/)(scene-\d{2}\.html)(?:#|$)/i)?.[1];
    const scene = scenes.find((item) => item.file === file);
    const start = file ? sceneStarts.get(file) : undefined;
    const duration = src.match(/#t=0(?:\.0*)?,(\d+(?:\.\d+)?)/i)?.[1];
    if (!scene || start === undefined || duration === undefined ||
      Math.abs(Number(duration) - scene.duration) > DURATION_TOLERANCE) return tag;
    return tag.replace(/\/?>$/, (ending) => ` at="${start.toFixed(3)}"${ending}`);
  });
}

function cleanReply(reply: string): string {
  let cleaned = reply.replace(/^\uFEFF/, "").trim()
    .replace(/```[ \t]*(W2M\/(?:1|2)(?:[ \t]+PROJECT)?)[ \t]*(?=\r?\n)/gi, "$1")
    .replace(/^```[^\r\n]*\r?\n/, "")
    .replace(/\r?\n```[ \t]*$/, "");
  const header = /(?:^|\r?\n)(W2M\/(?:1|2))(?:[ \t]+PROJECT)?[ \t]*(?=\r?\n|$)/i.exec(cleaned);
  if (header?.index !== undefined && header.index > 0) {
    cleaned = cleaned.slice(header.index + (cleaned[header.index] === "\n" ? 1 : 0));
  }
  return cleaned
    .replace(/^DO SCENE[ \t]+(scene-\d{2}\.html)[ \t]+BEGIN(?:[ \t]+\d+(?:\.\d+)?s)?[ \t]*$/gim, "DO SCENE $1")
    .replace(/^W2M\/2[ \t]+PROJECT(?=\r?\n|$)/i, "W2M/2");
}

export function parseW2MProject(reply: string): OpenFilmProject {
  const source = cleanReply(reply);
  if (source.length > MAX_PROJECT_SOURCE_SIZE + 100_000) {
    throw diagnostic("W2M001", 1, "رد W2M أكبر من الحد المسموح.");
  }
  const lines = source.split(/\r?\n/);
  let cursor = 0;
  const readLine = (): string => lines[cursor++]?.trim() ?? "";
  const expectLine = (expected: RegExp, code: string, message: string): string => {
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    const lineNumber = cursor + 1;
    const line = readLine();
    if (!expected.test(line)) throw diagnostic(code, lineNumber, message);
    return line;
  };
  const readHtmlBlock = (name: string): string => {
    const lineNumber = cursor + 1;
    expectLine(
      new RegExp(`^HTML ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} BEGIN$`, "i"),
      "W2M102",
      `يجب أن تبدأ الكتلة بالسطر HTML ${name} BEGIN.`,
    );
    const content: string[] = [];
    const ending = `HTML ${name} END`.toUpperCase();
    while (cursor < lines.length && lines[cursor].trim().toUpperCase() !== ending) {
      if (/^HTML\s+.+\s+BEGIN$/i.test(lines[cursor].trim())) {
        throw diagnostic("W2M103", cursor + 1, `كتلة HTML ${name} بدأت قبل إغلاق الكتلة الحالية.`);
      }
      content.push(lines[cursor++]);
    }
    if (cursor >= lines.length) {
      throw diagnostic("W2M104", lineNumber, `كتلة HTML ${name} غير مكتملة؛ أضف السطر HTML ${name} END.`);
    }
    cursor += 1;
    const html = content.join("\n").replace(/^\s*\n|\n\s*$/g, "");
    if (!html.trim()) throw diagnostic("W2M105", lineNumber, `كتلة HTML ${name} فارغة.`);
    return html;
  };

  const versionLine = expectLine(
    /^W2M\/(?:1|2)$/i,
    "W2M100",
    "يجب أن يبدأ ملف الموشن جرافيك بـ W2M/2 فقط، ثم DO PROJECT في السطر التالي. أزل أي مقدمة أو اسم قسم من سطر الإصدار.",
  );
  const version = Number(versionLine.split("/")[1]);
  expectLine(/^DO PROJECT$/i, "W2M101", "كتلة DO PROJECT مفقودة.");
  const titleLine = expectLine(
    version === 2 ? /^TITLE\s+.+$/i : /^TITLE:\s*.+$/i,
    "W2M106",
    "أضف TITLE بعنوان غير فارغ في بيانات المشروع.",
  );
  let title = titleLine.replace(/^TITLE\s*:?\s*/i, "");
  if (version === 2) {
    try {
      const parsedTitle: unknown = JSON.parse(title);
      if (typeof parsedTitle !== "string") throw new Error("not string");
      title = parsedTitle;
    } catch {
      throw diagnostic("W2M107", cursor, 'قيمة TITLE يجب أن تكون نصًا محاطًا بعلامتي اقتباس مثل TITLE "عنوان الفيلم".');
    }
  }
  const canvasLine = expectLine(
    version === 2 ? /^CANVAS\s+\d+x\d+$/i : /^CANVAS:\s*\d+x\d+$/i,
    "W2M108",
    "قيمة CANVAS غير صالحة؛ استخدم مثلًا CANVAS 1280x720.",
  );
  const canvas = canvasLine.match(/(\d+)x(\d+)/i);
  if (!canvas) throw diagnostic("W2M108", cursor, "تعذر تحليل أبعاد CANVAS.");
  const width = Number(canvas[1]);
  const height = Number(canvas[2]);
  const durationLine = expectLine(
    version === 2 ? /^DURATION\s+\d+(?:\.\d+)?s$/i : /^DURATION:\s*\d+(?:\.\d+)?$/i,
    "W2M109",
    "مدة المشروع غير صالحة؛ استخدم DURATION 30.000s.",
  );
  const duration = Number(durationLine.match(/(\d+(?:\.\d+)?)/)?.[1]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw diagnostic("W2M109", cursor, "مدة المشروع يجب أن تكون أكبر من صفر ثانية.");
  }
  let declaredSceneCount = 0;
  if (version === 2) {
    const countLine = expectLine(/^SCENES\s+\d+$/i, "W2M110", "أضف SCENES متبوعًا بعدد المشاهد.");
    declaredSceneCount = Number(countLine.match(/\d+/)?.[0]);
    if (declaredSceneCount < 1 || declaredSceneCount > MAX_SCENES) {
      throw diagnostic("W2M110", cursor, `عدد المشاهد يجب أن يكون بين 1 و${MAX_SCENES}.`);
    }
  }

  expectLine(/^DO FILM$/i, "W2M111", "كتلة DO FILM مفقودة.");
  if (version === 2) expectLine(/^HTML film\.html BEGIN$/i, "W2M102", "ابدأ محتوى الفيلم بالسطر HTML film.html BEGIN.");
  const filmHtml = version === 2 ? (() => {
    cursor -= 1;
    return readHtmlBlock("film.html");
  })() : readLegacyHtmlBlock("FILM");
  expectLine(/^END FILM$/i, "W2M112", "أغلق كتلة الفيلم بوسم END FILM.");

  const scenes: ProjectScene[] = [];
  const sceneLines: number[] = [];
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (!/^DO SCENE\b/i.test(lines[cursor]?.trim() ?? "")) break;
    const sceneLine = cursor + 1;
    const header = expectLine(/^DO SCENE\s+scene-\d{2}\.html$/i, "W2M113", "اسم المشهد غير صالح؛ استخدم DO SCENE scene-01.html.");
    const file = header.match(/^DO SCENE\s+(scene-\d{2}\.html)$/i)?.[1];
    if (!file) throw diagnostic("W2M113", sceneLine, "اسم ملف المشهد غير صالح.");
    const sceneDurationLine = expectLine(
      version === 2 ? /^DURATION\s+\d+(?:\.\d+)?s$/i : /^DURATION:\s*\d+(?:\.\d+)?$/i,
      "W2M114",
      `أضف مدة ${file} بالثواني مثل DURATION 8.000s.`,
    );
    const sceneDuration = Number(sceneDurationLine.match(/(\d+(?:\.\d+)?)/)?.[1]);
    if (!Number.isFinite(sceneDuration) || sceneDuration <= 0) {
      throw diagnostic("W2M114", cursor, `مدة ${file} يجب أن تكون أكبر من صفر.`);
    }
    if (version === 2) {
      expectLine(new RegExp(`^HTML ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} BEGIN$`, "i"), "W2M102", `ابدأ المشهد بالسطر HTML ${file} BEGIN.`);
      cursor -= 1;
    }
    const html = version === 2 ? readHtmlBlock(file) : readLegacyHtmlBlock(file);
    expectLine(/^END SCENE$/i, "W2M115", `أغلق ${file} بوسم END SCENE.`);
    scenes.push({ file, duration: sceneDuration, html });
    sceneLines.push(sceneLine);
    if (scenes.length > MAX_SCENES) {
      throw diagnostic("W2M110", sceneLine, `عدد المشاهد تجاوز الحد الأقصى ${MAX_SCENES}.`);
    }
  }
  if (version === 2 && scenes.length !== declaredSceneCount) {
    throw diagnostic("W2M116", cursor + 1, `SCENES يعلن ${declaredSceneCount} مشاهد لكن الملف يحتوي ${scenes.length}.`);
  }
  expectLine(/^END PROJECT$/i, "W2M117", "أغلق المشروع بوسم END PROJECT.");
  if (version === 2) expectLine(/^END W2M$/i, "W2M118", "أغلق البرنامج بوسم END W2M.");
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  if (cursor !== lines.length) throw diagnostic("W2M119", cursor + 1, "يوجد محتوى زائد بعد نهاية البرنامج.");

  return validateCompiledProject({
    title,
    width,
    height,
    duration,
    film_html: addMissingTimelineStarts(filmHtml, scenes),
    scenes,
  }, sceneLines);

  function readLegacyHtmlBlock(name: string): string {
    const opening = name === "FILM" ? "<<<W2M:BEGIN:FILM>>>" : `<<<W2M:BEGIN:${name}>>>`;
    const closing = name === "FILM" ? "<<<W2M:END:FILM>>>" : `<<<W2M:END:${name}>>>`;
    const lineNumber = cursor + 1;
    expectLine(
      new RegExp(`^${opening.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      "W2M102",
      `يجب أن تبدأ الكتلة بالعلامة ${opening}.`,
    );
    const content: string[] = [];
    while (cursor < lines.length && lines[cursor].trim().toUpperCase() !== closing.toUpperCase()) {
      content.push(lines[cursor++]);
    }
    if (cursor >= lines.length) throw diagnostic("W2M104", lineNumber, `كتلة ${name} غير مكتملة؛ أضف ${closing}.`);
    cursor += 1;
    const html = content.join("\n").replace(/^\s*\n|\n\s*$/g, "");
    if (!html.trim()) throw diagnostic("W2M105", lineNumber, `كتلة HTML ${name} فارغة.`);
    return html;
  }
}
