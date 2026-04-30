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
