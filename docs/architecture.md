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
  - Owns global UI zoom shortcuts and persists the zoom factor in Electron `userData`.
- `apps/desktop/electron/preload.ts`
  - Exposes `openPdfFile`, `adjustUiZoom`, `sendAiMessage`, `sendAiMessageStream`, and `onAiStreamEvent`.
- `apps/desktop/electron/ai.ts`
  - Validates model config.
  - Builds the research assistant system prompt.
  - Sends requests to OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages.
  - Parses normal JSON responses and SSE streaming responses.
- `apps/desktop/src/App.tsx`
  - Owns top-level renderer state: active activity, current paper, PDF URL, highlights, selected AI context, messages, model config, and workspace layout.
  - Renders the three-zone workspace grid: AI chat, PDF reader, split handles, and right workbench.
  - Persists chat visibility, left chat width, and right workbench width in renderer `localStorage`.
- `apps/desktop/src/components/PdfReaderPane.tsx`
  - Loads PDF.js worker.
  - Wraps `react-pdf-highlighter`.
  - Handles text highlights, sentence-level click-to-context capture, and selected-context capture.
  - Extracts PDF page text in the background for contextual highlight translation.
- `apps/desktop/src/components/Workbench.tsx`
  - Renders Paper, AI, and Settings in the right reserved workbench area.
- `apps/desktop/src/components/VisualLab.tsx`
  - Renders the right AI Workspace visualization scene.
  - Uses local structured `VisualSpec` data, SVG rendering, playback state, focused steps, and parameter sliders for A mode.
  - Renders self-contained AI-generated HTML/JS demos inside a sandboxed iframe for B mode.
  - Calls the existing `window.paperSuper.sendAiMessage` bridge to generate both `VisualSpec` JSON and `htmlDemo` from the newest selected PDF context item.
  - Extracts and validates model JSON before rendering; failed generation falls back to a local preview scene.
- `apps/desktop/src/components/AiChatPanel.tsx`
  - Renders the left AI chat pane, Markdown AI answers, and stream event updates.

## Data Flow

### Open Local PDF

1. User clicks Open PDF.
2. Renderer calls `window.paperSuper.openPdfFile()`.
3. Main process opens a native file dialog and reads the selected PDF.
4. Renderer creates a Blob URL from the returned `ArrayBuffer`.
5. `PdfReaderPane` reloads the PDF from the Blob URL.

### Add PDF Content To AI Context

1. User clicks text, selects text, or Alt-drags a text region in the PDF.
2. `PdfReaderPane` creates an `AI Context` highlight.
3. `App` stores an `AiContextItem` with the linked highlight id.
4. The right workbench does not render a context list.
5. Single-click capture uses the clicked caret position and nearby sentence boundaries, capped by a small character window.
6. AI chat includes stored text context in later prompts. Alt-dragged regions use a temporary rectangle to extract matching text-layer spans, then store normal text highlight rects instead of a retained area box.
7. No screenshots are sent to the model for Alt-drag context.
8. Clicking an `AI Context` highlight again removes only that linked context item.
9. Clicking blank space inside the PDF viewer clears all `AI Context` highlights and linked context items.

### Translate Highlight

1. User right-clicks an `AI Context` text highlight.
2. `PdfReaderPane` opens a compact action menu with `翻译`.
3. `PdfReaderPane` dynamically merges same-page, same-column, visually adjacent `AI Context` text highlights around the right-clicked highlight.
4. Merge adjacency is calculated from each highlight's line-level normalized rects, allowing small whitespace gaps, wrapped lines, and slight text-layer offsets without merging across clearly different columns.
5. When translation starts, `PdfReaderPane` builds a focused translation prompt from the merged highlight text, current paper title, existing selected context, and background-extracted PDF page text.
6. Renderer calls `window.paperSuper.sendAiMessage` with the current `ModelConfig`; no chat history is appended.
7. The result renders as Markdown in a floating panel near the PDF highlight with close and regenerate controls.
8. Translation is non-streaming in the current version; the existing streaming path remains reserved for the left AI chat.

### Streaming AI Chat

