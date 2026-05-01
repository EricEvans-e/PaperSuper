export type ActivityId = "paper" | "ai" | "settings";
export type AiProvider = "openai-chat" | "openai-responses" | "anthropic";

export interface PaperDocument {
  id: string;
  title: string;
  sourceType: "sample" | "file";
  url?: string;
  fileName?: string;
  openedAt: string;
}

export interface PaperTextPage {
  pageNumber: number;
  text: string;
}

export interface ModelConfig {
  provider: AiProvider;
  apiBase: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface AiContextItem {
  id: string;
  text: string;
  highlightId?: string;
  pageNumber?: number;
  createdAt: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isLocal?: boolean;
}

export interface AiCompletionRequest {
  config: ModelConfig;
  paperTitle: string;
  contextItems: AiContextItem[];
  messages: AiMessage[];
}

export interface AiCompletionResponse {
  content: string;
}

export type VisualKind =
  | "concept-flow"
  | "mechanism-animation"
  | "equation-playground"
  | "comparison"
  | "architecture"
  | "matrix"
  | "geometry"
  | "timeline";

export type VisualDiagramType =
  | "structure"
  | "mechanism"
  | "equation"
  | "matrix"
  | "comparison"
  | "timeline"
  | "geometry";

export type VisualSemanticTemplate =
  | "memory-prefetch-pipeline"
  | "memory-hierarchy"
  | "attention-matrix"
  | "model-architecture"
  | "equation-transform"
  | "comparison-tradeoff"
  | "timeline-stage"
  | "generic-mechanism";

export type VisualNodeTone = "blue" | "green" | "amber" | "rose" | "neutral";

export interface VisualNode {
  id: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  tone: VisualNodeTone;
}

export interface VisualEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  strength: number;
}

export interface VisualParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export interface VisualStep {
  id: string;
  title: string;
  description: string;
  focusNodeIds: string[];
  focusElementIds?: string[];
}

export type VisualElementKind =
  | "rect"
  | "circle"
  | "text"
  | "formula"
  | "matrix"
  | "layer"
  | "bracket"
  | "annotation"
  | "bar"
  | "axis"
  | "arrow";

export interface VisualElement {
  id: string;
  kind: VisualElementKind;
  label?: string;
  detail?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  tone?: VisualNodeTone;
  value?: number;
  rows?: number;
  cols?: number;
  cells?: number[];
  points?: Array<{ x: number; y: number }>;
  targetId?: string;
  parameterId?: string;
}

export interface VisualHtmlDemo {
  title: string;
  html: string;
  notes?: string;
}

export type VisualSimulationModel =
  | "generic-flow"
  | "kv-cache-layout"
  | "attention-flow"
  | "memory-transfer"
  | "pipeline";

export interface VisualSimulationSpec {
  model: VisualSimulationModel;
  description?: string;
}

export interface VisualSemanticObject {
  id: string;
  label: string;
  role: string;
  detail?: string;
}

export interface VisualSemanticFlow {
  from: string;
  to: string;
  label: string;
  detail?: string;
}

export interface VisualSemanticSpec {
  template: VisualSemanticTemplate;
  problem: string;
  mechanism: string[];
  keyObjects: VisualSemanticObject[];
  flows: VisualSemanticFlow[];
  takeaway: string;
}

export interface VisualMechanismBrief {
  mechanismName: string;
  coreProblem: string;
  keyObjects: Array<{
    id: string;
    label: string;
    role: string;
    evidence?: string;
  }>;
  causalChain: string[];
  learningGoal: string;
  takeaway: string;
}

export type VisualPrincipleDiagramKind =
  | "structure-map"
  | "mechanism-map"
  | "matrix-map"
  | "equation-map"
  | "comparison-map"
  | "timeline-map"
  | "geometry-map";

export type VisualPrincipleRelationType =
  | "causes"
  | "depends-on"
  | "transfers"
  | "transforms"
  | "predicts"
  | "compares"
  | "contains";

export interface VisualPrincipleRegion {
  id: string;
  label: string;
  role: string;
  detail?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: VisualNodeTone;
}

export interface VisualPrincipleRelation {
  id: string;
  from: string;
  to: string;
  label: string;
  detail?: string;
  relationType?: VisualPrincipleRelationType;
}

export interface VisualPrincipleAnnotation {
  id: string;
  targetId?: string;
  label: string;
  detail?: string;
  x?: number;
  y?: number;
  tone?: VisualNodeTone;
}

export interface VisualPrincipleDiagram {
  title: string;
  diagramKind: VisualPrincipleDiagramKind;
  centralClaim: string;
  regions: VisualPrincipleRegion[];
  relations: VisualPrincipleRelation[];
  annotations: VisualPrincipleAnnotation[];
  takeaway: string;
}

export type VisualMechanismSceneKind =
  | "layout-transform"
  | "dataflow"
  | "matrix-computation"
  | "architecture-assembly"
  | "state-transition"
  | "comparison-mechanism"
  | "geometric-process"
  | "generic-mechanism";

