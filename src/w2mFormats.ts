export type W2MFlowNode = { id: string; label: string; shape: string; x: number; y: number };
export type W2MFlowEdge = { id: string; source: string; target: string; label: string };
export type W2MFlowchart = { nodes: W2MFlowNode[]; edges: W2MFlowEdge[] };
export type W2MTable = { title: string; columns: string[]; rows: string[][] };
export type W2MPlan = {
  title: string;
  units: "m" | "cm";
  walls: Array<{ x1: number; y1: number; x2: number; y2: number; height: number; thickness: number }>;
  rooms: Array<{ name: string; x: number; y: number; width: number; height: number }>;
  doors: Array<{ x: number; y: number; width: number; rotation: number }>;
  windows: Array<{ x: number; y: number; width: number; rotation: number }>;
};
export type W2MDesignAction = Record<string, string | number>;
export type W2MDesign = { title: string; actions: W2MDesignAction[] };

function fail(section: string, line: number, message: string): never {
  throw new Error(`W2M/2 ${section} (سطر ${line}): ${message}`);
}

function sourceLines(source: string, section: string): string[] {
  const cleaned = source.trim()
    .replace(/^```(?:w2m(?:\/2)?(?:\s+[a-z]+)?|text)?[ \t]*\r?\n/i, "")
    .replace(/\r?\n```[ \t]*$/, "");
  const lines = cleaned.split(/\r?\n/);
  if (lines[0]?.trim() !== `W2M/2 ${section}`) {
    fail(section, 1, `يجب أن يبدأ الملف بـ W2M/2 ${section}.`);
  }
  if (lines.length > 20_000 || cleaned.length > 900_000) fail(section, 1, "تجاوز الملف الحد الأقصى.");
  return lines;
}

function tokenize(line: string, section: string, lineNumber: number): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (/\s/.test(line[cursor] ?? "")) cursor += 1;
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      while (cursor < line.length) {
        const character = line[cursor++];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') break;
      }
      const encoded = line.slice(start, cursor);
      try {
        const decoded: unknown = JSON.parse(encoded);
        if (typeof decoded !== "string") fail(section, lineNumber, "القيمة المقتبسة يجب أن تكون نصًا.");
        tokens.push(decoded);
      } catch {
        fail(section, lineNumber, "علامات الاقتباس أو محارف الهروب غير مكتملة.");
      }
    } else {
      const start = cursor;
      while (cursor < line.length && !/\s/.test(line[cursor])) cursor += 1;
      tokens.push(line.slice(start, cursor));
    }
  }
  return tokens;
}

function numberToken(value: string | undefined, section: string, line: number, label: string): number {
  const number = Number(value);
  if (value === undefined || !Number.isFinite(number)) fail(section, line, `${label} يجب أن يكون رقمًا صالحًا.`);
  return number;
}

function endOfProgram(lines: string[], section: string): void {
  const meaningful = lines.map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (meaningful.at(-2)?.line !== `END ${section}` || meaningful.at(-1)?.line !== "END W2M") {
    fail(section, meaningful.at(-1)?.number ?? 1, `أغلق الملف بـ END ${section} ثم END W2M.`);
  }
}

export function parseW2MFlowchart(source: string, allowedShapes: readonly string[]): W2MFlowchart {
  const section = "FLOWCHART";
  const lines = sourceLines(source, section);
  endOfProgram(lines, section);
  const nodes: W2MFlowNode[] = [];
  const edges: W2MFlowEdge[] = [];
  for (let index = 1; index < lines.length - 2; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const line = index + 1;
    const tokens = tokenize(raw, section, line);
    if (tokens[0] === "NODE" && tokens.length === 9 && tokens[2] === "SHAPE" &&
      tokens[4] === "AT" && tokens[7] === "LABEL") {
      const [, id, , shape, , x, y, , label] = tokens;
      if (!/^[\w-]{1,60}$/.test(id) || !allowedShapes.includes(shape) || !label.trim()) {
        fail(section, line, "بيانات NODE أو الشكل أو الاسم غير صالح.");
      }
      nodes.push({
        id,
        label: label.slice(0, 180),
        shape,
        x: numberToken(x, section, line, "X"),
        y: numberToken(y, section, line, "Y"),
      });
    } else if (tokens[0] === "EDGE" && tokens.length === 7 &&
      tokens[2] === "FROM" && tokens[4] === "TO" && tokens[6].startsWith("LABEL=")) {
      fail(section, line, 'استخدم EDGE <id> FROM <source> TO <target> LABEL "نص".');
    } else if (tokens[0] === "EDGE" && tokens.length === 8 &&
      tokens[2] === "FROM" && tokens[4] === "TO" && tokens[6] === "LABEL") {
      const [, id, , sourceId, , targetId, , label] = tokens;
      if (!/^[\w-]{1,60}$/.test(id) || !sourceId || !targetId) fail(section, line, "بيانات EDGE غير صالحة.");
      edges.push({ id, source: sourceId, target: targetId, label: label.slice(0, 180) });
    } else {
      fail(section, line, 'أمر غير معروف؛ استخدم NODE أو EDGE أو علامة نهاية القسم.');
    }
    if (nodes.length > 80 || edges.length > 160) fail(section, line, "تجاوز عدد عناصر المخطط الحد المسموح.");
  }
  const ids = new Set(nodes.map((node) => node.id));
  if (!nodes.length || ids.size !== nodes.length) fail(section, 1, "أضف عقدًا بمعرّفات فريدة.");
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length ||
    edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) {
    fail(section, 1, "معرّفات الوصلات يجب أن تكون فريدة وأن تشير إلى عقد موجودة.");
  }
  return { nodes, edges };
}

