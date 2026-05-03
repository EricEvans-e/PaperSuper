import {
  Beaker,
  Brain,
  FunctionSquare,
  Lightbulb,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AiContextItem,
  AiMessage,
  ExperimentWorkspaceModule,
  FormulaWorkspaceModule,
  InsightWorkspaceModule,
  LearningEvent,
  ModelConfig,
  PaperDocument,
  PaperTextPage,
  VisualParameter,
  VisualSpec,
  WorkspaceAction,
  WorkspaceModule,
  WorkspaceModuleType,
  WorkspaceSpec,
} from "../types";
import { makeId, parseModelJsonObject } from "../utils";
import { createMockVisualSpec, normalizeVisualSpec, VisualLab } from "./VisualLab";

interface AiWorkbenchProps {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  paper: PaperDocument;
  paperTextPages: PaperTextPage[];
}

type GenerationStatus = "idle" | "loading" | "done" | "error";

const moduleMeta: Record<WorkspaceModuleType, { label: string; icon: typeof Brain }> = {
  visual: { label: "图示", icon: Brain },
  formula: { label: "公式", icon: FunctionSquare },
  experiment: { label: "参数", icon: Beaker },
  insight: { label: "要点", icon: Lightbulb },
};

const clip = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;

const safeString = (value: unknown, fallback: string, maxLength = 120) => {
  const text = typeof value === "string" ? value.trim() : "";
  return clip(text || fallback, maxLength);
};

const safeLongString = (value: unknown, fallback: string, maxLength = 2000) => {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
};

const safeId = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = text
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return normalized || fallback;
};

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeParameter = (
  raw: unknown,
  index: number,
  fallbackLabel = "Parameter",
): VisualParameter => {
  const source = raw && typeof raw === "object"
    ? (raw as Partial<VisualParameter>)
    : {};
  const min = numberOr(source.min, 0);
  const max = Math.max(numberOr(source.max, min + 10), min + 1);
  const step = Math.max(numberOr(source.step, 1), 0.0001);
  const defaultValue = Math.min(
    Math.max(numberOr(source.defaultValue, min + (max - min) / 2), min),
    max,
  );

  return {
    id: safeId(source.id, `param-${index + 1}`),
    label: safeString(source.label, `${fallbackLabel} ${index + 1}`, 24),
    min,
    max,
    step,
    defaultValue,
    unit: safeString(source.unit, "", 12) || undefined,
  };
};

const normalizeStringList = (
  value: unknown,
  fallback: string[],
  maxItems = 5,
  maxLength = 180,
) =>
  (Array.isArray(value) ? value : fallback)
    .slice(0, maxItems)
    .map((item, index) => safeString(item, fallback[index] ?? "Item", maxLength))
    .filter(Boolean);

