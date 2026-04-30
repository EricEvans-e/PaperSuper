import {
  Beaker,
  BookOpenText,
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
  ModelConfig,
  PaperDocument,
  VisualParameter,
  VisualSpec,
  WorkspaceModule,
  WorkspaceModuleType,
  WorkspaceSpec,
} from "../types";
import { makeId } from "../utils";
import { createMockVisualSpec, normalizeVisualSpec, VisualLab } from "./VisualLab";

interface AiWorkbenchProps {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  paper: PaperDocument;
}

type GenerationStatus = "idle" | "loading" | "done" | "error";

const moduleMeta: Record<
  WorkspaceModuleType,
  {
    label: string;
    icon: typeof Brain;
  }
> = {
  visual: { label: "Visual", icon: Brain },
  formula: { label: "Formula", icon: FunctionSquare },
  experiment: { label: "Experiment", icon: Beaker },
  insight: { label: "Insight", icon: Lightbulb },
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

const buildWorkspacePrompt = ({
  activeContext,
  paper,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
}) =>
  [
    "You generate a modular AI Workbench for PaperSuper.",
    "Return ONLY valid JSON. Do not wrap it in Markdown. Do not include comments.",
    "Do NOT generate HTML, JavaScript, CSS, SVG markup, or executable code.",
    "The JSON must describe local safe modules rendered by PaperSuper.",
    "The JSON must match this TypeScript-like shape:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "modules": [',
    '    {"id": string, "type": "visual", "title": string, "summary": string, "visual": VisualSpec},',
    '    {"id": string, "type": "formula", "title": string, "summary": string, "formula": {"expression": string, "plainLanguage": string, "variables": [{"symbol": string, "meaning": string, "role": string}], "derivationSteps": [{"title": string, "detail": string}]}},',
    '    {"id": string, "type": "experiment", "title": string, "summary": string, "experiment": {"objective": string, "parameters": [{"id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number, "unit": string}], "metrics": [{"id": string, "label": string, "baseline": number, "direction": "higher-better" | "lower-better" | "neutral", "unit": string}], "observations": string[]}},',
    '    {"id": string, "type": "insight", "title": string, "summary": string, "insight": {"keyPoints": string[], "assumptions": string[], "limitations": string[], "nextQuestions": string[]}}',
    "  ]",
    "}",
    "",
    "VisualSpec requirements:",
    "- Use the same VisualSpec fields as PaperSuper A mode: title, kind, summary, nodes, edges, visualElements, parameters, steps, simulation.",
    "- Do not include htmlDemo in the visual module.",
    "- Use visualElements for architecture, matrices, tensor grids, formulas, bars, brackets, axes, annotations, arrows, and non-flowchart diagrams.",
    "- Use Simplified Chinese for user-visible text, but keep technical terms like token, KV cache, GPU kernel, attention, softmax, query, key, value in English when clearer.",
    "",
    "Workbench requirements:",
    "- Always include exactly one visual module.",
    "- Include one formula module if the passage contains formulas, algorithmic transformations, variables, or tensor operations.",
    "- Include one experiment module with 2 to 4 meaningful sliders and 2 to 4 metrics.",
    "- Include one insight module that explains contribution, assumptions, limitations, and next questions.",
    "- Keep content concise and useful for learning the selected paper passage.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
  ].join("\n");

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
  };
};