export function parseW2MTable(source: string): W2MTable {
  const section = "TABLE";
  const lines = sourceLines(source, section);
  endOfProgram(lines, section);
  let title = "";
  const columns: string[] = [];
  const rows: string[][] = [];
  let currentRow: string[] | null = null;
  for (let index = 1; index < lines.length - 2; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const line = index + 1;
    const tokens = tokenize(raw, section, line);
    if (tokens[0] === "TITLE" && tokens.length === 2 && !title) title = tokens[1].slice(0, 100);
    else if (tokens[0] === "COLUMN" && tokens.length === 2 && currentRow === null) {
      columns.push(tokens[1].slice(0, 80));
      if (columns.length > 10) fail(section, line, "يُسمح بعشرة أعمدة كحد أقصى.");
    } else if (tokens.length === 2 && tokens[0] === "BEGIN" && tokens[1] === "ROW" && currentRow === null) currentRow = [];
    else if (tokens.length === 2 && tokens[0] === "END" && tokens[1] === "ROW" && currentRow !== null) {
      if (currentRow.length !== columns.length) fail(section, line, "عدد الخلايا يجب أن يطابق عدد الأعمدة.");
      rows.push(currentRow);
      currentRow = null;
      if (rows.length > 50) fail(section, line, "يُسمح بخمسين صفًا كحد أقصى.");
    } else if (tokens[0] === "CELL" && tokens.length === 2 && currentRow !== null) {
      currentRow.push(tokens[1].slice(0, 500));
    } else fail(section, line, "أمر غير متوقع أو ترتيب حقول غير صالح.");
  }
  if (!title || !columns.length || currentRow !== null || rows.length < 1) {
    fail(section, 1, "العنوان والأعمدة وصف واحد على الأقل مطلوبة، ويجب إغلاق كل صف.");
  }
  return { title, columns, rows };
}

export function parseW2MPlan(source: string): W2MPlan {
  const section = "PLAN";
  const lines = sourceLines(source, section);
  endOfProgram(lines, section);
  const plan: W2MPlan = { title: "", units: "m", walls: [], rooms: [], doors: [], windows: [] };
  for (let index = 1; index < lines.length - 2; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const line = index + 1;
    const tokens = tokenize(raw, section, line);
    if (tokens[0] === "TITLE" && tokens.length === 2 && !plan.title) plan.title = tokens[1].slice(0, 100);
    else if (tokens[0] === "UNITS" && tokens.length === 2 && ["m", "cm"].includes(tokens[1])) plan.units = tokens[1] as "m" | "cm";
    else if (tokens[0] === "WALL" && tokens.length === 7) {
      plan.walls.push({
        x1: numberToken(tokens[1], section, line, "x1"), y1: numberToken(tokens[2], section, line, "y1"),
        x2: numberToken(tokens[3], section, line, "x2"), y2: numberToken(tokens[4], section, line, "y2"),
        height: numberToken(tokens[5], section, line, "height"), thickness: numberToken(tokens[6], section, line, "thickness"),
      });
    } else if (tokens[0] === "ROOM" && tokens.length === 6) {
      plan.rooms.push({
        name: tokens[1].slice(0, 80), x: numberToken(tokens[2], section, line, "x"),
        y: numberToken(tokens[3], section, line, "y"), width: numberToken(tokens[4], section, line, "width"),
        height: numberToken(tokens[5], section, line, "height"),
      });
    } else if ((tokens[0] === "DOOR" || tokens[0] === "WINDOW") && tokens.length === 5) {
      const opening = {
        x: numberToken(tokens[1], section, line, "x"), y: numberToken(tokens[2], section, line, "y"),
        width: numberToken(tokens[3], section, line, "width"), rotation: numberToken(tokens[4], section, line, "rotation"),
      };
      if (tokens[0] === "DOOR") plan.doors.push(opening);
      else plan.windows.push(opening);
    } else fail(section, line, "أمر غير معروف؛ استخدم TITLE أو UNITS أو WALL أو ROOM أو DOOR أو WINDOW.");
    if (plan.walls.length > 400 || plan.rooms.length > 80 || plan.doors.length > 100 || plan.windows.length > 100) {
      fail(section, line, "تجاوزت عناصر المخطط الحدود المسموحة.");
    }
  }
  if (!plan.title || !plan.walls.length || plan.rooms.some((room) => room.width <= 0 || room.height <= 0) ||
    plan.walls.some((wall) => Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) <= 0.05) ||
    [...plan.doors, ...plan.windows].some((opening) => opening.width <= 0)) {
    fail(section, 1, "العنوان والجدران الصالحة مطلوبة، ويجب أن تكون أبعاد الغرف والفتحات موجبة.");
  }
  return plan;
}

