import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AiMessage,
  AiContextItem,
  ModelConfig,
  PaperDocument,
  VisualEdge,
  VisualHtmlDemo,
  VisualNode,
  VisualNodeTone,
  VisualParameter,
  VisualSimulationModel,
  VisualSpec,
} from "../types";
import { makeId } from "../utils";
import {
  computeVisualSimulation,
  type VisualSimulationState,
} from "../visualSimulation";

interface VisualLabProps {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  paper: PaperDocument;
}

type VisualViewMode = "structured" | "html";
type VisualSpecBase = Omit<VisualSpec, "htmlDemo">;

const allowedKinds = new Set<VisualSpec["kind"]>([
  "concept-flow",
  "mechanism-animation",
  "equation-playground",
  "comparison",
]);
const allowedSimulationModels = new Set<VisualSimulationModel>([
  "generic-flow",
  "kv-cache-layout",
  "attention-flow",
  "memory-transfer",
  "pipeline",
]);
const allowedTones = new Set<VisualNodeTone>([
  "blue",
  "green",
  "amber",
  "rose",
  "neutral",
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clip = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;

const safeString = (value: unknown, fallback: string, maxLength = 80) => {
  const text = typeof value === "string" ? value.trim() : "";
  return clip(text || fallback, maxLength);
};

const safeLongString = (value: unknown, fallback: string, maxLength = 30_000) => {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeId = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = text
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

  return normalized || fallback;
};

const parameterDefaults = (parameters: VisualParameter[]) =>
  Object.fromEntries(
    parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  ) as Record<string, number>;

const nodeById = (nodes: VisualNode[], id: string) =>
  nodes.find((node) => node.id === id);

const normalizedValue = (
  parameter: VisualParameter,
  values: Record<string, number>,
) => {
  const value = values[parameter.id] ?? parameter.defaultValue;
  if (parameter.max === parameter.min) {
    return 0.5;
  }

  return clamp((value - parameter.min) / (parameter.max - parameter.min), 0, 1);
};

const buildVisualPrompt = ({
  activeContext,
  paper,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
}) =>
  [
    "You generate safe interactive visualizations for PaperSuper.",
    "Return ONLY valid JSON. Do not wrap it in Markdown. Do not include comments.",
    "The JSON must include BOTH a structured VisualSpec track and an HTML sandbox demo track.",
    "The JSON must match this TypeScript shape:",
    "{",
    '  "title": string,',
    '  "kind": "mechanism-animation" | "concept-flow" | "equation-playground" | "comparison",',
    '  "summary": string,',
    '  "nodes": [{"id": string, "label": string, "detail": string, "x": number, "y": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}],',
    '  "edges": [{"id": string, "from": string, "to": string, "label": string, "strength": number}],',
    '  "parameters": [{"id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number, "unit": string}],',
    '  "steps": [{"id": string, "title": string, "description": string, "focusNodeIds": string[]}],',
    '  "simulation": {"model": "kv-cache-layout" | "attention-flow" | "memory-transfer" | "pipeline" | "generic-flow", "description": string},',
    '  "htmlDemo": {"title": string, "notes": string, "html": string}',
    "}",
    "",
    "Design requirements:",
    "- Convert the selected paper passage into an interactive learning scene, not a generic chart.",
    "- All user-visible text should be Simplified Chinese, while important terms such as token, KV cache, GPU kernel, attention, softmax, query, key, value, interleaving should stay in English when clearer.",
    "- Prefer mechanism-animation when the passage describes a process, algorithm, cache layout, memory transfer, model architecture, or computation pipeline.",
    "- Nodes are modules/concepts in the passage. Use 4 to 7 nodes.",
    "- Coordinates use a 700 x 360 SVG canvas. Keep x between 70 and 630, y between 70 and 290.",
    "- Edges show data flow, dependency, transformation, or comparison. strength is 0.2 to 1.",
    "- Parameters must be meaningful knobs from the passage. Use 2 to 4 sliders.",
    "- The structured A track must be parameter-driven: choose simulation.model so local recomputation can change block counts, flow speed, active windows, and metrics.",
    "- Steps must form a dynamic explanation path. Use 3 to 5 steps and focus existing node ids.",
    "- Keep labels compact. detail strings should be short.",
    "- htmlDemo.html must be a self-contained BODY fragment, not a full document. It may include <style>, HTML, inline <svg>, and <script>.",
    "- htmlDemo.html must not load external resources, use fetch/WebSocket, use import, use eval/new Function, or navigate the page.",
    "- htmlDemo.html is B track. It is for demonstration and teaching, so it must include visible controls, metrics, and a compute/recalc function that changes the diagram or animation whenever sliders move.",
    "- htmlDemo.html should visually explain the same mechanism as the structured nodes/edges, but it may be richer and more customized than A track.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
  ].join("\n");

// 从模型输出中抽取 JSON。模型偶尔会包一层 ```json，所以这里做一次容错剥离。
const extractJsonObject = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("The model did not return a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1));
};

// HTML/JS 轨道只进入 iframe sandbox；这里的 fallback 也保持自包含，方便和结构化轨道对比效果。
const createFallbackHtmlDemo = (spec: VisualSpecBase): VisualHtmlDemo => {
  const parameterRows = spec.parameters
    .map(
      (parameter) => `
        <label class="control">
          <span>${escapeHtml(parameter.label)}</span>
          <input data-param="${parameter.id}" type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${parameter.defaultValue}">
          <b id="value-${parameter.id}">${parameter.defaultValue}${parameter.unit ? ` ${escapeHtml(parameter.unit)}` : ""}</b>
        </label>
      `,
    )
    .join("");
  const nodes = spec.nodes
    .map(
      (node, index) => `
        <div class="node tone-${node.tone}" style="left:${8 + index * 14}%; top:${34 + (index % 2) * 24}%">
          <strong>${escapeHtml(node.label)}</strong>
          <span>${escapeHtml(node.detail)}</span>
        </div>
      `,
    )
    .join("");

  return {
    title: `${spec.title} HTML Demo`,
    notes: "本地 fallback HTML sandbox，用于和结构化渲染对比。",
    html: `
      <style>
        :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #edf2f7; background: #101216; }
        .demo { display: grid; grid-template-rows: auto 1fr auto; gap: 10px; min-height: 100vh; padding: 12px; }
        .title { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
        h1 { margin: 0; font-size: 15px; }
        .badge { color: #58c08c; font-size: 11px; }
        .stage { position: relative; min-height: 230px; border: 1px solid #2c3038; border-radius: 8px; overflow: hidden; background: radial-gradient(circle at 20% 20%, rgba(111,156,255,.16), transparent 28%), #151821; }
        .node { position: absolute; width: 96px; min-height: 52px; padding: 8px; border: 1px solid #3a4150; border-radius: 8px; background: #20242e; transition: transform .2s ease, border-color .2s ease; }
        .node strong, .node span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .node strong { font-size: 12px; }
        .node span { color: #aab2c0; font-size: 10px; margin-top: 4px; }
        .tone-blue { border-color: #6f9cff; }
        .tone-green { border-color: #58c08c; }
        .tone-amber { border-color: #f2b86b; }
        .tone-rose { border-color: #e86f8d; }
        .packet { position: absolute; top: 64%; left: 8%; width: 18px; height: 18px; border-radius: 5px; background: #58c08c; box-shadow: 0 0 18px rgba(88,192,140,.55); animation: move var(--speed, 2.2s) linear infinite; }
        @keyframes move { to { left: 88%; } }
        .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .metric, .control { border: 1px solid #2c3038; border-radius: 7px; background: #171a21; }
        .metric { padding: 8px; }
        .metric span { display: block; color: #9aa4b2; font-size: 10px; }
        .metric strong { font-size: 13px; }
        .controls { display: grid; gap: 7px; }
        .control { display: grid; grid-template-columns: 72px 1fr 58px; gap: 8px; align-items: center; padding: 7px; }
        .control span, .control b { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .control b { text-align: right; }
        input { width: 100%; accent-color: #58c08c; }
      </style>
      <div class="demo">
        <div class="title">
          <h1>${escapeHtml(spec.title)}</h1>
          <span class="badge">HTML/JS sandbox</span>
        </div>
        <div class="stage">
          ${nodes}
          <div class="packet"></div>
        </div>
        <div class="metrics">
          <div class="metric"><span>数据单元</span><strong id="units">0</strong></div>
          <div class="metric"><span>局部性</span><strong id="locality">0%</strong></div>
          <div class="metric"><span>动画速度</span><strong id="speed">0x</strong></div>
        </div>
        <div class="controls">${parameterRows}</div>
      </div>
      <script>
        const params = ${JSON.stringify(spec.parameters)};
        const stage = document.querySelector('.stage');
        const packet = document.querySelector('.packet');
        const units = document.querySelector('#units');
        const locality = document.querySelector('#locality');
        const speed = document.querySelector('#speed');
        function norm(param, value) {
          return param.max === param.min ? 0.5 : Math.max(0, Math.min(1, (value - param.min) / (param.max - param.min)));
        }
        function recalc() {
          let total = 0;
          params.forEach((param) => {
            const input = document.querySelector('[data-param="' + param.id + '"]');
            const value = Number(input.value);
            document.querySelector('#value-' + param.id).textContent = value + (param.unit ? ' ' + param.unit : '');
            total += norm(param, value);
          });
          const energy = params.length ? total / params.length : 0.5;
          units.textContent = String(Math.round(12 + energy * 96));
          locality.textContent = Math.round(35 + energy * 58) + '%';
          speed.textContent = (0.8 + energy * 2.4).toFixed(1) + 'x';
          stage.style.setProperty('--speed', Math.max(0.8, 3.2 - energy * 2.1).toFixed(2) + 's');
          document.querySelectorAll('.node').forEach((node, index) => {
            node.style.transform = 'translateY(' + Math.sin(energy * 3.14 + index) * 7 + 'px)';
          });
          packet.style.width = (14 + energy * 16) + 'px';
        }
        document.querySelectorAll('input').forEach((input) => input.addEventListener('input', recalc));
        recalc();
      </script>
    `,
  };
};

// HTML 轨道进入 iframe sandbox 前先规范化；真正的安全边界在 iframe sandbox + CSP。
const normalizeHtmlDemo = (
  raw: unknown,
  fallbackSpec: VisualSpecBase,
): VisualHtmlDemo => {
  if (!raw || typeof raw !== "object") {
    return createFallbackHtmlDemo(fallbackSpec);
  }

  const item = raw as Partial<VisualHtmlDemo>;
  const html = safeLongString(item.html, "", 35_000);
  if (!html) {
    return createFallbackHtmlDemo(fallbackSpec);
  }

  return {
    title: safeString(item.title, `${fallbackSpec.title} HTML Demo`, 80),
    notes: safeString(item.notes, "HTML/JS sandbox preview", 160),
    html,
  };
};

const normalizeSimulation = (
  raw: unknown,
  fallbackModel: VisualSimulationModel,
) => {
  const source = raw && typeof raw === "object"
    ? (raw as { model?: unknown; description?: unknown })
    : {};
  const model = allowedSimulationModels.has(source.model as VisualSimulationModel)
    ? (source.model as VisualSimulationModel)
    : fallbackModel;

  return {
    model,
    description: safeString(source.description, "", 160) || undefined,
  };
};

const inferSimulationModelFromText = (text: string): VisualSimulationModel => {
  if (/kv|cache|interleav|gpu|kernel|block|transfer|memory|缓存|交织|块|传输/i.test(text)) {
    return "kv-cache-layout";
  }

  if (/attention|query|key|value|softmax|token|注意力/i.test(text)) {
    return "attention-flow";
  }

  if (/pipeline|stage|latency|流水|阶段/i.test(text)) {
    return "pipeline";
  }

  return "generic-flow";
};

// 结构化轨道是主安全路径：AI 只给数据，渲染和交互都由本地 React/SVG 接管。
const normalizeVisualSpec = (
  raw: unknown,
  activeContext: AiContextItem,
): VisualSpec => {
  if (!raw || typeof raw !== "object") {
    throw new Error("VisualSpec is not an object.");
  }

  const source = raw as Partial<VisualSpec>;
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = rawNodes
    .slice(0, 8)
    .map((node, index) => {
      const item = node as Partial<VisualNode>;
      const id = safeId(item.id, `node-${index + 1}`);
      const tone = allowedTones.has(item.tone as VisualNodeTone)
        ? (item.tone as VisualNodeTone)
        : (["blue", "green", "amber", "rose"][index % 4] as VisualNodeTone);

      return {
        id,
        label: safeString(item.label, `Node ${index + 1}`, 22),
        detail: safeString(item.detail, "Concept", 28),
        x: clamp(Number(item.x) || 90 + index * 95, 55, 645),
        y: clamp(Number(item.y) || 180, 55, 305),
        tone,
      };
    });

  if (nodes.length < 2) {
    throw new Error("VisualSpec needs at least two nodes.");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges = rawEdges
    .slice(0, 10)
    .map((edge, index) => {
      const item = edge as Partial<VisualEdge>;
      const from = safeId(item.from, "");
      const to = safeId(item.to, "");
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
        return null;
      }

      return {
        id: safeId(item.id, `edge-${index + 1}`),
        from,
        to,
        label: safeString(item.label, "flow", 16),
        strength: clamp(Number(item.strength) || 0.65, 0.2, 1),
      };
    })
    .filter(Boolean) as VisualEdge[];

  if (edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({
        id: `edge-${index + 1}`,
        from: nodes[index].id,
        to: nodes[index + 1].id,
        label: "flow",
        strength: 0.65,
      });
    }
  }

  const rawParameters = Array.isArray(source.parameters)
    ? source.parameters
    : [];
  const parameters = rawParameters
    .slice(0, 4)
    .map((parameter, index) => {
      const item = parameter as Partial<VisualParameter>;
      const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 1;
      const max = Number.isFinite(Number(item.max))
        ? Math.max(Number(item.max), min + 1)
        : min + 10;
      const step = Number(item.step) > 0 ? Number(item.step) : 1;
      const defaultValue = clamp(
        Number.isFinite(Number(item.defaultValue))
          ? Number(item.defaultValue)
          : min + (max - min) / 2,
        min,
        max,
      );

      return {
        id: safeId(item.id, `param-${index + 1}`),
        label: safeString(item.label, `Param ${index + 1}`, 18),
        min,
        max,
        step,
        defaultValue,
        unit: safeString(item.unit, "", 10) || undefined,
      };
    });

  if (parameters.length === 0) {
    parameters.push(
      {
        id: "scale",
        label: "Scale",
        min: 1,
        max: 10,
        step: 1,
        defaultValue: 5,
        unit: undefined,
      },
      {
        id: "parallelism",
        label: "Parallelism",
        min: 1,
        max: 16,
        step: 1,
        defaultValue: 6,
        unit: undefined,
      },
    );
  }

  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const steps = rawSteps
    .slice(0, 6)
    .map((step, index) => {
      const item = step as Partial<VisualSpec["steps"][number]>;
      const focusNodeIds = Array.isArray(item.focusNodeIds)
        ? item.focusNodeIds
            .map((id) => safeId(id, ""))
            .filter((id) => nodeIds.has(id))
            .slice(0, 3)
        : [];

      return {
        id: safeId(item.id, `step-${index + 1}`),
        title: safeString(item.title, `Step ${index + 1}`, 24),
        description: safeString(item.description, "Explain this transition.", 120),
        focusNodeIds: focusNodeIds.length > 0 ? focusNodeIds : [nodes[index % nodes.length].id],
      };
    });

  if (steps.length === 0) {
    nodes.slice(0, 4).forEach((node, index) => {
      steps.push({
        id: `step-${index + 1}`,
        title: node.label,
        description: node.detail,
        focusNodeIds: [node.id],
      });
    });
  }

  const kind = allowedKinds.has(source.kind as VisualSpec["kind"])
    ? (source.kind as VisualSpec["kind"])
    : "mechanism-animation";
  const fallbackSimulationModel = inferSimulationModelFromText(
    [
      source.title,
      source.summary,
      ...nodes.flatMap((node) => [node.label, node.detail]),
      ...parameters.flatMap((parameter) => [parameter.id, parameter.label]),
    ].join(" "),
  );

  const baseSpec: VisualSpecBase = {
    id: `visual-${activeContext.id}-${Date.now()}`,
    title: safeString(source.title, "Generated visual", 72),
    kind,
    sourceContextId: activeContext.id,
    summary: safeString(
      source.summary,
      "AI generated an interactive visualization from the selected passage.",
      220,
    ),
    nodes,
    edges,
    parameters,
    steps,
    simulation: normalizeSimulation(source.simulation, fallbackSimulationModel),
  };

  return {
    ...baseSpec,
    htmlDemo: normalizeHtmlDemo(source.htmlDemo, baseSpec),
  };
};

const createMockVisualSpec = (
  activeContext: AiContextItem | undefined,
  revision: number,
): VisualSpec => {
  const titleSource = activeContext?.text
    ? clip(activeContext.text.replace(/\s+/g, " "), 42)
    : "Attention mechanism";

  const baseSpec: VisualSpecBase = {
    id: `attention-visual-${activeContext?.id || "sample"}-${revision}`,
    title: titleSource,
    kind: "mechanism-animation",
    sourceContextId: activeContext?.id,
    summary:
      "A local visual scene turns the selected passage into a step-by-step mechanism map.",
    nodes: [
      {
        id: "tokens",
        label: "Tokens",
        detail: "Input positions",
        x: 82,
        y: 166,
        tone: "blue",
      },
      {
        id: "query",
        label: "Query",
        detail: "Current focus",
        x: 224,
        y: 86,
        tone: "green",
      },
      {
        id: "key",
        label: "Key",
        detail: "Match signal",
        x: 224,
        y: 236,
        tone: "amber",
      },
      {
        id: "score",
        label: "Score",
        detail: "Q x K",
        x: 374,
        y: 166,
        tone: "rose",
      },
      {
        id: "softmax",
        label: "Softmax",
        detail: "Normalize",
        x: 506,
        y: 166,
        tone: "blue",
      },
      {
        id: "output",
        label: "Output",
        detail: "Weighted value",
        x: 622,
        y: 166,
        tone: "green",
      },
    ],
    edges: [
      {
        id: "tokens-query",
        from: "tokens",
        to: "query",
        label: "project",
        strength: 0.7,
      },
      {
        id: "tokens-key",
        from: "tokens",
        to: "key",
        label: "project",
        strength: 0.62,
      },
      {
        id: "query-score",
        from: "query",
        to: "score",
        label: "compare",
        strength: 0.88,
      },
      {
        id: "key-score",
        from: "key",
        to: "score",
        label: "compare",
        strength: 0.82,
      },
      {
        id: "score-softmax",
        from: "score",
        to: "softmax",
        label: "scale",
        strength: 0.76,
      },
      {
        id: "softmax-output",
        from: "softmax",
        to: "output",
        label: "mix",
        strength: 0.92,
      },
    ],
    parameters: [
      {
        id: "sequenceLength",
        label: "序列长度",
        min: 16,
        max: 2048,
        step: 1,
        defaultValue: 256,
        unit: "token",
      },
      {
        id: "kvPairs",
        label: "KV 对数",
        min: 4,
        max: 96,
        step: 1,
        defaultValue: 16,
      },
      {
        id: "interleaveStride",
        label: "交织步长",
        min: 1,
        max: 32,
        step: 1,
        defaultValue: 4,
      },
      {
        id: "gpuLanes",
        label: "GPU 并行度",
        min: 4,
        max: 128,
        step: 1,
        defaultValue: 32,
      },
    ],
    steps: [
      {
        id: "input",
        title: "Input",
        description: "Tokens enter the mechanism as separate positions.",
        focusNodeIds: ["tokens"],
      },
      {
        id: "projection",
        title: "Projection",
        description: "The selected position creates query signals and matching keys.",
        focusNodeIds: ["query", "key"],
      },
      {
        id: "score",
        title: "Score",
        description: "Query and key vectors produce attention scores.",
        focusNodeIds: ["score"],
      },
      {
        id: "mix",
        title: "Normalize",
        description: "Softmax turns scores into weights before values are mixed.",
        focusNodeIds: ["softmax", "output"],
      },
    ],
    simulation: {
      model: "kv-cache-layout",
      description: "KV cache layout teaching simulation",
    },
  };

  return {
    ...baseSpec,
    htmlDemo: createFallbackHtmlDemo(baseSpec),
  };
};

// iframe 的 CSP 禁止联网和外部资源，但允许 demo 内部的内联脚本做参数重算。
const buildSandboxSrcDoc = (html: string) =>
  [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; font-src \'none\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ].join("");

export function VisualLab({
  contextItems,
  modelConfig,
  paper,
}: VisualLabProps) {
  const [revision, setRevision] = useState(0);
  const activeContext = contextItems[0];
  const [generatedSpec, setGeneratedSpec] = useState<VisualSpec | null>(null);
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const fallbackSpec = useMemo(
    () => createMockVisualSpec(activeContext, revision),
    [activeContext, revision],
  );
  const spec = generatedSpec ?? fallbackSpec;
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(
    () => parameterDefaults(spec.parameters),
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<VisualViewMode>("structured");
  const simulationState = useMemo(
    () => computeVisualSimulation(spec, parameterValues),
    [parameterValues, spec],
  );

  useEffect(() => {
    setGeneratedSpec(null);
    setGenerationStatus("idle");
    setGenerationError(null);
    setRevision((value) => value + 1);
  }, [activeContext?.id]);

  useEffect(() => {
    setParameterValues(parameterDefaults(spec.parameters));
    setActiveStepIndex(0);
  }, [spec.id, spec.parameters]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveStepIndex((index) => (index + 1) % spec.steps.length);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [isPlaying, spec.steps.length]);

  const activeStep = spec.steps[activeStepIndex];
  const focusNodeIds = new Set(activeStep.focusNodeIds);

  const updateParameter = (parameter: VisualParameter, value: number) => {
    setParameterValues((current) => ({
      ...current,
      [parameter.id]: value,
    }));
  };

  const goToStep = (direction: -1 | 1) => {
    setActiveStepIndex((index) =>
      (index + direction + spec.steps.length) % spec.steps.length,
    );
  };

  const generateVisual = async () => {
    if (!activeContext?.text.trim()) {
      setGenerationStatus("error");
      setGenerationError("Select a PDF paragraph before generating a visual.");
      return;
    }

    setGenerationStatus("loading");
    setGenerationError(null);

    const createdAt = new Date().toISOString();
    const prompt = buildVisualPrompt({ activeContext, paper });
    const messages: AiMessage[] = [
      {
        id: makeId(),
        role: "user",
        content: prompt,
        createdAt,
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 3200),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 3),
        ],
        messages,
      });

      const rawSpec = extractJsonObject(response?.content || "");
      const nextSpec = normalizeVisualSpec(rawSpec, activeContext);
      setGeneratedSpec(nextSpec);
      setGenerationStatus("done");
      setIsPlaying(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Visual generation failed.";
      setGeneratedSpec(null);
      setRevision((value) => value + 1);
      setGenerationStatus("error");
      setGenerationError(message);
    }
  };

  const statusLabel =
    generationStatus === "loading"
      ? "Generating visual..."
      : generationStatus === "done"
        ? "AI VisualSpec loaded"
        : generationStatus === "error"
          ? generationError
          : activeContext
            ? "Ready to generate from selection"
            : "Select a paragraph in the PDF first";

  return (
    <div className="visualLab">
      <section className="visualHero">
        <div className="visualHeroHeader">
          <div className="visualSourceBlock">
            <span className="visualSourceLabel">
              {generatedSpec ? "AI visual" : "Local preview"} - Page{" "}
              {activeContext?.pageNumber || "sample"}
            </span>
            <strong title={spec.title}>{spec.title}</strong>
          </div>
          <div className="visualHeaderActions">
            <div className="visualModeSwitch" aria-label="Visual rendering mode">
              <button
                type="button"
                className={`visualModeButton ${viewMode === "structured" ? "active" : ""}`}
                onClick={() => setViewMode("structured")}
              >
                A
              </button>
              <button
                type="button"
                className={`visualModeButton ${viewMode === "html" ? "active" : ""}`}
                onClick={() => setViewMode("html")}
              >
                B
              </button>
            </div>
            <button
              type="button"
              className="ghostButton compactButton"
              disabled={generationStatus === "loading" || !activeContext}
              onClick={() => void generateVisual()}
            >
              <Sparkles size={13} />
              <span>{generationStatus === "loading" ? "Working" : "Generate"}</span>
            </button>
          </div>
        </div>

        {viewMode === "structured" ? (
          <>
            <VisualCanvas
              edges={spec.edges}
              focusNodeIds={focusNodeIds}
              isPlaying={isPlaying}
              nodes={spec.nodes}
              parameters={spec.parameters}
              parameterValues={parameterValues}
              simulationState={simulationState}
            />

            <div className="visualPlayback">
              <button
                type="button"
                className="textIconButton"
                aria-label="Previous visual step"
                onClick={() => goToStep(-1)}
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                className="textIconButton"
                aria-label={isPlaying ? "Pause visual scene" : "Play visual scene"}
                onClick={() => setIsPlaying((playing) => !playing)}
              >
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button
                type="button"
                className="textIconButton"
                aria-label="Next visual step"
                onClick={() => goToStep(1)}
              >
                <SkipForward size={13} />
              </button>
              <div className="visualStepText">
                <strong>{activeStep.title}</strong>
                <span>{activeStep.description}</span>
              </div>
              <button
                type="button"
                className="textIconButton"
                aria-label="Reset visual scene"
                onClick={() => {
                  setActiveStepIndex(0);
                  setParameterValues(parameterDefaults(spec.parameters));
                }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </>
        ) : (
          <HtmlSandbox htmlDemo={spec.htmlDemo ?? createFallbackHtmlDemo(spec)} />
        )}
      </section>

      <section className="visualControls">
        <div className="visualSectionTitle">
          <SlidersHorizontal size={13} />
          <span>Parameters</span>
        </div>
        {spec.parameters.map((parameter) => (
          <label className="visualSliderRow" key={parameter.id}>
            <span>{parameter.label}</span>
            <input
              type="range"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={parameterValues[parameter.id] ?? parameter.defaultValue}
              onChange={(event) =>
                updateParameter(parameter, Number(event.target.value))
              }
            />
            <strong>
              {parameterValues[parameter.id] ?? parameter.defaultValue}
              {parameter.unit ? ` ${parameter.unit}` : ""}
            </strong>
          </label>
        ))}
      </section>

      <section className="visualNotes">
        <div className="visualSectionTitle">
          <Sparkles size={13} />
          <span>Scene Notes</span>
        </div>
        <p>{spec.summary}</p>
        <p className={generationStatus === "error" ? "visualStatus error" : "visualStatus"}>
          {statusLabel}
        </p>
        <p>{activeContext ? clip(activeContext.text, 180) : "Attention sample scene"}</p>
      </section>
    </div>
  );
}

function HtmlSandbox({ htmlDemo }: { htmlDemo: VisualHtmlDemo }) {
  return (
    <div className="visualSandboxShell">
      <iframe
        className="visualSandboxFrame"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={buildSandboxSrcDoc(htmlDemo.html)}
        title={htmlDemo.title}
      />
      <div className="visualSandboxFooter">
        <strong>{htmlDemo.title}</strong>
        {htmlDemo.notes ? <span>{htmlDemo.notes}</span> : null}
      </div>
    </div>
  );
}

function VisualCanvas({
  edges,
  focusNodeIds,
  isPlaying,
  nodes,
  parameters,
  parameterValues,
  simulationState,
}: {
  edges: VisualEdge[];
  focusNodeIds: Set<string>;
  isPlaying: boolean;
  nodes: VisualNode[];
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
  simulationState: VisualSimulationState;
}) {
  const normalizedParameters = parameters.map((parameter) =>
    normalizedValue(parameter, parameterValues),
  );
  const visualEnergy =
    normalizedParameters.length > 0
      ? normalizedParameters.reduce((total, value) => total + value, 0) /
        normalizedParameters.length
      : 0.5;
  const sizeParameter =
    parameters.find((parameter) =>
      /seq|token|pair|block|length|size|cache/i.test(
        `${parameter.id} ${parameter.label}`,
      ),
    ) ?? parameters[0];
  const windowParameter =
    parameters.find((parameter) =>
      /window|stride|lane|parallel|gpu|kernel|interleave/i.test(
        `${parameter.id} ${parameter.label}`,
      ),
    ) ?? parameters[1] ?? parameters[0];
  const tokenCount = sizeParameter
    ? Math.round(8 + normalizedValue(sizeParameter, parameterValues) * 22)
    : 16;
  const windowSize = windowParameter
    ? Math.round(2 + normalizedValue(windowParameter, parameterValues) * 10)
    : 4;
  const animationSpeed = Math.max(0.75, 3.2 - visualEnergy * 1.1 - simulationState.utilization);
  const signalRadius = 3.5 + visualEnergy * 3.5;

  return (
    <div className="visualCanvasShell">
      <svg
        className="visualCanvas"
        role="img"
        aria-label="Interactive visualization canvas"
        viewBox="0 0 700 360"
      >
        <defs>
          <linearGradient id="visualSignalGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#6f9cff" />
            <stop offset="54%" stopColor="#58c08c" />
            <stop offset="100%" stopColor="#f2b86b" />
          </linearGradient>
          <filter id="visualGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect className="visualGridBg" width="700" height="360" rx="8" />
        {Array.from({ length: 10 }).map((_, index) => (
          <line
            className="visualGridLine"
            key={`grid-x-${index}`}
            x1={70 + index * 62}
            x2={70 + index * 62}
            y1="30"
            y2="330"
          />
        ))}
        {Array.from({ length: 5 }).map((_, index) => (
          <line
            className="visualGridLine"
            key={`grid-y-${index}`}
            x1="38"
            x2="662"
            y1={56 + index * 58}
            y2={56 + index * 58}
          />
        ))}

        {edges.map((edge) => {
          const from = nodeById(nodes, edge.from);
          const to = nodeById(nodes, edge.to);
          if (!from || !to) {
            return null;
          }

          const path = `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`;
          const edgeFocus =
            focusNodeIds.has(edge.from) || focusNodeIds.has(edge.to);
          const strokeWidth = 1.4 + edge.strength * (1.2 + visualEnergy * 4);

          return (
            <g key={edge.id}>
              <path id={`${edge.id}-path`} d={path} fill="none" />
              <path
                className={`visualEdge ${edgeFocus ? "active" : ""}`}
                d={path}
                strokeWidth={strokeWidth}
              />
              <text className="visualEdgeLabel">
                <textPath href={`#${edge.id}-path`} startOffset="52%">
                  {edge.label}
                </textPath>
              </text>
              {isPlaying && edgeFocus ? (
                <circle
                  className="visualSignal"
                  filter="url(#visualGlow)"
                  r={signalRadius + edge.strength}
                >
                  <animateMotion
                    dur={`${animationSpeed}s`}
                    path={path}
                    repeatCount="indefinite"
                  />
                </circle>
              ) : null}
            </g>
          );
        })}

        <g className="visualTokenRail">
          {Array.from({ length: Math.min(tokenCount, 24) }).map((_, index) => {
            const isWindow = index < windowSize;
            const x = 44 + index * 10;
            return (
              <rect
                className={`visualToken ${isWindow ? "active" : ""}`}
                height={isWindow ? 28 : 20}
                key={`token-${index}`}
                rx="3"
                width="6"
                x={x}
                y={310 - (isWindow ? 4 : 0)}
              />
            );
          })}
        </g>

        <SimulationLayer
          isPlaying={isPlaying}
          simulationState={simulationState}
        />

        {nodes.map((node) => {
          const isFocused = focusNodeIds.has(node.id);
          return (
            <g
              className={`visualNode ${node.tone} ${isFocused ? "active" : ""}`}
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
            >
              <circle className="visualNodePulse" r={isFocused ? 34 : 0} />
              <rect
                className="visualNodeBox"
                height="50"
                rx="8"
                width="106"
                x="-53"
                y="-25"
              />
              <text className="visualNodeLabel" textAnchor="middle" y="-3">
                {node.label}
              </text>
              <text className="visualNodeDetail" textAnchor="middle" y="14">
                {node.detail}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="visualMetricStrip">
        {simulationState.metrics.map((metric) => (
          <div className={`visualMetric ${metric.tone}`} key={metric.id}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulationLayer({
  isPlaying,
  simulationState,
}: {
  isPlaying: boolean;
  simulationState: VisualSimulationState;
}) {
  const kBlocks = Math.min(18, Math.max(5, Math.round(simulationState.sequenceLength / 96)));
  const vBlocks = kBlocks;
  const kvBlocks = Math.min(
    22,
    Math.max(6, Math.round(simulationState.unitCount / 320)),
  );
  const activeKvBlocks = Math.min(
    kvBlocks,
    Math.max(2, Math.round(simulationState.interleaveStride / 3)),
  );
  const transferBlocks = Math.min(
    16,
    Math.max(3, Math.round(simulationState.transferBlocks / 2)),
  );
  const gpuLaneCount = Math.min(
    12,
    Math.max(3, Math.round(simulationState.gpuLanes / 10)),
  );
  const flowDuration = `${Math.max(0.75, 3.4 - simulationState.speed * 0.72).toFixed(2)}s`;

  // 参数变化会先进入 SimulationEngine 重算，再由这里把数量、路径和速度映射到 SVG。
  return (
    <g className="visualSimulationLayer">
      <text className="visualSimLabel" x="42" y="282">
        K cache
      </text>
      <text className="visualSimLabel" x="42" y="314">
        V cache
      </text>
      {Array.from({ length: kBlocks }).map((_, index) => (
        <rect
          className="visualSimBlock k"
          height="14"
          key={`k-${index}`}
          rx="3"
          width="8"
          x={96 + index * 9}
          y="270"
        />
      ))}
      {Array.from({ length: vBlocks }).map((_, index) => (
        <rect
          className="visualSimBlock v"
          height="14"
          key={`v-${index}`}
          rx="3"
          width="8"
          x={96 + index * 9}
          y="302"
        />
      ))}

      <path className="visualSimArrow" d="M 270 286 C 300 286 302 292 328 292" />
      <text className="visualSimLabel" x="330" y="268">
        token-wise interleaving
      </text>
      {Array.from({ length: kvBlocks }).map((_, index) => (
        <rect
          className={`visualSimBlock kv ${index < activeKvBlocks ? "active" : ""}`}
          height="24"
          key={`kv-${index}`}
          rx="4"
          width="9"
          x={330 + index * 10}
          y="280"
        />
      ))}

      <path className="visualSimArrow" d="M 570 292 C 592 292 594 292 612 292" />
      <text className="visualSimLabel" x="498" y="328">
        block transfer x {simulationState.transferBlocks}
      </text>
      {Array.from({ length: transferBlocks }).map((_, index) => (
        <rect
          className="visualTransferBlock"
          height="8"
          key={`transfer-${index}`}
          rx="2"
          width="12"
          x={496 + index * 13}
          y="306"
        />
      ))}

      <text className="visualSimLabel" x="612" y="268">
        GPU lanes
      </text>
      {Array.from({ length: gpuLaneCount }).map((_, index) => (
        <rect
          className="visualGpuLane"
          height="5"
          key={`lane-${index}`}
          rx="2"
          width="42"
          x="612"
          y={278 + index * 7}
        />
      ))}

      {isPlaying ? (
        <circle className="visualSimPacket" r="5">
          <animateMotion
            dur={flowDuration}
            path="M 110 286 C 230 286 260 292 346 292 C 450 292 530 292 652 292"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
    </g>
  );
}