export function AiWorkbench({
  contextItems,
  modelConfig,
  paper,
}: AiWorkbenchProps) {
  const [revision, setRevision] = useState(0);
  const activeContext = contextItems[0];
  const fallbackWorkspace = useMemo(
    () => createFallbackWorkspaceSpec(activeContext, revision),
    [activeContext, revision],
  );
  const [workspace, setWorkspace] = useState<WorkspaceSpec | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string>(
    fallbackWorkspace.modules[0].id,
  );
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const spec = workspace ?? fallbackWorkspace;
  const activeModule =
    spec.modules.find((module) => module.id === activeModuleId) ?? spec.modules[0];

  useEffect(() => {
    setWorkspace(null);
    setStatus("idle");
    setError(null);
    setRevision((value) => value + 1);
  }, [activeContext?.id]);

  useEffect(() => {
    setActiveModuleId(spec.modules[0]?.id ?? "");
  }, [spec.id]);

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
        content: buildWorkspacePrompt({ activeContext, paper }),
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 2600),
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
      const rawSpec = extractJsonObject(response?.content || "");
      const nextWorkspace = normalizeWorkspaceSpec(rawSpec, activeContext);
      setWorkspace(nextWorkspace);
      setActiveModuleId(nextWorkspace.modules[0].id);
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
    <div className="aiWorkbench">
      <section className="workspaceHeader">
        <div className="workspaceTitleBlock">
          <span className="workspaceEyebrow">
            {workspace ? "AI workspace" : "Local preview"} - Page{" "}
            {activeContext?.pageNumber || "sample"}
          </span>
          <strong title={spec.title}>{spec.title}</strong>
          <p>{spec.summary}</p>
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

      <nav className="workspaceTabs" aria-label="AI workspace modules">
        {spec.modules.map((module) => {
          const meta = moduleMeta[module.type];
          const Icon = meta.icon;
          return (
            <button
              type="button"
              className={`workspaceTab ${module.id === activeModule.id ? "active" : ""}`}
              key={module.id}
              onClick={() => setActiveModuleId(module.id)}
            >
              <Icon size={13} />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="workspaceModuleShell">
        <WorkspaceModuleView
          contextItems={contextItems}
          module={activeModule}
          modelConfig={modelConfig}
          paper={paper}
        />
      </section>

      <section className="workspaceStatus">
        <BookOpenText size={13} />
        <span className={status === "error" ? "error" : ""}>{statusText}</span>
      </section>
    </div>
  );
}

function WorkspaceModuleView({
  contextItems,
  modelConfig,
  module,
  paper,
}: {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  module: WorkspaceModule;
  paper: PaperDocument;
}) {
  if (module.type === "visual") {
    return (
      <VisualLab
        contextItems={contextItems}
        hideGenerate
        modelConfig={modelConfig}
        paper={paper}
        specOverride={module.visual}
      />
    );
  }

  if (module.type === "formula") {
    return <FormulaModuleView module={module} />;
  }

  if (module.type === "experiment") {
    return <ExperimentModuleView module={module} />;
  }

  return <InsightModuleView module={module} />;
}

function FormulaModuleView({ module }: { module: FormulaWorkspaceModule }) {
  return (
    <div className="workspaceModule formulaModule">
      <ModuleIntro module={module} />
      <div className="formulaExpression">{module.formula.expression}</div>
      <p className="moduleParagraph">{module.formula.plainLanguage}</p>
      <div className="formulaVariableGrid">
        {module.formula.variables.map((variable) => (
          <div className="formulaVariable" key={variable.symbol}>
            <strong>{variable.symbol}</strong>
            <span>{variable.meaning}</span>
            {variable.role ? <em>{variable.role}</em> : null}
          </div>
        ))}
      </div>
      <div className="derivationList">
        {module.formula.derivationSteps.map((step, index) => (
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

function ExperimentModuleView({ module }: { module: ExperimentWorkspaceModule }) {
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
      <div className="experimentSurface">
        <div className="experimentCurve" style={{ ["--energy" as string]: energy }}>
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={`bar-${index}`}
              style={{
                height: `${22 + Math.sin(index * 0.7 + energy * 4) * 10 + energy * 46}px`,
              }}
            />
          ))}
        </div>
        <div className="experimentMetrics">
          {module.experiment.metrics.map((metric) => {
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
        {module.experiment.parameters.map((parameter) => (
          <label className="visualSliderRow" key={parameter.id}>
            <span>{parameter.label}</span>
            <input
              type="range"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={values[parameter.id] ?? parameter.defaultValue}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [parameter.id]: Number(event.target.value),
                }))
              }
            />
            <strong>
              {values[parameter.id] ?? parameter.defaultValue}
              {parameter.unit ? ` ${parameter.unit}` : ""}
            </strong>
          </label>
        ))}
      </div>
      <div className="observationList">
        {module.experiment.observations.map((observation, index) => (
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
