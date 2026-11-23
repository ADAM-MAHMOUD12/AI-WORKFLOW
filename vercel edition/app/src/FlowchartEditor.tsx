
import { useCallback, useEffect, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { API_BASE, apiFetch, deliverArtifactToTelegram } from "./api";
import { BrainCircuit, Check, GitBranch, LoaderCircle, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./FlowchartEditor.css";
import { FLOW_SHAPES, type FlowShape, shapeLabels } from "./flowchartTypes";
import DocumentAttachments, { documentsAsContext, type TextDocument } from "./DocumentAttachments";
import { useLanguage, translate } from "./localization";
import { parseW2MFlowchart } from "./w2mFormats";

type FlowData = { label: string; shape: FlowShape };
type FlowNode = Node<FlowData>;

type FlowSnapshot = {
  nodes: FlowNode[];
  edges: Edge[];
};

type FlowLayout = "vertical" | "horizontal" | "grid" | "radial";

const STORAGE_KEY = "taskflow-flowchart-v1";
const BASELINE_KEY = "taskflow-flowchart-baseline-v1";

const initialNodes: FlowNode[] = [];
const initialEdges: Edge[] = [];

function layoutFlowNodes(nodes: FlowNode[], edges: Edge[], layout: FlowLayout): FlowNode[] {
  if (nodes.length < 2) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const indegrees = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegrees.set(edge.target, (indegrees.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => indegrees.get(node.id) === 0).map((node) => node.id);
  const visited = new Set<string>();
  while (queue.length) {
    const source = queue.shift()!;
    visited.add(source);
    for (const target of outgoing.get(source) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(source) ?? 0) + 1));
      indegrees.set(target, (indegrees.get(target) ?? 1) - 1);
      if (indegrees.get(target) === 0) queue.push(target);
    }
  }

  const maxRank = Math.max(0, ...ranks.values());
  for (const node of nodes) {
    if (!visited.has(node.id)) ranks.set(node.id, maxRank + 1);
  }
  const layers = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    layers.set(rank, [...(layers.get(rank) ?? []), node]);
  }

  if (layout === "radial") {
    const radius = Math.max(190, nodes.length * 38);
    return nodes.map((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / nodes.length;
      return { ...node, position: { x: 420 + Math.cos(angle) * radius, y: 330 + Math.sin(angle) * radius } };
    });
  }
  if (layout === "grid") {
    const columns = Math.ceil(Math.sqrt(nodes.length));
    return nodes.map((node, index) => ({
      ...node,
      position: { x: 80 + (index % columns) * 260, y: 60 + Math.floor(index / columns) * 170 },
    }));
  }

  return nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 0;
    const layer = layers.get(rank) ?? [node];
    const index = layer.findIndex((item) => item.id === node.id);
    return {
      ...node,
      position: layout === "vertical"
        ? { x: 100 + index * 250, y: 70 + rank * 190 }
        : { x: 80 + rank * 290, y: 60 + index * 175 },
    };
  });
}

