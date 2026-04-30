# PaperSuper Architecture

Last updated: 2026-04-30

## Overview

PaperSuper is a desktop-only Electron app. The renderer is a React research IDE shell. The Electron main process owns native capabilities such as opening local PDF files and sending AI HTTP requests.

The app deliberately keeps the renderer away from direct Node access. Renderer code calls a small preload bridge exposed as `window.paperSuper`.

## Runtime Processes

```text
Renderer React UI
  -> window.paperSuper preload bridge
  -> Electron ipcMain handlers
  -> local filesystem dialog / AI provider HTTP requests
```

## Main Modules

- `apps/desktop/electron/main.ts`
  - Creates the desktop window.
  - Registers `paperSuper:openPdfFile`.
  - Registers non-streaming and streaming AI IPC handlers.
- `apps/desktop/electron/preload.ts`
  - Exposes `openPdfFile`, `sendAiMessage`, `sendAiMessageStream`, and `onAiStreamEvent`.
- `apps/desktop/electron/ai.ts`
  - Validates model config.
  - Builds the research assistant system prompt.
  - Sends requests to OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages.
  - Parses normal JSON responses and SSE streaming responses.
- `apps/desktop/src/App.tsx`
  - Owns top-level renderer state: active activity, current paper, PDF URL, highlights, selected AI context, messages, model config, and split pane width.
- `apps/desktop/src/components/PdfReaderPane.tsx`
  - Loads PDF.js worker.
  - Wraps `react-pdf-highlighter`.
  - Handles text/area highlights, click-to-context capture, and selected-context capture.
- `apps/desktop/src/components/Workbench.tsx`
  - Renders Paper, AI, and Settings in the upper right workbench area.
  - Hosts the resizable lower AI chat panel.
- `apps/desktop/src/components/AiChatPanel.tsx`
  - Renders Markdown AI answers and listens for stream events.

## Data Flow

### Open Local PDF

1. User clicks Open PDF.
2. Renderer calls `window.paperSuper.openPdfFile()`.
3. Main process opens a native file dialog and reads the selected PDF.
4. Renderer creates a Blob URL from the returned `ArrayBuffer`.
5. `PdfReaderPane` reloads the PDF from the Blob URL.

### Add PDF Content To AI Context

1. User clicks text, selects text, or draws a visual region in the PDF.
2. `PdfReaderPane` creates an `AI Context` highlight.
3. `App` stores an `AiContextItem` with the linked highlight id.
4. The right workbench does not render a context list.
5. AI chat includes the stored context text in later prompts.
6. Clicking an `AI Context` highlight again removes only that linked context item.
7. Clicking blank space inside the PDF viewer clears all `AI Context` highlights and linked context items.

### Streaming AI Chat

1. User submits a message in `Workbench`.
2. Renderer appends a user message and an empty assistant message.
3. Renderer calls `window.paperSuper.sendAiMessageStream(requestId, request)`.
4. Main process calls `streamAiCompletion`.
5. `ai.ts` parses provider SSE events and emits text deltas.
6. Main process forwards deltas through `paperSuper:aiStreamEvent`.
7. Renderer appends deltas into the assistant message.

## Provider Support

| Provider ID | Endpoint shape | Notes |
| --- | --- | --- |
| `openai-chat` | `/v1/chat/completions` | Also tries `/chat/completions` for compatible gateways. |
| `openai-responses` | `/v1/responses` | Falls back to chat format when the Responses endpoint is missing. |
| `anthropic` | `/v1/messages` | Sends `anthropic-version: 2023-06-01`. |

`endpointCandidates` in `apps/desktop/electron/ai.ts` accepts either a base URL or a full endpoint URL.

## Data Types

The shared renderer/main request contracts live in `apps/desktop/src/types.ts`.

- `ActivityId`: `paper`, `ai`, `settings`
- `AiProvider`: `openai-chat`, `openai-responses`, `anthropic`
- `PaperDocument`: current paper metadata
- `ModelConfig`: provider, base URL, API key, model, max token cap
- `AiContextItem`: selected PDF context sent to AI
- `AiMessage`: chat message state
- `AiCompletionRequest`: full payload sent to the main process
- `AiStreamEvent`: `delta`, `done`, or `error`

## Security Boundaries

- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- The preload bridge exposes only the minimal PaperSuper API.
- API keys currently live in renderer `localStorage`, which is acceptable for prototype work only.

## Layout Status

The app uses a dark IDE shell with a light PDF reading pane. The workspace has:

- Left PDF pane.
- Draggable vertical split handle.
- Right workbench pane split into an upper tool area and lower AI chat.

The AI chat has streaming and Markdown support. As of 2026-04-30, it is implemented as a resizable lower window inside the right workbench.
