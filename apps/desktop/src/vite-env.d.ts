/// <reference types="vite/client" />

import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiStreamEvent,
} from "./types";

interface OpenPdfFileResult {
  fileName: string;
  data: ArrayBuffer;
}

interface PaperSuperBridge {
  openPdfFile: () => Promise<OpenPdfFileResult | null>;
  adjustUiZoom: (action: "in" | "out" | "reset") => Promise<number>;
  sendAiMessage: (
    request: AiCompletionRequest,
  ) => Promise<AiCompletionResponse>;
  sendAiMessageStream: (
    requestId: string,
    request: AiCompletionRequest,
  ) => Promise<void>;
  onAiStreamEvent: (callback: (event: AiStreamEvent) => void) => () => void;
}

declare global {
  interface Window {
    paperSuper?: PaperSuperBridge;
  }
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

export {};