function FlowShapeNode({ data, selected }: NodeProps<FlowNode>) {
  const shape = data.shape ?? "process";
  return (
    <div className={`flow-shape flow-shape-${shape}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} id="target-top" />
      <Handle type="target" position={Position.Left} id="target-left" />
      <div className="flow-shape-surface"><span>{data.label}</span></div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </div>
  );
}

const nodeTypes = { flowShape: FlowShapeNode };

function flowchartMermaid(nodes: FlowNode[], edges: Edge[]) {
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    const label = ["\"", "[", "]", "{", "}", "(", ")"].reduce((text, character) => text.replaceAll(character, ""), node.data.label);
    const syntax = node.data.shape === "decision" ? `{${label}}`
      : node.data.shape === "terminator" ? `([${label}])`
        : node.data.shape === "data" ? `[/${label}/]`
          : node.data.shape === "predefinedProcess" ? `[[${label}]]`
            : node.data.shape === "database" || node.data.shape === "storage" ? `[( ${label} )]`
            : node.data.shape === "connector" ? `((${label}))`
                : node.data.shape === "or" ? `((( ${label} )))`
                  : node.data.shape === "offPageConnector" ? `>${label}]`
              : `[${label}]`;
    lines.push(`  ${node.id.replace(/[^a-zA-Z0-9_]/g, "_")}${syntax}`);
  }
  for (const edge of edges) {
    const label = typeof edge.label === "string" && edge.label ? `|${edge.label.replaceAll("|", "").replaceAll("[", "").replaceAll("]", "")}|` : "";
    lines.push(`  ${edge.source.replace(/[^a-zA-Z0-9_]/g, "_")} -->${label} ${edge.target.replace(/[^a-zA-Z0-9_]/g, "_")}`);
  }
  return lines.join("\n");
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character] ?? character);
}

function flowchartSvg(nodes: FlowNode[], edges: Edge[]) {
  const padding = 70;
  const minX = Math.min(0, ...nodes.map((node) => node.position.x));
  const minY = Math.min(0, ...nodes.map((node) => node.position.y));
  const width = Math.max(900, ...nodes.map((node) => node.position.x + 200)) - minX + padding * 2;
  const height = Math.max(500, ...nodes.map((node) => node.position.y + 100)) - minY + padding * 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edgeMarkup = edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return "";
    const x1 = source.position.x - minX + padding + 90;
    const y1 = source.position.y - minY + padding + 55;
    const x2 = target.position.x - minX + padding + 90;
    const y2 = target.position.y - minY + padding + 55;
    return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)"/>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const x = node.position.x - minX + padding;
    const y = node.position.y - minY + padding;
    const label = escapeXml(node.data.label);
    const shape = node.data.shape;
    const body = shape === "decision" ? `<polygon points="90,0 180,50 90,100 0,50"/>`
      : shape === "terminator" ? `<rect x="0" y="16" width="180" height="68" rx="34"/>`
        : shape === "data" ? `<polygon points="24,0 180,0 156,100 0,100"/>`
          : shape === "connector" ? `<circle cx="90" cy="50" r="46"/>`
            : shape === "or" ? `<circle cx="90" cy="50" r="48"/>`
              : shape === "offPageConnector" ? `<path d="M0 0 H180 V65 L90 100 L0 65 Z"/>`
                : shape === "merge" ? `<path d="M0 0 H180 L90 100 Z"/>`
                  : shape === "extract" ? `<path d="M90 0 L180 100 H0 Z"/>`
                    : shape === "delay" ? `<path d="M0 0 H130 A50 50 0 0 1 130 100 H0 Z"/>`
                      : shape === "display" ? `<path d="M0 0 H130 L180 50 L130 100 H0 L25 50 Z"/>`
                        : shape === "manualInput" ? `<path d="M0 24 L180 0 V100 H0 Z"/>`
                          : shape === "manualOperation" ? `<path d="M0 0 H180 L155 100 H25 Z"/>`
                            : shape === "predefinedProcess" ? `<rect width="180" height="100"/><path d="M22 0 V100 M158 0 V100"/>`
                              : shape === "internalStorage" ? `<rect width="180" height="100"/><path d="M22 0 V100 M0 22 H180"/>`
            : shape === "database" ? `<path d="M0 16 C0 -6 180 -6 180 16 L180 84 C180 106 0 106 0 84 Z M0 16 C0 38 180 38 180 16 M0 84 C0 62 180 62 180 84"/>`
              : shape === "storage" ? `<path d="M0 16 Q90 -4 180 16 V84 Q90 104 0 84 Z M0 16 Q90 36 180 16"/>`
              : shape === "preparation" ? `<polygon points="24,0 156,0 180,50 156,100 24,100 0,50"/>`
                : shape === "multipleDocuments" ? `<path d="M18 0 H162 V74 Q125 108 90 82 Q55 56 18 82 Z M8 8 V82 Q42 60 75 82 M0 16 V90 Q35 68 70 90"/>`
                  : shape === "document" ? `<path d="M0 0 H180 V78 Q135 112 90 84 Q45 56 0 90 Z"/>`
                  : `<rect x="0" y="0" width="180" height="100" rx="8"/>`;
    return `<g transform="translate(${x} ${y})" fill="#182c34" stroke="#4cc9a5" stroke-width="2">${body}<text x="90" y="55" fill="#f1f5f9" stroke="none" text-anchor="middle" font-family="sans-serif" font-size="14">${label}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><rect width="100%" height="100%" fill="#0e171c"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

function downloadFile(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readSnapshot(key: string): FlowSnapshot | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const stored = JSON.parse(value) as FlowSnapshot;
    return {
      ...stored,
      nodes: stored.nodes.map((node) => ({
        ...node,
        type: "flowShape",
        data: {
          ...node.data,
          shape: node.data.shape ?? (node.type === "input" || node.type === "output" ? "terminator" : "process"),
        },
      })),
    };
  } catch {
    return null;
  }
}

function snapshot(nodes: FlowNode[], edges: Edge[]): FlowSnapshot {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      selected: false,
      dragging: false,
    })),
    edges: edges.map((edge) => ({ ...edge, selected: false })),
  };
}

