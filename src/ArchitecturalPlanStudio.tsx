import { useEffect, useRef, useState } from "react";
import { Building2, Eye, ImageUp, LoaderCircle, Rotate3D, Sparkles, WandSparkles } from "lucide-react";
import { buildCirculationDoors, deriveWallsFromRooms, placeOpeningsOnWalls, roomLayoutIssues, tileRoomsIntoFootprint } from "../vendor/opencalque/apps/web/src/architectural-plan-geometry";
import { API_BASE, apiFetch, deliverArtifactToTelegram, sanitizeArtifactFilename, serviceUrl } from "./api";
import "./ArchitecturalPlanStudio.css";
import { useLanguage, translate } from "./localization";
import { formatW2MPlan, parseW2MPlan } from "./w2mFormats";

const GENERATION_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DEFAULT_PLAN_PROMPT = "أنشئ مخطط شقة مساحته نحو 110 متر مربع، 11×10 متر، غرفتين نوم وصالة ومطبخ وحمامين. اجعل كل المساحة موزعة على غرف مسماة وممرات واضحة، بلا فراغات متبقية أو غرف متداخلة.";
type Provider = { id: string; name: string; model: string; is_default: boolean };
type Wall = { x1: number; y1: number; x2: number; y2: number; height?: number; thickness?: number };
type Door = { x: number; y: number; width?: number; rotation?: number };
type Window = { x: number; y: number; width?: number; rotation?: number };
type Room = { name: string; x: number; y: number; width: number; height: number; polygon?: [number, number][] };
type Plan = { title?: string; units?: "m" | "cm"; walls: Wall[]; rooms?: Room[]; doors?: Door[]; windows?: Window[] };