1. User submits a message in the left `AiChatPanel`.
2. Renderer appends a user message and an empty assistant message.
3. Renderer calls `window.paperSuper.sendAiMessageStream(requestId, request)`.
4. Main process calls `streamAiCompletion`.
5. `ai.ts` parses provider SSE events and emits text deltas.
6. Main process forwards deltas through `paperSuper:aiStreamEvent`.
7. Renderer appends deltas into the assistant message.

### AI Visual Lab

1. User opens the AI activity in the right workbench.
2. `Workbench` passes the current `contextItems` into `VisualLab`.
3. User clicks `Generate` after selecting a paragraph or region in the PDF.
4. `VisualLab` asks the current AI provider for strict JSON containing both `VisualSpec` and `htmlDemo` using `window.paperSuper.sendAiMessage`.
5. The renderer extracts and validates the JSON into safe local primitives.
6. A mode draws the scene with React/SVG instead of executing generated code.
7. B mode injects the returned HTML body fragment into an iframe with `sandbox="allow-scripts"` and a restrictive CSP that disables network connections and external resources.
8. Playback controls advance focused explanation steps in A mode.
9. Parameter sliders update local visualization state such as visual energy, data count, and active window size in A mode; the HTML demo owns its internal sliders and recomputation in B mode.
10. If generation fails or JSON is invalid, the panel keeps a local preview scene and displays the error.

### Global UI Zoom

1. Main process listens to `before-input-event` on the window web contents.
2. `Ctrl/Cmd + +` or `Ctrl/Cmd + =` increases the Electron `webContents` zoom factor by 0.1.
3. `Ctrl/Cmd + -` decreases the zoom factor by 0.1.
4. `Ctrl/Cmd + 0` resets the zoom factor to 1.0.
5. The zoom factor is clamped from 0.75 to 1.5 and persisted to `userData/papersuper-settings.json`.
6. Renderer also captures the same shortcuts and calls `window.paperSuper.adjustUiZoom` as a keyboard-layout fallback.
7. This is app-level UI zoom and is intentionally separate from PDF reader zoom.

### PDF Reader Zoom

1. `PdfReaderPane` owns a local `pdfScale` state.
2. Ctrl/Cmd + mouse wheel inside `.pdfSurface` prevents the default browser zoom path.
3. Wheel-up increases `pdfScale` by 0.1; wheel-down decreases it by 0.1.
4. The PDF reader zoom is clamped from 0.5 to 2.5.
5. `PdfReaderPane` passes the numeric scale as `pdfScaleValue` to `PdfHighlighter`.
6. `PdfHighlighter` reapplies `viewer.currentScaleValue` when `pdfScaleValue` changes so PDF.js rerenders the pages.
7. `PdfHighlighter` queues highlight-layer refreshes on `pdfScaleValue` changes plus PDF.js `scalechanging`, `pagerendered`, and `textlayerrendered` events, keeping existing highlights aligned after scaling.
8. The PDF zoom label is displayed in the PDF pane header and is not persisted yet.

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
- `VisualSpec`: structured visualization scene rendered locally in the right AI Workspace
- `VisualHtmlDemo`: self-contained HTML/JS demo rendered only inside the Visual Lab iframe sandbox
- `VisualNode`, `VisualEdge`, `VisualParameter`, and `VisualStep`: renderer-owned visual scene primitives

## Security Boundaries

- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- The preload bridge exposes only the minimal PaperSuper API.
- API keys currently live in renderer `localStorage`, which is acceptable for prototype work only.

## Layout Status

The app uses a dark IDE shell with a light PDF reading pane. The workspace has:

- Collapsible left AI chat pane.
- Center PDF pane.
- Right reserved workbench pane for Paper, AI, and Settings tools.
- Right AI Workspace includes a Visual Lab with A/B mode switching between local SVG rendering and sandboxed HTML/JS demos.
- Draggable vertical split handles between left/PDF and PDF/right zones.
- Compact chat styling at narrow widths, with auto-collapse below the threshold and same-drag reopen when the pointer moves back right.

The AI chat has streaming and Markdown support. As of 2026-04-30, it is implemented as a collapsible and manually resizable left pane controlled by the activity bar.