const clipContext = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...` : text;

const buildPaperContextExcerpt = (
  paperTextPages: PaperTextPage[],
  pageNumber?: number,
) => {
  // AI Workbench 生成时也会复用整篇论文文本缓存。
  // 这里不是把全文原样发送，而是优先当前页、邻近页和开头几页，再裁成一个较短 excerpt。
  if (paperTextPages.length === 0) {
    return "No extracted paper text is available yet.";
  }

  const selectedPage = pageNumber
    ? paperTextPages.find((page) => page.pageNumber === pageNumber)
    : undefined;
  const neighborPages = pageNumber
    ? paperTextPages.filter(
        (page) =>
          page.pageNumber >= pageNumber - 1 && page.pageNumber <= pageNumber + 1,
      )
    : [];
  const firstPages = paperTextPages.slice(0, 2);
  const orderedPages = [
    ...(selectedPage ? [selectedPage] : []),
    ...neighborPages,
    ...firstPages,
  ].filter(
    (page, index, pages) =>
      pages.findIndex((item) => item.pageNumber === page.pageNumber) === index,
  );

  return clipContext(
    orderedPages
      .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
      .join("\n\n"),
    10_000,
  );
};

const recordLearningEvent = (event: LearningEvent) => {
  window.dispatchEvent(
    new CustomEvent("papersuper:learning-event", {
      detail: event,
    }),
  );

  if (import.meta.env.DEV) {
    console.debug("PaperSuper learning event", event);
  }
};

const buildWorkspacePrompt = ({
  activeContext,
  paper,
  paperContext,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
}) =>
  [
    "You generate a modular AI Workbench for PaperSuper.",
    "Return ONLY valid JSON. Do not wrap it in Markdown. Do not include comments.",
    "JSON validity is mandatory: every array/object element must be separated by commas, no trailing commas, no unescaped newlines inside strings, and all string values must use double quotes.",
    "The JSON must describe local safe modules rendered by PaperSuper.",
    "Do NOT include HTML, JavaScript, CSS, SVG markup, executable code, or htmlDemo in this JSON. PaperSuper generates the visual code in a separate raw-HTML step after this JSON is parsed.",
    "The JSON must match this TypeScript-like shape:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "actions": [{"type": "open_workspace" | "focus_block" | "focus_pdf_context" | "open_learning_report", "workspaceId": string, "blockId": string, "contextId": string, "highlightId": string}],',
    '  "modules": [',
    '    {"id": string, "type": "visual", "title": string, "summary": string, "visual": VisualSpec},',
    '    {"id": string, "type": "formula", "title": string, "summary": string, "formula": {"expression": string, "plainLanguage": string, "variables": [{"symbol": string, "meaning": string, "role": string}], "derivationSteps": [{"title": string, "detail": string}]}},',
    '    {"id": string, "type": "experiment", "title": string, "summary": string, "experiment": {"objective": string, "parameters": [{"id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number, "unit": string}], "metrics": [{"id": string, "label": string, "baseline": number, "direction": "higher-better" | "lower-better" | "neutral", "unit": string}], "observations": string[]}},',
    '    {"id": string, "type": "insight", "title": string, "summary": string, "insight": {"keyPoints": string[], "assumptions": string[], "limitations": string[], "nextQuestions": string[]}}',
    "  ]",
    "}",
    "",
    "VisualSpec requirements:",
    "- Use the same VisualSpec fields as PaperSuper A mode: title, kind, diagramType, diagramPurpose, readerTakeaway, semantic, mechanismBrief, principleDiagram, scene, summary, nodes, edges, visualElements, parameters, steps, simulation.",
    '- semantic must be present and must match: {"template": "memory-prefetch-pipeline" | "memory-hierarchy" | "attention-matrix" | "model-architecture" | "equation-transform" | "comparison-tradeoff" | "timeline-stage" | "generic-mechanism", "problem": string, "mechanism": string[], "keyObjects": [{"id": string, "label": string, "role": string, "detail": string}], "flows": [{"from": string, "to": string, "label": string, "detail": string}], "takeaway": string}.',
    '- mechanismBrief must be present and must match: {"mechanismName": string, "coreProblem": string, "keyObjects": [{"id": string, "label": string, "role": string, "evidence": string}], "causalChain": string[], "learningGoal": string, "takeaway": string}.',
    '- principleDiagram must be present and must match: {"title": string, "diagramKind": "structure-map" | "mechanism-map" | "matrix-map" | "equation-map" | "comparison-map" | "timeline-map" | "geometry-map", "centralClaim": string, "regions": [{"id": string, "label": string, "role": string, "detail": string, "x": number, "y": number, "width": number, "height": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "relations": [{"id": string, "from": string, "to": string, "label": string, "detail": string, "relationType": "causes" | "depends-on" | "transfers" | "transforms" | "predicts" | "compares" | "contains"}], "annotations": [{"id": string, "targetId": string, "label": string, "detail": string, "x": number, "y": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "takeaway": string}.',
    '- scene must be present and must match: {"title": string, "sceneKind": "layout-transform" | "dataflow" | "matrix-computation" | "architecture-assembly" | "state-transition" | "comparison-mechanism" | "geometric-process" | "generic-mechanism", "purpose": string, "regions": [{"id": string, "label": string, "role": string, "x": number, "y": number, "width": number, "height": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "units": [{"id": string, "label": string, "kind": string, "regionId": string, "lane": number, "index": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral", "pairWith": string, "value": string, "detail": string}], "steps": [{"id": string, "title": string, "description": string, "operation": "move" | "pair" | "merge" | "split" | "reorder" | "broadcast" | "filter" | "accumulate" | "lookup" | "transform" | "compare" | "compute", "activeUnitIds": string[], "fromRegionId": string, "toRegionId": string, "resultUnitIds": string[], "placements": [{"unitId": string, "regionId": string, "lane": number, "index": number, "hidden": boolean}], "parameterEffects": string[]}], "takeaway": string}.',
    "- The visual module must be a clear teaching diagram, not a decorative cockpit or metrics dashboard.",
    "- The visual module must follow this learning chain: mechanismBrief explains the problem and causal logic; principleDiagram draws the static 原理图; scene turns the same mechanism into a playable animation; parameters let the learner manipulate visible behavior.",
    "- Do not output only a flowchart. The visual module should expose how the mechanism works internally: objects, regions, state changes, movement, pairing, merging, splitting, comparison, or computation.",
    "- Let the paper passage decide diagramType: structure, mechanism, equation, matrix, comparison, timeline, or geometry.",
    "- Let semantic.template decide the local renderer template. Use memory-prefetch-pipeline for SSD/host/GPU memory/KV cache prefetching; memory-hierarchy for cache/storage layers; attention-matrix for query/key/value attention weights; model-architecture for module structure; equation-transform for formula derivations; comparison-tradeoff for alternatives; timeline-stage for staged procedures.",
    "- diagramPurpose must state what the diagram explains in one plain Chinese sentence.",
    "- readerTakeaway must state what the reader should understand after looking at the diagram.",
    "- semantic.keyObjects must contain the real objects from the paper, not generic 'Concept' placeholders.",
    "- semantic.flows must name real transfer, prediction, dependency, or transformation relations.",
    "- principleDiagram.regions must be 3 to 6 real structures or mechanism objects, not Step 1/Step 2 boxes.",
    "- principleDiagram.relations must encode causal logic such as predicts, transfers, transforms, depends-on, compares, contains, or causes.",
    "- If the passage is about speculative prefetching, principleDiagram should show history of KV block selections -> temporal locality predictor -> predicted critical KV blocks -> SSD/host transfer -> GPU memory before self-attention.",
    "- scene.regions must describe visual places such as original layout/action/optimized layout, operands/score/output, modules/submodules, or states. scene.units must be concrete objects from the paper, not generic steps.",
    "- If the passage is about KV cache interleaving/consolidation, scene must show separated K lane and V lane first, token-wise K_i + V_i pairing, then compact [K_i|V_i] units. Generalize this structure-and-motion style to other mechanisms.",
    "- Do not include htmlDemo. The later raw-HTML code-generation step will use this structured VisualSpec to write the actual interactive SVG/HTML/JS visualization.",
    "- scene.steps should be 3 to 5 short teaching steps. Each step should activate visible units and use an operation like pair, merge, reorder, compute, lookup, broadcast, or accumulate.",
    "- Use visualElements for the main explanatory drawing: architecture blocks, matrices, tensor grids, formulas, bars, brackets, axes, annotations, arrows, and non-flowchart diagrams.",
    "- Prefer one dominant visual form. Do not mix flowchart, GPU meters, cache blocks, matrix, and formula unless the selected passage truly needs them.",
    "- Use 3 to 5 major nodes in most cases and 1 to 3 meaningful parameters.",
    "- Parameters should change the visual scene directly: unit count, spacing, highlighted span, matrix density, merge strength, or animation speed.",
    "- Use Simplified Chinese for user-visible text, but keep technical terms like token, KV cache, GPU kernel, attention, softmax, query, key, value in English when clearer.",
    "",
    "Workbench requirements:",
    "- Always include exactly one visual module.",
    "- Build the visual module from the selected passage plus the paper context excerpt. Use the broader context to recover missing objects, storage layers, algorithms, and terminology.",
    "- Include one formula module if the passage contains formulas, algorithmic transformations, variables, or tensor operations.",
    "- Include one experiment module with 2 to 4 meaningful sliders and 2 to 4 metrics.",
    "- Include one insight module that explains contribution, assumptions, limitations, and next questions.",
    "- Include 1 to 3 suggested actions. Use focus_block to guide the learner to the most important module.",
    "- Keep content concise and useful for learning the selected paper passage.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
  ].join("\n");

const createFallbackWorkspaceSpec = (
  activeContext: AiContextItem | undefined,
  revision: number,
): WorkspaceSpec => {
  const visual = createMockVisualSpec(activeContext, revision);
  const sourceTitle = activeContext?.text
    ? clip(activeContext.text.replace(/\s+/g, " "), 44)
    : "Attention mechanism";

  return {
    id: `workspace-${activeContext?.id ?? "sample"}-${revision}`,
    title: sourceTitle,
    summary: "本地预览工作区：把论文片段拆成结构图、公式、实验和洞察模块。",
    sourceContextId: activeContext?.id,
    modules: [
      {
        id: "visual-module",
        type: "visual",
        title: "机制可视化",
        summary: visual.summary,
        visual,
      },
      {
        id: "formula-module",
        type: "formula",
        title: "公式与变量",
        summary: "用公式框架解释当前片段里的核心计算关系。",
        formula: {
          expression: "softmax(QK^T / sqrt(d)) V",
          plainLanguage:
            "query 与 key 计算匹配分数，经过 softmax 归一化后，对 value 做加权聚合。",
          variables: [
            { symbol: "Q", meaning: "Query，当前位置提出的匹配请求", role: "输入" },
            { symbol: "K", meaning: "Key，用于和 Query 比较", role: "索引" },
            { symbol: "V", meaning: "Value，被权重混合的信息", role: "输出来源" },
            { symbol: "d", meaning: "缩放维度，稳定 softmax 分布", role: "稳定项" },
          ],
          derivationSteps: [
            { title: "投影", detail: "token 表示被映射为 Q、K、V 三组向量。" },
            { title: "打分", detail: "Q 与 K 的点积表示当前位置对其他位置的关注强度。" },
            { title: "归一化", detail: "softmax 把分数转换为概率式权重。" },
            { title: "聚合", detail: "权重作用在 V 上，形成当前 token 的上下文表示。" },
          ],
        },
      },
      {
        id: "experiment-module",
        type: "experiment",
        title: "参数实验",
        summary: "通过调节上下文长度、KV 对数和并行度观察效率指标变化。",
        experiment: {
          objective: "观察参数如何影响数据单元数量、局部性和 GPU 利用率。",
          parameters: visual.parameters,
          metrics: [
            {
              id: "throughput",
              label: "吞吐",
              baseline: 0.64,
              direction: "higher-better",
              unit: "x",
            },
            {
              id: "latency",
              label: "延迟",
              baseline: 0.42,
              direction: "lower-better",
              unit: "ms",
            },
            {
              id: "locality",
              label: "局部性",
              baseline: 0.58,
              direction: "higher-better",
              unit: "%",
            },
          ],
          observations: [
            "更高并行度通常提升吞吐，但也可能受内存访问模式限制。",
            "交织或分块策略会改变局部性，进而影响有效带宽。",
            "上下文长度增大时，缓存布局对性能的影响会更明显。",
          ],
        },
      },
      {
        id: "insight-module",
        type: "insight",
        title: "论文洞察",
        summary: "把当前片段转化为贡献、假设、局限和追问。",
        insight: {
          keyPoints: [
            "这段内容试图把抽象机制转化为更高效的数据组织或计算流程。",
            "核心价值在于减少低效访问，并让硬件并行更容易发挥作用。",
          ],
          assumptions: [
            "目标硬件对连续访问、分块传输或并行 kernel 更友好。",
            "论文片段中的机制可以在推理或训练流程里稳定复用。",
          ],
          limitations: [
            "如果输入规模较小，额外的数据重排成本可能抵消收益。",
            "不同模型结构和硬件平台上的收益可能不一致。",
          ],
          nextQuestions: [
            "作者是否给出了消融实验来证明每个设计组件的贡献？",
            "该机制在长上下文、不同 batch size 或多 GPU 场景下是否仍然有效？",
          ],
        },
      },
    ],
    actions: [
      { type: "focus_block", blockId: "visual-module" },
      { type: "focus_block", blockId: "experiment-module" },
    ],
  };
};

const normalizeFormulaModule = (
  raw: any,
  index: number,
): FormulaWorkspaceModule => {
  const formula = raw?.formula && typeof raw.formula === "object" ? raw.formula : {};

  return {
    id: safeId(raw?.id, `formula-${index + 1}`),
    type: "formula",
    title: safeString(raw?.title, "公式解释", 40),
    summary: safeString(raw?.summary, "拆解公式和变量关系。", 160),
    formula: {
      expression: safeLongString(formula.expression, "No explicit formula", 260),
      plainLanguage: safeLongString(
        formula.plainLanguage,
        "这部分把论文里的计算关系翻译成可读解释。",
        420,
      ),
      variables: (Array.isArray(formula.variables) ? formula.variables : [])
        .slice(0, 8)
        .map((item: any, variableIndex: number) => ({
          symbol: safeString(item?.symbol, `x_${variableIndex + 1}`, 24),
          meaning: safeString(item?.meaning, "变量含义", 120),
          role: safeString(item?.role, "", 60) || undefined,
        })),
      derivationSteps: (Array.isArray(formula.derivationSteps)
        ? formula.derivationSteps
        : []
      )
        .slice(0, 6)
        .map((item: any, stepIndex: number) => ({
          title: safeString(item?.title, `步骤 ${stepIndex + 1}`, 32),
          detail: safeString(item?.detail, "解释该步骤的计算含义。", 180),
        })),
    },
  };
};

const normalizeExperimentModule = (
  raw: any,
  index: number,
  fallbackParameters: VisualParameter[],
): ExperimentWorkspaceModule => {
  const experiment =
    raw?.experiment && typeof raw.experiment === "object" ? raw.experiment : {};
  const parameters = (Array.isArray(experiment.parameters)
    ? experiment.parameters
    : fallbackParameters
  )
    .slice(0, 4)
    .map((parameter: unknown, parameterIndex: number) =>
      normalizeParameter(parameter, parameterIndex, "参数"),
    );

  return {
    id: safeId(raw?.id, `experiment-${index + 1}`),
    type: "experiment",
    title: safeString(raw?.title, "参数实验", 40),
    summary: safeString(raw?.summary, "调节参数并观察指标变化。", 160),
    experiment: {
      objective: safeString(
        experiment.objective,
        "观察参数变化如何影响机制表现。",
        180,
      ),
      parameters,
      metrics: (Array.isArray(experiment.metrics) ? experiment.metrics : [])
        .slice(0, 5)
        .map((metric: any, metricIndex: number) => ({
          id: safeId(metric?.id, `metric-${metricIndex + 1}`),
          label: safeString(metric?.label, `指标 ${metricIndex + 1}`, 24),
          baseline: Math.min(Math.max(numberOr(metric?.baseline, 0.5), 0), 1),
          direction:
            metric?.direction === "higher-better" ||
            metric?.direction === "lower-better" ||
            metric?.direction === "neutral"
              ? metric.direction
              : "neutral",
          unit: safeString(metric?.unit, "", 10) || undefined,
        })),
      observations: normalizeStringList(
        experiment.observations,
        ["拖动参数后，观察上方指标和曲线变化。"],
        5,
        160,
      ),
    },
  };
};

const normalizeInsightModule = (
  raw: any,
  index: number,
): InsightWorkspaceModule => {
  const insight = raw?.insight && typeof raw.insight === "object" ? raw.insight : {};

  return {
    id: safeId(raw?.id, `insight-${index + 1}`),
    type: "insight",
    title: safeString(raw?.title, "论文洞察", 40),
    summary: safeString(raw?.summary, "提炼贡献、假设、局限和追问。", 160),
    insight: {
      keyPoints: normalizeStringList(insight.keyPoints, ["核心贡献待补充。"]),
      assumptions: normalizeStringList(insight.assumptions, ["关键假设待补充。"]),
      limitations: normalizeStringList(insight.limitations, ["潜在局限待补充。"]),
      nextQuestions: normalizeStringList(insight.nextQuestions, ["下一步问题待补充。"]),
    },
  };
};

const normalizeWorkspaceSpec = (
  raw: unknown,
  activeContext: AiContextItem,
): WorkspaceSpec => {
  if (!raw || typeof raw !== "object") {
    throw new Error("WorkspaceSpec is not an object.");
  }

  const source = raw as Partial<WorkspaceSpec>;
  const rawModules = Array.isArray(source.modules) ? source.modules : [];
  const modules: WorkspaceModule[] = [];
  let visualFallback: VisualSpec | null = null;

  rawModules.forEach((module, index) => {
    const item = module as any;
    if (item?.type === "visual") {
      const visual = normalizeVisualSpec(item.visual ?? item, activeContext);
      visualFallback = visual;
      modules.push({
        id: safeId(item.id, `visual-${index + 1}`),
        type: "visual",
        title: safeString(item.title, visual.title, 40),
        summary: safeString(item.summary, visual.summary, 180),
        visual,
      });
      return;
    }

    if (item?.type === "formula") {
      modules.push(normalizeFormulaModule(item, index));
      return;
    }

    if (item?.type === "experiment") {
      modules.push(
        normalizeExperimentModule(item, index, visualFallback?.parameters ?? []),
      );
      return;
    }

    if (item?.type === "insight") {
      modules.push(normalizeInsightModule(item, index));
    }
  });

  if (!modules.some((module) => module.type === "visual")) {
    const visual = normalizeVisualSpec(source, activeContext);
    visualFallback = visual;
    modules.unshift({
      id: "visual-module",
      type: "visual",
      title: visual.title,
      summary: visual.summary,
      visual,
    });
  }

  if (!modules.some((module) => module.type === "formula")) {
    modules.push(normalizeFormulaModule({}, modules.length));
  }

  if (!modules.some((module) => module.type === "experiment")) {
    modules.push(
      normalizeExperimentModule({}, modules.length, visualFallback?.parameters ?? []),
    );
  }

  if (!modules.some((module) => module.type === "insight")) {
    modules.push(normalizeInsightModule({}, modules.length));
  }

  return {
    id: `workspace-${activeContext.id}-${Date.now()}`,
    title: safeString(source.title, "AI Workbench", 72),
    summary: safeString(
      source.summary,
      "AI generated a modular learning workspace from the selected passage.",
      260,
    ),
    sourceContextId: activeContext.id,
    modules: modules.slice(0, 8),
    actions: undefined,
  };
};

export function AiWorkbench({
  contextItems,
  modelConfig,
  paper,
  paperTextPages,
}: AiWorkbenchProps) {
  const [revision, setRevision] = useState(0);
  const activeContext = contextItems[0];
  const fallbackWorkspace = useMemo(
    () => createFallbackWorkspaceSpec(activeContext, revision),
    [activeContext, revision],
  );
  const [workspace, setWorkspace] = useState<WorkspaceSpec | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const spec = workspace ?? fallbackWorkspace;

  useEffect(() => {
    setWorkspace(null);
    setStatus("idle");
    setError(null);
    setRevision((value) => value + 1);
  }, [activeContext?.id]);

  useEffect(() => {
    recordLearningEvent({
      id: makeId(),
      type: workspace ? "workspace_generate" : "workspace_preview",
      paperId: paper.id,
      contextId: activeContext?.id,
      createdAt: new Date().toISOString(),
      metadata: {
        workspaceId: spec.id,
        moduleCount: spec.modules.length,
      },
    });
  }, [activeContext?.id, paper.id, spec.id, spec.modules.length, workspace]);

  const generateWorkspace = async () => {
    if (!activeContext?.text.trim()) {
      setStatus("error");
      setError("Select a PDF paragraph before generating a workspace.");
      return;
    }

    setStatus("loading");
    setError(null);

    const messages: AiMessage[] = [
      {
        id: makeId(),
        role: "user",
        // 这一步会把“当前选区 + 论文上下文摘录”一起写进 prompt，
        // 所以工作区生成并不是只基于一小段孤立文本。
        content: buildWorkspacePrompt({
          activeContext,
          paper,
          paperContext: buildPaperContextExcerpt(
            paperTextPages,
            activeContext.pageNumber,
          ),
        }),
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 5200),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 2),
        ],
        messages,
      });
      const rawSpec = parseModelJsonObject(response?.content || "");
      const nextWorkspace = normalizeWorkspaceSpec(rawSpec, activeContext);
      setWorkspace(nextWorkspace);
      setStatus("done");
    } catch (generationError) {
      const message =
        generationError instanceof Error
          ? generationError.message
          : "Workspace generation failed.";
      setWorkspace(null);
      setRevision((value) => value + 1);
      setStatus("error");
      setError(message);
    }
  };

  const statusText =
    status === "loading"
      ? "Generating workspace..."
      : status === "done"
        ? "AI workspace loaded"
        : status === "error"
          ? error
          : activeContext
            ? "Ready to generate workspace"
            : "Select a paragraph in the PDF first";

  return (
    <div className="aiWorkbench compactWorkbench">
      <section className="workspaceHeader compactWorkspaceHeader">
        <div className="workspaceTitleBlock">
          <span className="workspaceEyebrow">
            {workspace ? "AI" : "Preview"} - Page{" "}
            {activeContext?.pageNumber || "sample"}
          </span>
          <strong title={spec.title}>{spec.title}</strong>
          <p>{clip(spec.summary, 120)}</p>
          <span className={`workspaceState ${status === "error" ? "error" : ""}`}>
            {statusText}
          </span>
        </div>
        <button
          type="button"
          className="ghostButton compactButton"
          disabled={status === "loading" || !activeContext}
          onClick={() => void generateWorkspace()}
        >
          {status === "loading" ? <RefreshCcw size={13} /> : <Sparkles size={13} />}
          <span>{status === "loading" ? "Working" : "Generate"}</span>
        </button>
      </section>

      <WorkspacePageRenderer
        contextItems={contextItems}
        modelConfig={modelConfig}
        paper={paper}
        paperTextPages={paperTextPages}
        workspace={spec}
      />
    </div>
  );
}

function WorkspacePageRenderer({
  contextItems,
  modelConfig,
  paper,
  paperTextPages,
  workspace,
}: {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  paper: PaperDocument;
  paperTextPages: PaperTextPage[];
  workspace: WorkspaceSpec;
}) {
  const visualModule = workspace.modules.find((module) => module.type === "visual");
  const supportModules = workspace.modules
    .filter((module) => module.type !== "visual")
    .slice(0, 3);

  return (
    <section className="workspacePage compactWorkspacePage">
      {visualModule ? (
        <section className="workspaceBlock visualWorkspaceBlock" id={visualModule.id}>
          <WorkspaceModuleView
            contextItems={contextItems}
            module={visualModule}
            modelConfig={modelConfig}
            paper={paper}
            paperTextPages={paperTextPages}
          />
        </section>
      ) : null}

      {supportModules.length ? (
        <section className="workspaceEssentials" aria-label="Key learning notes">
          {supportModules.map((module) => (
            <section className="workspaceBlock compactSupportBlock" id={module.id} key={module.id}>
              <WorkspaceModuleView
                contextItems={contextItems}
                module={module}
                modelConfig={modelConfig}
                paper={paper}
                paperTextPages={paperTextPages}
              />
            </section>
          ))}
        </section>
      ) : null}
    </section>
  );
}

const actionLabel = (action: WorkspaceAction, modules: WorkspaceModule[]) => {
  if (action.type === "focus_block") {
    return `跳转到 ${modules.find((module) => module.id === action.blockId)?.title ?? "模块"}`;
  }

  if (action.type === "focus_pdf_context") {
    return "回到论文选区";
  }

  if (action.type === "open_learning_report") {
    return "打开学习报告";
  }

  return "查看工作区";
};

function WorkspaceModuleView({
  contextItems,
  modelConfig,
  module,
  paper,
  paperTextPages,
}: {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  module: WorkspaceModule;
  paper: PaperDocument;
  paperTextPages: PaperTextPage[];
}) {
  useEffect(() => {
    recordLearningEvent({
      id: makeId(),
      type:
        module.type === "formula"
          ? "formula_view"
          : module.type === "insight"
            ? "insight_view"
            : "module_view",
      paperId: paper.id,
      moduleId: module.id,
      moduleType: module.type,
      createdAt: new Date().toISOString(),
      metadata: {
        title: module.title,
      },
    });
  }, [module.id, module.title, module.type, paper.id]);

  if (module.type === "visual") {
    return (
      <VisualLab
        contextItems={contextItems}
        hideGenerate
        modelConfig={modelConfig}
        paper={paper}
        paperTextPages={paperTextPages}
        specOverride={module.visual}
      />
    );
  }

  if (module.type === "formula") {
    return <FormulaModuleView module={module} />;
  }

  if (module.type === "experiment") {
    return <ExperimentModuleView module={module} paperId={paper.id} />;
  }

  return <InsightModuleView module={module} />;
}

function FormulaModuleView({ module }: { module: FormulaWorkspaceModule }) {
  return (
    <div className="workspaceModule formulaModule">
      <ModuleIntro module={module} />
      <div className="formulaExpression">{module.formula.expression}</div>
      <p className="moduleParagraph">{module.formula.plainLanguage}</p>
      <div className="formulaVariableGrid compactFormulaVariables">
        {module.formula.variables.slice(0, 4).map((variable) => (
          <div className="formulaVariable" key={variable.symbol}>
            <strong>{variable.symbol}</strong>
            <span>{variable.meaning}</span>
            {variable.role ? <em>{variable.role}</em> : null}
          </div>
        ))}
      </div>
      <div className="derivationList">
        {module.formula.derivationSteps.slice(0, 3).map((step, index) => (
          <div className="derivationStep" key={`${step.title}-${index}`}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentModuleView({
  module,
  paperId,
}: {
  module: ExperimentWorkspaceModule;
  paperId: string;
}) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      module.experiment.parameters.map((parameter) => [
        parameter.id,
        parameter.defaultValue,
      ]),
    ),
  );
  const energy = module.experiment.parameters.length
    ? module.experiment.parameters.reduce((total, parameter) => {
        const value = values[parameter.id] ?? parameter.defaultValue;
        const normalized =
          parameter.max === parameter.min
            ? 0.5
            : (value - parameter.min) / (parameter.max - parameter.min);
        return total + Math.min(Math.max(normalized, 0), 1);
      }, 0) / module.experiment.parameters.length
    : 0.5;

  useEffect(() => {
    setValues(
      Object.fromEntries(
        module.experiment.parameters.map((parameter) => [
          parameter.id,
          parameter.defaultValue,
        ]),
      ),
    );
  }, [module.id, module.experiment.parameters]);

  return (
    <div className="workspaceModule experimentModule">
      <ModuleIntro module={module} />
      <p className="moduleParagraph">{module.experiment.objective}</p>
      <div className="experimentSurface compactExperimentSurface">
        <div className="experimentCurve" style={{ ["--energy" as string]: energy }}>
          {Array.from({ length: 10 }).map((_, index) => (
            <span
              key={`bar-${index}`}
              style={{
                height: `${22 + Math.sin(index * 0.7 + energy * 4) * 10 + energy * 46}px`,
              }}
            />
          ))}
        </div>
        <div className="experimentMetrics">
          {module.experiment.metrics.slice(0, 3).map((metric) => {
            const directionalFactor =
              metric.direction === "lower-better" ? 1 - energy : energy;
            const value = Math.min(
              Math.max(metric.baseline * 0.55 + directionalFactor * 0.45, 0),
              1,
            );
            return (
              <div className="experimentMetric" key={metric.id}>
                <span>{metric.label}</span>
                <strong>
                  {metric.unit === "%"
                    ? `${Math.round(value * 100)}%`
                    : `${value.toFixed(2)}${metric.unit ? ` ${metric.unit}` : ""}`}
                </strong>
                <div className="metricTrack">
                  <i style={{ width: `${value * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="experimentControls">
        {module.experiment.parameters.slice(0, 3).map((parameter) => (
          <label className="visualSliderRow" key={parameter.id}>
            <span>{parameter.label}</span>
            <input
              type="range"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={values[parameter.id] ?? parameter.defaultValue}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                setValues((current) => ({
                  ...current,
                  [parameter.id]: nextValue,
                }));
                recordLearningEvent({
                  id: makeId(),
                  type: "slider_change",
                  paperId,
                  moduleId: module.id,
                  moduleType: module.type,
                  createdAt: new Date().toISOString(),
                  metadata: {
                    parameterId: parameter.id,
                    value: nextValue,
                  },
                });
              }}
            />
            <strong>
              {values[parameter.id] ?? parameter.defaultValue}
              {parameter.unit ? ` ${parameter.unit}` : ""}
            </strong>
          </label>
        ))}
      </div>
      <div className="observationList">
        {module.experiment.observations.slice(0, 2).map((observation, index) => (
          <p key={`${observation}-${index}`}>{observation}</p>
        ))}
      </div>
    </div>
  );
}

function InsightModuleView({ module }: { module: InsightWorkspaceModule }) {
  return (
    <div className="workspaceModule insightModule">
      <ModuleIntro module={module} />
      <InsightGroup title="核心贡献" items={module.insight.keyPoints} />
      <InsightGroup title="关键假设" items={module.insight.assumptions} />
      <InsightGroup title="可能局限" items={module.insight.limitations} />
      <InsightGroup title="下一步追问" items={module.insight.nextQuestions} />
    </div>
  );
}

function ModuleIntro({ module }: { module: WorkspaceModule }) {
  return (
    <div className="moduleIntro">
      <span>{moduleMeta[module.type].label}</span>
      <strong>{module.title}</strong>
      {module.summary ? <p>{module.summary}</p> : null}
    </div>
  );
}

function InsightGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="insightGroup">
      <strong>{title}</strong>
      {items.map((item, index) => (
        <p key={`${title}-${index}`}>{item}</p>
      ))}
    </section>
  );
}