function compareSnapshots(before: FlowSnapshot, after: FlowSnapshot) {
  const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const oldEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const newEdges = new Map(after.edges.map((edge) => [edge.id, edge]));

  const addedNodes = after.nodes.filter((node) => !oldNodes.has(node.id));
  const deletedNodes = before.nodes.filter((node) => !newNodes.has(node.id));

  const renamedNodes = after.nodes.filter((node) => {
    const oldNode = oldNodes.get(node.id);
    return oldNode && oldNode.data.label !== node.data.label;
  });

  const addedEdges = after.edges.filter((edge) => !oldEdges.has(edge.id));
  const deletedEdges = before.edges.filter((edge) => !newEdges.has(edge.id));

  return {
    addedNodes,
    deletedNodes,
    renamedNodes,
    addedEdges,
    deletedEdges,
  };
}

export default function FlowchartEditor() {
  const language = useLanguage();
  const [saved] = useState(() => {
    const snapshot = readSnapshot(STORAGE_KEY);
    const testNodeIds = ["start", "platform_selection", "design", "add_products", "payment_shipping", "testing", "pre_launch_marketing", "launch", "monitor_optimize"];
    if (snapshot?.nodes.length === testNodeIds.length && testNodeIds.every((id) => snapshot.nodes.some((node) => node.id === id))) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BASELINE_KEY);
      return null;
    }
    if (snapshot?.nodes.length && snapshot.nodes.every((node) => /^مرحلة جديدة \d+$/.test(node.data.label)) && snapshot.edges.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return snapshot;
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    saved?.nodes ?? initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    saved?.edges ?? initialEdges,
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiDocuments, setAiDocuments] = useState<TextDocument[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRawReply, setAiRawReply] = useState("");
  const [aiReplyTab, setAiReplyTab] = useState<"program" | "result">("result");
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<ReturnType<
    typeof compareSnapshots
  > | null>(null);
  const [newShape, setNewShape] = useState<FlowShape>("process");
  const [layout, setLayout] = useState<FlowLayout>("vertical");

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(snapshot(nodes, edges)),
      );
    } catch (error) {
      console.error("تعذر حفظ مخطط التدفق:", error);
    }
  }, [nodes, edges]);

   useEffect(() => {
     function applyGeneratedFlowchart(event: Event) {
       const detail = (event as CustomEvent<FlowSnapshot>).detail;
       if (!detail || !Array.isArray(detail.nodes) || !Array.isArray(detail.edges)) return;
       setNodes(detail.nodes);
       setEdges(detail.edges);
       setSelectedNodeId(null);
       setComparison(null);
       setMessage("تم تطبيق المخطط الذي أنشأه AI.");
     }

     window.addEventListener("taskflow:apply-flowchart", applyGeneratedFlowchart);
     return () => window.removeEventListener("taskflow:apply-flowchart", applyGeneratedFlowchart);
   }, [setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          { ...connection, animated: true },
          current,
        ),
      );
      setComparison(null);
      setMessage("تم إنشاء اتصال جديد.");
    },
    [setEdges],
  );

  function addNode() {
    const id = `node-${Date.now()}`;
    const newNode: FlowNode = {
      id,
      position: {
        x: 100 + Math.round(Math.random() * 100),
        y: 100 + nodes.length * 70,
      },
      data: { label: `مرحلة جديدة ${nodes.length + 1}`, shape: newShape },
      type: "flowShape",
    };

    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
    setComparison(null);
    setMessage("أُضيفت مرحلة جديدة.");
  }

  function renameSelectedNode() {
    if (!selectedNodeId || !nodeName.trim()) return;

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, label: nodeName.trim() } }
          : node,
      ),
    );

    setComparison(null);
    setMessage("تم تعديل اسم المرحلة.");
  }

  function changeSelectedShape(shape: FlowShape) {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => node.id === selectedNodeId
      ? { ...node, type: "flowShape", data: { ...node.data, shape } }
      : node));
    setComparison(null);
  }

  function applyLayout() {
    setNodes((current) => layoutFlowNodes(current, edges, layout));
    setComparison(null);
    setMessage(`تم ترتيب المخطط: ${{ vertical: "طبقي رأسي", horizontal: "طبقي أفقي", grid: "شبكي", radial: "دائري" }[layout]}.`);
  }

  async function askFlowchartAI(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!aiInstruction.trim() && !aiDocuments.length) || aiBusy) return;
    const requestInstruction = aiInstruction.trim() || "حدّث المخطط اعتمادًا على المستند المرفق.";
    const documentContext = documentsAsContext(aiDocuments);
    setAiBusy(true);
    setMessage("");
    setAiRawReply("");
    setAiReplyTab("result");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const providersResponse = await apiFetch(`${API_BASE}/api/providers`, { signal: controller.signal });
      if (!providersResponse.ok) throw new Error("تعذّر تحميل مزوّدي AI.");
      const providers = await providersResponse.json() as Array<{ id: string; is_default: boolean }>;
      const provider = providers.find((item) => item.is_default) ?? providers[0];
      if (!provider) throw new Error("أضف مزوّد AI أولًا لاستخدام مساعد المخططات.");

      const selection = selectedNodeId
        ? `العنصر المحدد عقدة: ${nodes.find((node) => node.id === selectedNodeId)?.data.label ?? selectedNodeId} (id=${selectedNodeId}).`
        : selectedEdgeId
          ? `العنصر المحدد وصلة: ${selectedEdgeId}.`
          : "لا يوجد عنصر محدد؛ نفّذ التعديل على المخطط كله حسب الطلب.";
      const currentFlow = {
        nodes: nodes.map((node) => ({ id: node.id, label: node.data.label, shape: node.data.shape, position: node.position })),
        edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: typeof edge.label === "string" ? edge.label : "" })),
      };
      const response = await apiFetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          message: `طلب التعديل: ${requestInstruction}${documentContext}\n${selection}\nالمخطط الحالي JSON:\n${JSON.stringify(currentFlow)}`,
          system_prompt: `أنت مصمم ومحرر مخططات تدفق. طبّق طلب المستخدم مع الحفاظ على العناصر غير المستهدفة. أخرج برنامج W2M/2 FLOWCHART كاملًا فقط، سطرًا واحدًا لكل سجل وبلا JSON:
W2M/2 FLOWCHART
NODE node-id SHAPE process AT 100 100 LABEL "اسم المرحلة"
EDGE edge-id FROM node-id TO next-id LABEL "اختياري"
END FLOWCHART
END W2M
استخدم NODE لكل عقدة وEDGE لكل وصلة. أشكال NODE المسموحة: ${FLOW_SHAPES.join(", ")}. معرّف كل عقدة ووصلة فريد، ويجب أن تشير كل وصلة إلى عقد موجودة. ضع مواضع x,y من شبكة متسقة. اقتبس التسميات كنص JSON حتى تقبل العربية والرموز. لا تضف شرحًا.`,
          temperature: 0.2,
          max_tokens: 3000,
        }),
        signal: controller.signal,
      });
      const result = await response.json() as { reply?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "تعذّر تعديل المخطط.");
      const raw = result.reply ?? "";
      setAiRawReply(raw);
      const updated = parseW2MFlowchart(raw, FLOW_SHAPES);
      const nextNodes: FlowNode[] = updated.nodes.map((node, index) => {
        const old = nodes.find((item) => item.id === node.id);
        return {
          id: node.id,
          position: {
            x: Number.isFinite(node.x) ? node.x : old?.position.x ?? 100 + (index % 3) * 240,
            y: Number.isFinite(node.y) ? node.y : old?.position.y ?? 80 + Math.floor(index / 3) * 140,
          },
          data: { label: node.label, shape: node.shape as FlowShape },
          type: "flowShape",
        };
      });
      const nextEdges: Edge[] = updated.edges.map((edge, index) => ({
        id: edge.id || `ai-edge-${Date.now()}-${index}`,
        source: edge.source,
        target: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
        animated: true,
      }));
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setComparison(null);
      setAiInstruction("");
      setAiDocuments([]);
      setMessage("تم تحديث المخطط بواسطة AI.");
      try {
        const svg = flowchartSvg(nextNodes, nextEdges);
        const delivery = await deliverArtifactToTelegram("flowchart", "taskflow-flowchart.svg", svg, "image/svg+xml");
        if (delivery.available) setMessage((current) => `${current}${delivery.delivered
          ? " تم إرسال ملف SVG إلى بوت تيليجرام."
          : ` ${delivery.reason ?? "لم يُرسل الملف إلى تيليجرام."}`}`);
      } catch (reason) {
        setMessage(`تم تحديث المخطط لكن تعذر إرسال الملف إلى تيليجرام: ${reason instanceof Error ? reason.message : "خطأ غير معروف."}`);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setMessage("انتهت مهلة الذكاء الاصطناعي. قلّل حجم المخطط أو أعد المحاولة.");
      } else {
        setMessage(reason instanceof Error ? reason.message : "تعذّر تعديل المخطط بالذكاء الاصطناعي.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setAiBusy(false);
    }
  }

  function exportFlowchart(format: "json" | "mermaid" | "svg" | "png") {
    if (format === "json") {
      downloadFile("taskflow-flowchart.json", JSON.stringify(snapshot(nodes, edges), null, 2), "application/json");
    } else if (format === "mermaid") {
      downloadFile("taskflow-flowchart.mmd", flowchartMermaid(nodes, edges), "text/plain;charset=utf-8");
    } else if (format === "svg") {
      downloadFile("taskflow-flowchart.svg", flowchartSvg(nodes, edges), "image/svg+xml;charset=utf-8");
    } else {
      const source = flowchartSvg(nodes, edges);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) downloadFile("taskflow-flowchart.png", blob, "image/png");
          URL.revokeObjectURL(url);
        });
      };
      image.onerror = () => { URL.revokeObjectURL(url); setMessage("تعذر تصدير PNG. جرّب SVG."); };
      image.src = url;
    }
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;

    setNodes((current) =>
      current.filter((node) => node.id !== selectedNodeId),
    );
    setEdges((current) =>
      current.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );

    setSelectedNodeId(null);
    setNodeName("");
    setComparison(null);
    setMessage("تم حذف المرحلة واتصالاتها.");
  }

  function saveBaseline() {
    try {
      localStorage.setItem(
        BASELINE_KEY,
        JSON.stringify(snapshot(nodes, edges)),
      );
      setComparison(null);
      setMessage("تم حفظ النسخة المرجعية للمقارنة.");
    } catch {
      setMessage("تعذر حفظ النسخة المرجعية.");
    }
  }

  function compareWithBaseline() {
    const baseline = readSnapshot(BASELINE_KEY);

    if (!baseline) {
      setMessage("احفظ نسخة مرجعية أولًا، ثم عدّل المخطط وقارنه.");
      setComparison(null);
      return;
    }

    setComparison(compareSnapshots(baseline, snapshot(nodes, edges)));
    setMessage("اكتملت مقارنة المخطط بالنسخة المرجعية.");
  }

  function resetFlowchart() {
    if (
      !window.confirm(
        "هل تريد استعادة المخطط الأولي؟ سيتم استبدال المخطط الحالي.",
      )
    ) {
      return;
    }

    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNodeId(null);
    setNodeName("");
    setComparison(null);
    setMessage("تمت استعادة المخطط الأولي.");
  }

  return (
    <section className="flow-editor" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="flow-editor-toolbar">
        <div className="flow-editor-title">
          <span className="flow-editor-icon">
            <GitBranch size={20} />
          </span>
          <div>
            <h2>{translate("مخطط سير العمل", language)}</h2>
            <p>{translate("حرّك المراحل، اربطها، وعدّل خطتك.", language)}</p>
          </div>
        </div>

        <div className="flow-editor-actions">
          <label className="flow-shape-picker"><span>{translate("شكل المرحلة", language)}</span><select value={newShape} onChange={(event) => setNewShape(event.target.value as FlowShape)}>{FLOW_SHAPES.map((shape) => <option key={shape} value={shape}>{translate(shapeLabels[shape], language)}</option>)}</select></label>
          <label className="flow-shape-picker"><span>{translate("تخطيط المخطط", language)}</span><select aria-label={translate("تخطيط المخطط", language)} value={layout} onChange={(event) => setLayout(event.target.value as FlowLayout)}><option value="vertical">{translate("طبقي رأسي", language)}</option><option value="horizontal">{translate("طبقي أفقي", language)}</option><option value="grid">{translate("شبكي", language)}</option><option value="radial">{translate("دائري", language)}</option></select></label>
          <button className="flow-action" onClick={applyLayout} disabled={nodes.length < 2} title={translate("تطبيق طريقة الترتيب المختارة", language)}><GitBranch size={16} /> {translate("ترتيب", language)}</button>
          <button className="flow-action primary" onClick={addNode}>
            <Plus size={16} />
            {translate("إضافة مرحلة", language)}
          </button>
          <button className="flow-action" onClick={saveBaseline}>
            <Save size={16} />
            {translate("حفظ نسخة مرجعية", language)}
          </button>
          <button className="flow-action" onClick={compareWithBaseline}>
            <GitBranch size={16} />
            {translate("مقارنة التعديلات", language)}
          </button>
          <button
            className="flow-action"
            onClick={resetFlowchart}
            title={translate("استعادة المخطط الأولي", language)}
          >
            <RotateCcw size={16} />
          </button>
          <label className="flow-shape-picker"><span>{translate("تصدير", language)}</span><select defaultValue="" onChange={(event) => { if (event.target.value) exportFlowchart(event.target.value as "json" | "mermaid" | "svg" | "png"); event.target.value = ""; }}><option value="" disabled>{translate("اختر صيغة", language)}</option><option value="json">JSON</option><option value="mermaid">Mermaid</option><option value="svg">SVG</option><option value="png">PNG</option></select></label>
        </div>
      </div>

      <form className="flow-ai-panel" onSubmit={(event) => void askFlowchartAI(event)}>
        <div className="flow-ai-heading"><span><BrainCircuit size={17} /></span><div><strong>{translate("مساعد المخطط", language)}</strong><small>{selectedNode ? translate(`العنصر المحدد: ${selectedNode.data.label}`, language) : selectedEdgeId ? translate(`الوصلة المحددة: ${selectedEdgeId}`, language) : translate("سيطبّق الطلب على المخطط كله", language)}</small></div></div>
        <textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder={translate("مثال: أضف خطوة لمراجعة الطلب قبل الدفع، أو بسّط المرحلة المحددة...", language)} rows={2} />
        <DocumentAttachments documents={aiDocuments} onChange={setAiDocuments} disabled={aiBusy} />
        <button className="flow-action primary" type="submit" disabled={aiBusy || (!aiInstruction.trim() && !aiDocuments.length)}>{aiBusy ? <LoaderCircle className="flow-ai-spin" size={16} /> : <Sparkles size={16} />} {aiBusy ? translate("جارٍ التعديل...", language) : translate("عدّل المخطط بالذكاء الاصطناعي", language)}</button>
      </form>

      {aiRawReply && <section className="flow-ai-reply" aria-label={translate("نتيجة الذكاء الاصطناعي", language)}>
        <div role="tablist">
          <button type="button" role="tab" aria-selected={aiReplyTab === "result"} onClick={() => setAiReplyTab("result")}>{translate("النتيجة", language)}</button>
          <button type="button" role="tab" aria-selected={aiReplyTab === "program"} onClick={() => setAiReplyTab("program")}>{translate("برنامج W2M/2", language)}</button>
        </div>
        {aiReplyTab === "program"
          ? <pre role="tabpanel">{aiRawReply}</pre>
          : <p role="tabpanel">{translate(message || "اكتمل التحقق من المخطط وتحديث عناصره.", language)}</p>}
      </section>}

      {selectedNode && (
        <div className="flow-node-editor">
          <label htmlFor="flow-node-name">{translate("تعديل المرحلة المحددة", language)}</label>
          <input
            id="flow-node-name"
            value={nodeName}
            onChange={(event) => setNodeName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") renameSelectedNode();
            }}
            placeholder={translate("اسم المرحلة...", language)}
          />
          <label className="flow-shape-picker"><span>{translate("الشكل", language)}</span><select value={selectedNode.data.shape ?? "process"} onChange={(event) => changeSelectedShape(event.target.value as FlowShape)}>{FLOW_SHAPES.map((shape) => <option key={shape} value={shape}>{translate(shapeLabels[shape], language)}</option>)}</select></label>
          <button
            className="flow-action primary"
            onClick={renameSelectedNode}
          >
            <Check size={16} />
            {translate("حفظ الاسم", language)}
          </button>
          <button className="flow-action danger" onClick={deleteSelectedNode}>
            <Trash2 size={16} />
            {translate("حذف المرحلة", language)}
          </button>
        </div>
      )}

      <div className="flow-editor-hint">
        {nodes.length === 0
          ? translate("المخطط فارغ. اختر شكلًا ثم أضف أول مرحلة، أو أنشئ مخططًا من محادثة AI.", language)
          : translate("اسحب المراحل لتحريكها. اسحب من نقطة اتصال على عقدة إلى نقطة عقدة أخرى لإنشاء سهم بينها. اضغط على مرحلة لتعديل اسمها.", language)}
      </div>

      <div className="flow-editor-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
            setNodeName(node.data.label);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
            setNodeName("");
          }}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setNodeName("");
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={["Backspace", "Delete"]}
          onNodesDelete={(deleted) => {
            if (deleted.some((node) => node.id === selectedNodeId)) {
              setSelectedNodeId(null);
            }
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              node.type === "input"
                ? "#a78bfa"
                : node.type === "output"
                  ? "#34d399"
                  : "#64748b"
            }
          />
        </ReactFlow>
      </div>

      {message && (
        <p className="flow-editor-message" role="status">
          {translate(message, language)}
        </p>
      )}

      {comparison && (
        <div className="flow-comparison">
          <h3>{translate("نتيجة المقارنة", language)}</h3>
          <div className="flow-comparison-stats">
            <span>{translate("مراحل مضافة:", language)} {comparison.addedNodes.length}</span>
            <span>{translate("مراحل محذوفة:", language)} {comparison.deletedNodes.length}</span>
            <span>{translate("أسماء معدّلة:", language)} {comparison.renamedNodes.length}</span>
            <span>{translate("روابط مضافة:", language)} {comparison.addedEdges.length}</span>
            <span>{translate("روابط محذوفة:", language)} {comparison.deletedEdges.length}</span>
          </div>

          {comparison.addedNodes.map((node) => (
            <p key={node.id}>{translate("+ مرحلة مضافة:", language)} {node.data.label}</p>
          ))}
          {comparison.deletedNodes.map((node) => (
            <p key={node.id}>{translate("− مرحلة محذوفة:", language)} {node.data.label}</p>
          ))}
          {comparison.renamedNodes.map((node) => {
            const oldNode = readSnapshot(BASELINE_KEY)?.nodes.find(
              (item) => item.id === node.id,
            );
            return (
              <p key={node.id}>
                {translate("اسم معدّل:", language)} {oldNode?.data.label} ← {node.data.label}
              </p>
            );
          })}
        </div>
      )}

      <p className="flow-editor-footnote">
        <span className="status-dot" />
        {translate("يُحفظ المخطط تلقائيًا على هذا الجهاز. المقارنة تعتمد على النسخة\r\n        المرجعية التي تحفظها يدويًا.", language)}
      </p>
    </section>
  );
}