const DEFAULT_PLAN: Plan = {
  title: "مخطط سكني",
  units: "m",
  rooms: [
    { name: "معيشة", x: 0.18, y: 0.18, width: 7.64, height: 5 },
    { name: "غرفة رئيسية", x: 7.82, y: 0.18, width: 3, height: 5 },
    { name: "مطبخ", x: 0.18, y: 5.18, width: 5, height: 4.64 },
    { name: "حمام 1", x: 5.18, y: 5.18, width: 2.64, height: 2.32 },
    { name: "غرفة نوم 2", x: 7.82, y: 5.18, width: 3, height: 4.64 },
    { name: "ممر", x: 5.18, y: 7.5, width: 2.64, height: 2.32 },
  ],
  walls: [
    { x1: 0.18, y1: 0.18, x2: 10.82, y2: 0.18 }, { x1: 10.82, y1: 0.18, x2: 10.82, y2: 9.82 },
    { x1: 10.82, y1: 9.82, x2: 0.18, y2: 9.82 }, { x1: 0.18, y1: 9.82, x2: 0.18, y2: 0.18 },
  ],
  doors: buildCirculationDoors([
    { name: "معيشة", x: 0.18, y: 0.18, width: 7.64, height: 5 },
    { name: "غرفة رئيسية", x: 7.82, y: 0.18, width: 3, height: 5 },
    { name: "مطبخ", x: 0.18, y: 5.18, width: 5, height: 4.64 },
    { name: "حمام 1", x: 5.18, y: 5.18, width: 2.64, height: 2.32 },
    { name: "غرفة نوم 2", x: 7.82, y: 5.18, width: 3, height: 4.64 },
    { name: "ممر", x: 5.18, y: 7.5, width: 2.64, height: 2.32 },
  ]),
  windows: [{ x: 2, y: 0.18, width: 1.8 }, { x: 9, y: 9.82, width: 1.8 }],
};

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roomLayoutRepairContext(plan: Plan): string {
  const rooms = plan.rooms ?? [];
  const walls = plan.walls;
  const xs = walls.flatMap((wall) => [wall.x1, wall.x2]);
  const ys = walls.flatMap((wall) => [wall.y1, wall.y2]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const siteArea = width * height;
  const roomArea = rooms.reduce((total, room) => total + room.width * room.height, 0);
  const overlaps = rooms.flatMap((room, index) => rooms.slice(index + 1).flatMap((other) => {
    const overlapWidth = Math.max(0, Math.min(room.x + room.width, other.x + other.width) - Math.max(room.x, other.x));
    const overlapHeight = Math.max(0, Math.min(room.y + room.height, other.y + other.height) - Math.max(room.y, other.y));
    return overlapWidth * overlapHeight > 0.01
      ? [`${room.name} / ${other.name}: ${(overlapWidth * overlapHeight).toFixed(2)} m²`]
      : [];
  }));
  return [
    `Building boundary from wall extents: ${width.toFixed(2)} m × ${height.toFixed(2)} m (${siteArea.toFixed(2)} m²).`,
    `Current summed room area: ${roomArea.toFixed(2)} m².`,
    roomArea > siteArea && siteArea > 0
      ? `Room areas exceed the building area. Scale all room areas proportionally by ${Math.sqrt(siteArea / roomArea).toFixed(3)} before placing them.`
      : "",
    overlaps.length > 0 ? `Overlapping room pairs: ${overlaps.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

function isPlanOpening(value: unknown): value is Door | Window {
  return isRecord(value) && [value.x, value.y].every((item) => typeof item === "number" && Number.isFinite(item)) &&
    (value.width === undefined || typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0) &&
    (value.rotation === undefined || typeof value.rotation === "number" && Number.isFinite(value.rotation));
}

function isPlanWall(value: unknown): value is Wall {
  return isRecord(value) &&
    [value.x1, value.y1, value.x2, value.y2].every((item) => typeof item === "number" && Number.isFinite(item)) &&
    (value.thickness === undefined || typeof value.thickness === "number" && Number.isFinite(value.thickness) && value.thickness > 0) &&
    (value.height === undefined || typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planFromEditor(value: unknown): Plan | null {
  if (!isRecord(value) || !Array.isArray(value.walls)) return null;
  if (value.units !== undefined && value.units !== "m" && value.units !== "cm") return null;
  if (value.rooms !== undefined && !Array.isArray(value.rooms)) return null;
  if (value.doors !== undefined && !Array.isArray(value.doors)) return null;
  if (value.windows !== undefined && !Array.isArray(value.windows)) return null;
  const rawWalls = value.walls;
  if (!rawWalls.every(isPlanWall)) return null;
  const walls = rawWalls.filter((wall) => Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) > 0.05);
  if (walls.length !== value.walls.length) return null;
  const rawRooms = Array.isArray(value.rooms) ? value.rooms : [];
  const rooms = rawRooms.flatMap((room): Room[] => {
    if (!isRecord(room) || typeof room.name !== "string" ||
      ![room.x, room.y, room.width, room.height].every((part) => typeof part === "number" && Number.isFinite(part)) ||
      (room.width as number) <= 0 || (room.height as number) <= 0) return [];
    if (room.polygon !== undefined && !Array.isArray(room.polygon)) return [];
    const polygon = Array.isArray(room.polygon) ? room.polygon.filter(
      (point): point is [number, number] => Array.isArray(point) && point.length === 2 &&
        point.every((part) => typeof part === "number" && Number.isFinite(part)),
    ) : undefined;
    if (Array.isArray(room.polygon) && (polygon?.length ?? 0) !== room.polygon.length) return [];
    if (polygon && polygon.length > 0 && polygon.length < 3) return [];
    return [{
      name: room.name,
      x: room.x as number, y: room.y as number, width: room.width as number, height: room.height as number,
      ...(polygon && polygon.length >= 3 ? { polygon } : {}),
    }];
  });
  if (rooms.length !== rawRooms.length) return null;
  const readOpenings = (items: unknown): Array<Door | Window> | null => Array.isArray(items) ? items.flatMap((opening) => {
    if (!isPlanOpening(opening)) return [];
    return [{
      x: opening.x as number, y: opening.y as number,
      width: typeof opening.width === "number" ? opening.width : undefined,
      rotation: typeof opening.rotation === "number" ? opening.rotation : undefined,
    }];
  }) : [];
  const doors = readOpenings(value.doors);
  const windows = readOpenings(value.windows);
  if (!doors || !windows || Array.isArray(value.doors) && doors.length !== value.doors.length ||
    Array.isArray(value.windows) && windows.length !== value.windows.length) return null;
  return {
    title: typeof value.title === "string" ? value.title : "Architectural plan",
    units: value.units === "cm" ? "cm" : "m",
    walls,
    rooms,
    doors,
    windows,
  };
}

export default function ArchitecturalPlanStudio({
  engine2dEnabled = true,
  engine3dEnabled = true,
}: {
  engine2dEnabled?: boolean;
  engine3dEnabled?: boolean;
} = {}) {
  const language = useLanguage();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PLAN_PROMPT);
  const [promptEdited, setPromptEdited] = useState(false);
  const visiblePrompt = promptEdited ? prompt : translate(DEFAULT_PLAN_PROMPT, language);
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN);
  const [view, setView] = useState<"plan" | "model">(engine2dEnabled ? "plan" : "model");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [rawReply, setRawReply] = useState("");
  const [replyTab, setReplyTab] = useState<"result" | "program">("result");
  const [sourceImage, setSourceImage] = useState<string>("");
  const [aedifexProject, setAedifexProject] = useState<string>("");
  const [aedifexPlanSignature, setAedifexPlanSignature] = useState("");
  const [opening3d, setOpening3d] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState("");

  const [editorSyncPlan, setEditorSyncPlan] = useState<Plan | null>(null);
  const [editorConnected, setEditorConnected] = useState(false);
  const editorRef = useRef<HTMLIFrameElement>(null);
  const externalEditorRef = useRef<WindowProxy | null>(null);
  const editorReady = useRef(false);
  const editorPlanLoaded = useRef(false);
  const latestPlan = useRef(plan);

  useEffect(() => {
    if (!engine2dEnabled) setView("model");
    else if (!engine3dEnabled) setView("plan");
  }, [engine2dEnabled, engine3dEnabled]);

  useEffect(() => { latestPlan.current = plan; }, [plan]);

  useEffect(() => {
    const editorOrigin = serviceUrl(5174);
    const handleEditorMessage = (event: MessageEvent<unknown>) => {
      const fromEmbeddedFrame = event.source === editorRef.current?.contentWindow;
      const fromExternalEditor = event.source === externalEditorRef.current || isRecord(event.data) && event.data.type === "ready";
      if (event.origin !== editorOrigin || !fromEmbeddedFrame && !fromExternalEditor || !isRecord(event.data) ||
        event.data.channel !== "ai-taskflow:opencalque" || typeof event.data.type !== "string") return;
      if (event.data.type === "ready") {
        if (!fromEmbeddedFrame && event.source) externalEditorRef.current = event.source as WindowProxy;
        editorReady.current = true;
        setEditorConnected(true);
        editorPlanLoaded.current = false;
        setEditorSyncPlan(null);
        const editorWindow = event.source === externalEditorRef.current
          ? externalEditorRef.current
          : editorRef.current?.contentWindow;
        editorWindow?.postMessage({
          channel: "ai-taskflow:opencalque", type: "load-plan", payload: latestPlan.current,
        }, editorOrigin);
      } else if (event.data.type === "document" && isRecord(event.data.payload)) {
        const nextPlan = planFromEditor(event.data.payload.plan);
        if (nextPlan && (!editorPlanLoaded.current && nextPlan.walls.length === 0)) return;
        if (nextPlan) {
          editorPlanLoaded.current = true;
          setPlan(nextPlan);
        }
        else setError("رجع محرر OpenCalque بيانات مخطط غير صالحة؛ لم يتم تحديث مخطط 3D.");
      } else if (event.data.type === "error" && isRecord(event.data.payload) && typeof event.data.payload.message === "string") {
        setError(`تعذر تحميل المخطط في OpenCalque: ${event.data.payload.message}`);
      }
    };
    window.addEventListener("message", handleEditorMessage);
    return () => window.removeEventListener("message", handleEditorMessage);
  }, []);

  useEffect(() => {
    if (!editorReady.current || !editorSyncPlan) return;
    editorPlanLoaded.current = false;
    const message = {
      channel: "ai-taskflow:opencalque", type: "load-plan", payload: editorSyncPlan,
    };
    const editorOrigin = serviceUrl(5174);
    editorRef.current?.contentWindow?.postMessage(message, editorOrigin);
    externalEditorRef.current?.postMessage(message, editorOrigin);
    setEditorSyncPlan(null);
  }, [editorSyncPlan]);

  useEffect(() => {
    if (view !== "plan" || editorConnected) return;
    const timeout = window.setTimeout(() => {
      setError("محرر OpenCalque غير متصل. شغّل الخدمات باستخدام start-all.bat ثم أعد تحميل الصفحة.");
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [editorConnected, view]);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/providers`).then((response) => response.ok ? response.json() : []).then((items: Provider[]) => {
      setProviders(items);
      setProviderId(items.find((item) => item.is_default)?.id ?? items[0]?.id ?? "");
    }).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    if (!modelLoading) return;
    const timeout = window.setTimeout(() => {
      setModelLoading(false);
      setModelLoadError("محرك 3D لم يستجب في الوقت المتوقع. تحقق من تشغيله ثم أعد المحاولة.");
    }, 90_000);
    return () => window.clearTimeout(timeout);
  }, [modelLoading, aedifexProject]);

  async function openInAedifex() {
    if (opening3d) return;
    const planSignature = JSON.stringify(plan);
    if (aedifexProject && aedifexPlanSignature === planSignature) {
      setModelLoadError("");
      setView("model");
      return;
    }
    setOpening3d(true);
    setError("");
    setModelLoadError("");
    try {
      if (!plan.walls.length) {
        throw new Error("لا توجد حوائط صالحة لنقلها إلى النموذج ثلاثي الأبعاد.");
      }
      const roomIssues = roomLayoutIssues(plan.rooms ?? []);
      if (roomIssues.length > 0) throw new Error(roomIssues.join(" "));
      const walls = plan.rooms?.length
        ? deriveWallsFromRooms(plan.rooms, plan.walls, plan.units)
        : plan.walls;
      if (walls.length === 0) throw new Error("لم ينتج عن الغرف أي جدران صالحة.");
      const unitScale = plan.units === "cm" ? 0.01 : 1;
      const modelWalls = walls.map((wall) => ({
        ...wall,
        x1: wall.x1 * unitScale, y1: wall.y1 * unitScale,
        x2: wall.x2 * unitScale, y2: wall.y2 * unitScale,
        height: safeNumber(wall.height, 2.8 / unitScale) * unitScale,
        thickness: safeNumber(wall.thickness, 0.18 / unitScale) * unitScale,
      }));
      const siteId = "site_ai_taskflow";
      const buildingId = "building_ai_taskflow";
      const levelId = "level_ai_taskflow";
      const wallIds = modelWalls.map((_, index) => `wall_ai_${index}`);
      const roomIds = (plan.rooms ?? []).map((_, index) => `zone_ai_${index}`);
      const xs = modelWalls.flatMap((wall) => [wall.x1, wall.x2]);
      const ys = modelWalls.flatMap((wall) => [wall.y1, wall.y2]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const margin = 4;
      const nodes: Record<string, unknown> = {
        [siteId]: {
          object: "node", id: siteId, type: "site", name: plan.title || "AI TaskFlow Site",
          parentId: null, children: [buildingId], visible: true, metadata: {},
          polygon: { type: "polygon", points: [[minX - margin, minY - margin], [maxX + margin, minY - margin], [maxX + margin, maxY + margin], [minX - margin, maxY + margin]] },
        },
        [buildingId]: {
          object: "node", id: buildingId, type: "building", name: plan.title || "AI TaskFlow Building",
          parentId: siteId, children: [levelId], visible: true, metadata: {}, position: [0, 0, 0], rotation: [0, 0, 0],
          groundLevelId: levelId,
        },
        [levelId]: {
          object: "node", id: levelId, type: "level", name: plan.title || "AI TaskFlow Level",
          parentId: buildingId, children: [...wallIds, ...roomIds], visible: true, metadata: {}, level: 0, height: 3, baseElevation: 0,
        },
      };
      const wallChildren: string[][] = modelWalls.map(() => []);
      const doors = plan.doors ?? [];
      const windows = plan.windows ?? [];
      const placedOpenings = placeOpeningsOnWalls([
        ...doors.map((opening) => ({ ...opening, width: opening.width ?? 0.9 / unitScale })),
        ...windows.map((opening) => ({ ...opening, width: opening.width ?? 1.5 / unitScale })),
      ], walls, plan.units);
      const placeOpenings = (placed: typeof placedOpenings, kind: "door" | "window") => {
        placed.forEach((opening, index) => {
          const id = `${kind}_ai_${index}`;
          wallChildren[opening.wallIndex].push(id);
          const width = opening.width * unitScale;
          nodes[id] = {
            object: "node", id, type: kind,
            name: kind === "door" ? `Door ${index + 1}` : `Window ${index + 1}`,
            parentId: wallIds[opening.wallIndex], wallId: wallIds[opening.wallIndex],
            children: [], visible: true, metadata: {},
            position: [opening.offset * unitScale, kind === "door" ? 1.05 : 1.5, 0],
            rotation: [0, 0, 0],
            width, height: kind === "door" ? 2.1 : 1.2,
            side: "front", verticalAnchor: "floor",
            ...(kind === "door" ? {
              doorType: "hinged", doorCategory: "interior", swingDirection: "inward", handle: true,
              threshold: true, leafCount: 1, openingKind: "door", openingShape: "rectangle",
            } : { sill: true, openingKind: "window", openingShape: "rectangle" }),
          };
        });
      };
      placeOpenings(placedOpenings.slice(0, doors.length), "door");
      placeOpenings(placedOpenings.slice(doors.length), "window");
      modelWalls.forEach((wall, index) => {
        nodes[wallIds[index]] = {
          object: "node", id: wallIds[index], type: "wall",
          name: `Wall ${index + 1}`, parentId: levelId, children: wallChildren[index], visible: true, metadata: {},
          wallType: "standard", cap: true,
          start: [wall.x1, wall.y1], end: [wall.x2, wall.y2],
          height: Math.max(0.5, wall.height ?? 2.8),
          thickness: Math.max(0.12, wall.thickness ?? 0.18),
          frontSide: "unknown", backSide: "unknown",
        };
      });
      (plan.rooms ?? []).forEach((room, index) => {
        nodes[roomIds[index]] = {
          object: "node", id: roomIds[index], type: "zone", name: room.name || `غرفة ${index + 1}`,
          parentId: levelId, children: [], visible: true, metadata: { roomName: room.name || `غرفة ${index + 1}`, source: "AI TaskFlow 2D" },
          polygon: (room.polygon?.length
            ? room.polygon
            : [[room.x, room.y], [room.x + room.width, room.y], [room.x + room.width, room.y + room.height], [room.x, room.y + room.height]])
            .map(([x, y]) => [x * unitScale, y * unitScale]),
        };
      });
      const response = await apiFetch(`${API_BASE}/api/aedifex/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: plan.title || "AI TaskFlow 3D Plan",
          graph: { nodes, rootNodeIds: [siteId], collections: {}, materials: {}, installedPlugins: [] },
        }),
      });
      if (!response.ok) {
        let detail = await response.text();
        try { const parsed = JSON.parse(detail) as { detail?: string }; detail = parsed.detail ?? detail; } catch { /* keep the plain text response */ }
        throw new Error(`تعذر إنشاء مشروع AI TaskFlow 3D (${response.status}): ${detail}`);
      }
      const scene = await response.json() as { id?: string };
      if (!scene.id) throw new Error("لم يرجع محرك AI TaskFlow 3D معرّف المشروع");
      setAedifexPlanSignature(planSignature);
      setModelLoading(true);
      setAedifexProject(serviceUrl(3002, `/project/${scene.id}`));
      setView("model");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر ربط المخطط بـ Aedifex");
    } finally {
      setOpening3d(false);
    }
  }

  async function generate() {
    if (!providerId || generating) return;
    setGenerating(true); setError(""); setRawReply(""); setProgress("يرسل طلبًا للنموذج");
    setReplyTab("result");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    try {
      const systemPrompt = `You are a strict architectural CAD generator and image-to-plan extractor. Output one complete W2M/2 PLAN program only, with no prose or Markdown:
W2M/2 PLAN
TITLE "Plan name"
UNITS m
WALL x1 y1 x2 y2 height thickness
ROOM "room name" x y width height
DOOR x y width rotation
WINDOW x y width rotation
END PLAN
END W2M
Write one record per line, numeric values only, no commas or units suffixes. Analyze every supplied image: preserve its outline, room count, room positions, doors, and windows where possible. Coordinates are meters, x grows right and y grows down, wall thickness is at least 0.12m, and wall height is 2.8m. The rooms are the authoritative space plan: make their axis-aligned rectangles tile one complete rectangular building footprint with at least 97% area coverage and no more than 0.5% overlap. Use a simple row-and-column partition: each row spans the same exact building width, row heights meet exactly, and rooms within each row meet at identical x coordinates; each room must occur exactly once, and no room may overlap, contain, or duplicate another. The sum of room areas must fit inside the footprint; proportionally reduce room dimensions if necessary. Include clearly named halls/corridors for circulation and any otherwise unassigned floor area; never leave large empty leftover spaces. Shared room edges must have exactly matching coordinates. Design a believable circulation plan: place exactly one exterior entrance into a living room or named hall/corridor, never directly into a bathroom/toilet/service room. Every room, including every bathroom, must have an interior door connected to a neighboring room or corridor; avoid bathroom-to-bathroom paths and prefer doors between bathrooms and a hall/corridor. Ensure the doors form a connected route from the entrance through the habitable rooms. Return each shared or outer boundary as one wall segment, with no duplicate/overlapping walls; place every door/window on a wall centerline and within that wall's endpoints. Keep requested room count; do not invent rooms unless needed to label circulation. When a response hits a token limit, continue the same program from its exact final character; never repeat earlier records.`;
      const initialRequest = `${visiblePrompt}\n\nProduce the complete room layout and matching wall geometry in meters. Every part of the building footprint must belong to a named room or hall; do not create isolated room boxes inside an unlabeled larger enclosure.`;
      const requestPlan = async (message: string) => {
        let reply = "";
        let finishReason = "length";
        let continuation = 0;
        const history: Array<{ role: string; content: string }> = [];

        while (finishReason === "length" && continuation < 12) {
          const isFirst = continuation === 0;
          const response = await apiFetch(`${API_BASE}/api/chat/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({
              provider_id: providerId,
              message: isFirst
                ? message
                : `Continue the W2M/2 PLAN program from the exact final character of the preceding assistant message. Do not repeat any record or header. Output only complete new lines that continue the program, and finish with END PLAN then END W2M. Recent source tail:\n${reply.slice(-8000)}`,
              images: isFirst && sourceImage ? [sourceImage] : [],
              system_prompt: systemPrompt,
              history,
              temperature: 0.05, max_tokens: 12000,
            }),
          });
          if (!response.ok) throw new Error(`فشل طلب الذكاء الاصطناعي (${response.status})`);
          const reader = response.body?.getReader();
          if (!reader) throw new Error("البث غير متاح");
          const decoder = new TextDecoder(); let buffer = "";
          let segment = "";
          finishReason = "";
          while (true) {
            const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            if (chunk.done) buffer += "\n\n";
            const parts = buffer.split("\n\n"); buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.split(/\r?\n/).find((item) => item.startsWith("data:")); if (!line) continue;
              const event = JSON.parse(line.slice(5).trim());
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "finish" && event.reason) finishReason = String(event.reason);
              if (event.type === "delta" && event.text) {
                segment += event.text;
                reply += event.text;
                setRawReply(reply);
                setProgress(`${continuation ? "يكمل التصميم" : "يتكوّن المخطط"}... ${reply.length} حرف`);
              }
            }
            if (chunk.done) break;
          }
          history.push({ role: "user", content: isFirst ? message : "Continue the W2M/2 PLAN source exactly from the preceding response without repeating its final record." });
          history.push({ role: "assistant", content: segment });
          continuation += 1;
        }
        return reply;
      };

      let reply = await requestPlan(initialRequest);
      let parsed: Plan = parseW2MPlan(reply);
      let issues = parsed.rooms?.length ? roomLayoutIssues(parsed.rooms) : ["يجب تسمية الغرف والممرات حتى يمكن التحقق من توزيع المساحة."]
      for (let repairAttempt = 1; issues.length > 0 && repairAttempt <= 2; repairAttempt += 1) {
        setProgress(`يصحح توزيع الغرف تلقائيًا (المحاولة ${repairAttempt} من 2)...`);
        const repairRequest = [
          "Repair this architectural plan from scratch; do not reuse invalid room positions. Preserve each requested room name and keep the same number of rooms. Use the building dimensions and area given below. If the proposed room areas exceed the building area, scale the room widths/heights proportionally until their total area fits. Then place each room exactly once in a rectangular grid: tile the entire footprint row by row, with each row spanning the full width and the row heights summing exactly to the building height. In each row, room widths must sum exactly to the building width. Make all shared coordinates identical. No gaps, overlaps, nested rooms, duplicate rooms, or duplicate areas. Regenerate wall segments on the exact room boundaries and keep every opening on a wall.",
          roomLayoutRepairContext(parsed),
          `Validation errors: ${issues.join(" ")}`,
          `Plan to repair: ${JSON.stringify(parsed)}`,
          "Before returning, calculate every rectangle intersection and total area. Return the entire corrected W2M/2 PLAN program only, not a patch or explanation.",
        ].join("\n\n");
        reply = await requestPlan(repairRequest);
        parsed = parseW2MPlan(reply);
        issues = parsed.rooms?.length ? roomLayoutIssues(parsed.rooms) : ["يجب تسمية الغرف والممرات."]
      }
      let geometryAdjusted = false;
      if (issues.length > 0) {
        const walls = parsed.walls;
        const xs = walls.flatMap((wall) => [wall.x1, wall.x2]);
        const ys = walls.flatMap((wall) => [wall.y1, wall.y2]);
        const rooms = parsed.rooms ?? [];
        const repairedRooms = sourceImage ? null : tileRoomsIntoFootprint(rooms, {
          x: Math.min(...xs), y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        });
        if (!repairedRooms) {
          throw new Error(`لم أستطع اعتماد المخطط بعد محاولتي إصلاح بسبب فراغات أو تداخلات هندسية: ${issues.join(" ")}`);
        }
        parsed = { ...parsed, rooms: repairedRooms };
        issues = roomLayoutIssues(repairedRooms);
        geometryAdjusted = true;
      }
      const units = parsed.units ?? "m";
      const circulationDoors = buildCirculationDoors(parsed.rooms ?? [], units);
      const planWalls = parsed.rooms?.length
        ? deriveWallsFromRooms(parsed.rooms, parsed.walls, units)
        : parsed.walls;
      parsed = {
        ...parsed,
        units,
        doors: placeOpeningsOnWalls(circulationDoors, planWalls, units),
      };
      setPlan(parsed); setEditorSyncPlan(parsed); setView(engine2dEnabled ? "plan" : "model");
      setProgress(geometryAdjusted
        ? "أُعيد توزيع الغرف داخل حدود المبنى وضُبط مسار الدخول وأبواب الغرف؛ راجع المخطط قبل الاعتماد."
        : "اكتمل المخطط وضُبط المدخل الرئيسي وأبواب الغرف ومسارات الحركة.");
      try {
        const finalSource = formatW2MPlan({
          title: parsed.title ?? "مخطط معماري",
          units,
          walls: planWalls.map((wall) => ({
            ...wall,
            height: wall.height ?? 2.8,
            thickness: wall.thickness ?? 0.18,
          })),
          rooms: parsed.rooms ?? [],
          doors: (parsed.doors ?? []).map((door) => ({ ...door, width: door.width ?? 0.9, rotation: door.rotation ?? 0 })),
          windows: (parsed.windows ?? []).map((window) => ({ ...window, width: window.width ?? 1.2, rotation: window.rotation ?? 0 })),
        });
        parseW2MPlan(finalSource);
        const safeName = sanitizeArtifactFilename(parsed.title ?? "architectural-plan", "architectural-plan");
        const delivery = await deliverArtifactToTelegram("architecture", `${safeName}.w2m`, finalSource, "text/plain;charset=utf-8");
        if (delivery.available) setProgress((current) => `${current}${delivery.delivered
          ? " تم إرسال ملف W2M إلى بوت تيليجرام."
          : ` ${delivery.reason ?? "لم يُرسل الملف إلى تيليجرام."}`}`);
      } catch (reason) {
        setError(`اكتمل المخطط لكن تعذر إرسال الملف إلى تيليجرام: ${reason instanceof Error ? reason.message : "خطأ غير معروف."}`);
      }
    } catch (reason) {
      setProgress("");
      setError(reason instanceof DOMException && reason.name === "AbortError"
        ? "انتهت مهلة التوليد المحددة بثلاث ساعات. يمكنك الاستمرار برسم المخطط يدويًا أو تجربة مزوّد أسرع."
        : reason instanceof Error ? reason.message : "تعذّر إنشاء المخطط");
    }
    finally { window.clearTimeout(timeout); setGenerating(false); }
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("ارفع صورة فقط"); return; }
    if (file.size > 6_000_000) { setError("حجم الصورة أكبر من الحد المسموح 6 ميجابايت"); return; }
    const reader = new FileReader(); reader.onload = () => setSourceImage(String(reader.result ?? "")); reader.readAsDataURL(file);
  }

  return <section className="architectural-studio" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="architectural-heading"><div className="architectural-mark"><Building2 size={20}/></div><div><span>{translate("مخطط هندسي بالذكاء الاصطناعي", language)}</span><h2>{translate("OpenCalque · محرر المخططات 2D", language)}</h2><p>{translate("محرر معماري مفتوح المصدر للرسم الدقيق؛ يدعم التعديل اليدوي، الأبواب، النوافذ، الأبعاد والتصدير.", language)}</p></div></header>
    <div className="architectural-controls">
      <label className="architectural-prompt"><span>{translate("الوصف أو الأبعاد", language)}</span><textarea value={visiblePrompt} onChange={(event) => { setPrompt(event.target.value); setPromptEdited(true); }} rows={4}/></label>
      <label className="architectural-upload"><ImageUp size={18}/><span>{sourceImage ? translate("تم اختيار صورة مرجعية", language) : translate("ارفع مخططًا أو مساحة مصورة", language)}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadImage(event.target.files?.[0])}/></label>
      {sourceImage && <img className="architectural-source" src={sourceImage} alt={translate("مرجع المخطط", language)}/>}
      <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={generating}><option value="">{translate("اختر مزود AI", language)}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</select>
      <button className="architectural-generate" type="button" disabled={!providerId || generating || !visiblePrompt.trim()} onClick={() => void generate()}>{generating ? <LoaderCircle className="architectural-spin"/> : <WandSparkles/>}{generating ? translate("يولّد المخطط", language) : translate("إنشاء المخطط", language)}</button>
    </div>
    {(generating || progress) && <div className="architectural-progress"><Sparkles size={15}/>{translate(progress, language)}</div>}
    {error && <div className="architectural-error">{translate(error, language)}</div>}
    <div className="architectural-viewbar"><div>{engine2dEnabled && <><button type="button" className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}>{translate("المخطط 2D · OpenCalque", language)}</button><a href={`${serviceUrl(5174)}/?external=1&parentOrigin=${encodeURIComponent(window.location.origin)}`} target="_blank" rel="opener"><Eye/>{translate("فتح 2D في صفحة جديدة", language)}</a></>}{engine3dEnabled && <button type="button" className={view === "model" ? "active" : ""} onClick={() => void openInAedifex()} disabled={opening3d}><Eye/>{translate("عرض AI TaskFlow 3D", language)}</button>}</div>{engine3dEnabled && <div><button type="button" onClick={() => void openInAedifex()} disabled={opening3d}>{opening3d ? <LoaderCircle className="architectural-spin"/> : <Rotate3D/>}{opening3d ? translate("يجهز المشروع", language) : translate("تحويل وتعديل بـ AI TaskFlow 3D", language)}</button></div>}</div>
    <div className="architectural-workspace">
      {view === "model" && !aedifexProject && <div className="architectural-model architectural-empty"><Building2/><span>{translate("اضغط «تحويل وتعديل بـ AI TaskFlow 3D» لإنشاء النموذج ثلاثي الأبعاد.", language)}</span></div>}
      {engine2dEnabled && <iframe
        ref={editorRef}
        className="architectural-plan-frame"
        src={`${serviceUrl(5174)}/?embedded=1&parentOrigin=${encodeURIComponent(window.location.origin)}`}
        title="OpenCalque 2D architectural editor"
        onLoad={(event) => event.currentTarget.contentWindow?.postMessage({
          channel: "ai-taskflow:opencalque", type: "hello",
        }, serviceUrl(5174))}
        onError={() => setError("تعذر تحميل OpenCalque. تأكد من تشغيل خدمة المحرر على المنفذ 5174.")}
        style={{ display: view === "plan" ? "block" : "none" }}
      />}
      {engine2dEnabled && view === "plan" && !editorConnected && <div className="architectural-model-status" role="status"><LoaderCircle className="architectural-spin"/> {translate("جارٍ الاتصال بمحرر OpenCalque المحلي...", language)}</div>}
      {aedifexProject && <iframe
        className="architectural-model architectural-model-frame"
        src={aedifexProject}
        title="AI TaskFlow 3D"
        allow="fullscreen; xr-spatial-tracking"
        onLoad={() => { setModelLoading(false); setModelLoadError(""); }}
        onError={() => { setModelLoading(false); setModelLoadError("تعذر تحميل محرك AI TaskFlow 3D."); }}
        style={{ display: view === "model" ? "block" : "none", position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3 }}
      />}
      {view === "model" && modelLoading && <div className="architectural-model-status" role="status"><LoaderCircle className="architectural-spin"/> {translate("جارٍ تحميل المحرك ثلاثي الأبعاد لأول مرة...", language)}</div>}
      {view === "model" && modelLoadError && <div className="architectural-model-status architectural-error" role="alert">{translate(modelLoadError, language)}</div>}
      {rawReply && <section className="architectural-debug architectural-reply">
        <div role="tablist">
          <button type="button" role="tab" aria-selected={replyTab === "result"} onClick={() => setReplyTab("result")}>{translate("النتيجة", language)}</button>
          <button type="button" role="tab" aria-selected={replyTab === "program"} onClick={() => setReplyTab("program")}>{translate("برنامج W2M/2", language)}</button>
        </div>
        {replyTab === "program"
          ? <pre role="tabpanel">{rawReply}</pre>
          : <p role="tabpanel">{translate("تم التحقق من توزيع الغرف ومسارات الحركة وتحديث المحرر.", language)}</p>}
      </section>}
    </div>
  </section>;
}