export function formatW2MPlan(plan: W2MPlan): string {
  const records = [
    "W2M/2 PLAN",
    `TITLE ${JSON.stringify(plan.title)}`,
    `UNITS ${plan.units}`,
    ...plan.walls.map((wall) =>
      `WALL ${wall.x1} ${wall.y1} ${wall.x2} ${wall.y2} ${wall.height} ${wall.thickness}`),
    ...plan.rooms.map((room) =>
      `ROOM ${JSON.stringify(room.name)} ${room.x} ${room.y} ${room.width} ${room.height}`),
    ...plan.doors.map((door) => `DOOR ${door.x} ${door.y} ${door.width} ${door.rotation}`),
    ...plan.windows.map((window) => `WINDOW ${window.x} ${window.y} ${window.width} ${window.rotation}`),
    "END PLAN",
    "END W2M",
  ];
  return records.join("\n");
}

export function parseW2MDesign(source: string): W2MDesign {
  const section = "DESIGN";
  const lines = sourceLines(source, section);
  endOfProgram(lines, section);
  let title = "";
  const actions: W2MDesignAction[] = [];
  const readPairs = (tokens: string[], start: number, line: number): Record<string, string | number> => {
    const result: Record<string, string | number> = {};
    for (let index = start; index < tokens.length; index += 2) {
      const key = tokens[index]?.toUpperCase();
      const value = tokens[index + 1];
      if (!key || value === undefined || !/^[A-Z_]+$/.test(key) || key in result) {
        fail(section, line, "خصائص الأمر يجب أن تكون أزواجًا من اسم وقيمة دون تكرار.");
      }
      const number = Number(value);
      result[key] = value.trim() !== "" && Number.isFinite(number) ? number : value;
    }
    return result;
  };
  for (let index = 1; index < lines.length - 2; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const line = index + 1;
    const tokens = tokenize(raw, section, line);
    if (tokens[0] === "TITLE" && tokens.length === 2 && !title) {
      title = tokens[1].slice(0, 60);
      continue;
    }
    const command = tokens[0];
    if (command === "ADD" && tokens.length >= 3) {
      const action: W2MDesignAction = { type: "add", shape: tokens[1].toLowerCase(), id: tokens[2] };
      Object.assign(action, readPairs(tokens, 3, line));
      actions.push(action);
    } else if (command === "IMAGE" && tokens.length >= 2) {
      const action: W2MDesignAction = { type: "add-image", assetId: tokens[1] };
      Object.assign(action, readPairs(tokens, 2, line));
      actions.push(action);
    } else if (command === "UPDATE" && tokens.length >= 2) {
      const action: W2MDesignAction = { type: "update", target: tokens[1] };
      Object.assign(action, readPairs(tokens, 2, line));
      actions.push(action);
    } else if (["MOVE", "DELETE", "SELECT", "FRONT", "BACK"].includes(command) && tokens.length >= 2) {
      actions.push({ type: command.toLowerCase(), target: tokens[1], ...readPairs(tokens, 2, line) });
    } else if (command === "ROTATE" && tokens.length === 4 && tokens[2] === "DEGREES") {
      actions.push({ type: "rotate", target: tokens[1], angle: numberToken(tokens[3], section, line, "DEGREES") });
    } else if (command === "TOOL" && tokens.length === 2) actions.push({ type: "tool", toolId: tokens[1] });
    else if (command === "ZOOM" && tokens.length === 2) actions.push({ type: "zoom", factor: numberToken(tokens[1], section, line, "factor") });
    else if (command === "PAN" && tokens.length === 3) actions.push({ type: "pan", dx: numberToken(tokens[1], section, line, "dx"), dy: numberToken(tokens[2], section, line, "dy") });
    else fail(section, line, "أمر تصميم غير معروف أو حقوله غير مكتملة.");
    if (actions.length > 64) fail(section, line, "يُسمح بـ64 أمرًا كحد أقصى.");
  }
  if (!title || !actions.length) fail(section, 1, "عنوان التصميم وأمر واحد على الأقل مطلوبان.");
  return { title, actions };
}