export type VisualMechanismOperation =
  | "move"
  | "pair"
  | "merge"
  | "split"
  | "reorder"
  | "broadcast"
  | "filter"
  | "accumulate"
  | "lookup"
  | "transform"
  | "compare"
  | "compute";

export interface VisualMechanismRegion {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: VisualNodeTone;
}

export interface VisualMechanismUnit {
  id: string;
  label: string;
  kind: string;
  regionId: string;
  lane?: number;
  index?: number;
  tone?: VisualNodeTone;
  pairWith?: string;
  value?: string;
  detail?: string;
}

export interface VisualMechanismUnitPlacement {
  unitId: string;
  regionId: string;
  lane?: number;
  index?: number;
  hidden?: boolean;
}

export interface VisualMechanismStepSpec {
  id: string;
  title: string;
  description: string;
  operation: VisualMechanismOperation;
  activeUnitIds: string[];
  fromRegionId?: string;
  toRegionId?: string;
  resultUnitIds?: string[];
  placements?: VisualMechanismUnitPlacement[];
  parameterEffects?: string[];
}

export interface VisualMechanismScene {
  title: string;
  sceneKind: VisualMechanismSceneKind;
  purpose: string;
  regions: VisualMechanismRegion[];
  units: VisualMechanismUnit[];
  steps: VisualMechanismStepSpec[];
  takeaway: string;
}

export interface VisualSpec {
  id: string;
  title: string;
  kind: VisualKind;
  diagramType?: VisualDiagramType;
  diagramPurpose?: string;
  readerTakeaway?: string;
  semantic?: VisualSemanticSpec;
  mechanismBrief?: VisualMechanismBrief;
  principleDiagram?: VisualPrincipleDiagram;
  scene?: VisualMechanismScene;
  sourceContextId?: string;
  summary: string;
  nodes: VisualNode[];
  edges: VisualEdge[];
  parameters: VisualParameter[];
  steps: VisualStep[];
  visualElements?: VisualElement[];
  simulation?: VisualSimulationSpec;
  htmlDemo?: VisualHtmlDemo;
  /** AI-generated inline SVG diagram for high-fidelity principle illustration. */
  svgDiagram?: string;
}

export type WorkspaceModuleType = "visual" | "formula" | "experiment" | "insight";

export type WorkspaceBlockType = WorkspaceModuleType | "overview";

export interface WorkspaceSpec {
  id: string;
  title: string;
  summary: string;
  sourceContextId?: string;
  modules: WorkspaceModule[];
  actions?: WorkspaceAction[];
}

export interface WorkspaceModuleBase {
  id: string;
  type: WorkspaceModuleType;
  title: string;
  summary?: string;
}

export interface VisualWorkspaceModule extends WorkspaceModuleBase {
  type: "visual";
  visual: VisualSpec;
}

export interface FormulaWorkspaceModule extends WorkspaceModuleBase {
  type: "formula";
  formula: {
    expression: string;
    plainLanguage: string;
    variables: Array<{
      symbol: string;
      meaning: string;
      role?: string;
    }>;
    derivationSteps: Array<{
      title: string;
      detail: string;
    }>;
  };
}

export interface ExperimentWorkspaceModule extends WorkspaceModuleBase {
  type: "experiment";
  experiment: {
    objective: string;
    parameters: VisualParameter[];
    metrics: Array<{
      id: string;
      label: string;
      baseline: number;
      direction?: "higher-better" | "lower-better" | "neutral";
      unit?: string;
    }>;
    observations: string[];
  };
}

export interface InsightWorkspaceModule extends WorkspaceModuleBase {
  type: "insight";
  insight: {
    keyPoints: string[];
    assumptions: string[];
    limitations: string[];
    nextQuestions: string[];
  };
}

export type WorkspaceModule =
  | VisualWorkspaceModule
  | FormulaWorkspaceModule
  | ExperimentWorkspaceModule
  | InsightWorkspaceModule;

export type WorkspaceAction =
  | {
      type: "open_workspace";
      workspaceId: string;
    }
  | {
      type: "focus_block";
      blockId: string;
    }
  | {
      type: "focus_pdf_context";
      contextId: string;
      highlightId?: string;
    }
  | {
      type: "open_learning_report";
    };

export type LearningEventType =
  | "workspace_generate"
  | "workspace_preview"
  | "workspace_action"
  | "module_view"
  | "slider_change"
  | "formula_view"
  | "insight_view";

export interface LearningEvent {
  id: string;
  type: LearningEventType;
  paperId: string;
  contextId?: string;
  moduleId?: string;
  moduleType?: WorkspaceModuleType;
  createdAt: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export type AiStreamEvent =
  | {
      requestId: string;
      type: "delta";
      delta: string;
    }
  | {
      requestId: string;
      type: "done";
    }
  | {
      requestId: string;
      type: "error";
      error: string;
    };
