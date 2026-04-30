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
  | "comparison";

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
}

export interface VisualHtmlDemo {
  title: string;
  html: string;
  notes?: string;
}

export interface VisualSpec {
  id: string;
  title: string;
  kind: VisualKind;
  sourceContextId?: string;
  summary: string;
  nodes: VisualNode[];
  edges: VisualEdge[];
  parameters: VisualParameter[];
  steps: VisualStep[];
  htmlDemo?: VisualHtmlDemo;
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
