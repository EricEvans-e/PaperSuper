# PaperSuper Architecture

Last updated: 2026-05-03

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
  - Registers `paperSuper:log` for renderer-to-main file logging.
  - Owns global UI zoom shortcuts and persists the zoom factor in Electron `userData`.
- `apps/desktop/electron/preload.ts`
  - Exposes `openPdfFile`, `adjustUiZoom`, `sendAiMessage`, `sendAiMessageStream`, `onAiStreamEvent`, and `log`.
- `apps/desktop/electron/logger.ts`
  - Writes main and renderer log lines to `userData/logs/papersuper-YYYY-MM-DD.log`.
  - Keeps logging best-effort so file write failures do not crash the app.
- `apps/desktop/electron/ai.ts`
  - Validates model config.
  - Builds the research assistant system prompt.
  - Sends requests to OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages.
  - Parses normal JSON responses and SSE streaming responses.
  - Applies a 300-second timeout to non-streaming AI requests so larger structured generation calls can finish before local abort.
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
- `apps/desktop/src/components/AiWorkbench.tsx`
  - Renders the right AI Workbench as a page-style modular learning workspace.
  - Generates and validates `WorkspaceSpec` JSON from the newest selected PDF context item.
  - Provides Visual, Formula, Experiment, and Insight modules.
  - Renders modules as scrollable page blocks with a compact block navigator.
  - Defines the first-pass UI action and learning-event bridge for later left-agent control.
  - Uses local preview modules when AI generation fails or no passage is selected.
- `apps/desktop/src/components/VisualLab.tsx`
  - Renders the Visual module inside the right AI Workbench.
  - Provides S/B/A modes. S mode is the preferred generated view for paper-style SVG principle/structure diagrams.
  - S mode uses a two-phase multi-facet generation: Phase 1 asks AI for 3-4 facet definitions `[{title, focus}]`, Phase 2 generates each facet's SVG in parallel with progressive loading.
  - S mode renders facets as switchable tabs with Ctrl+wheel zoom (0.3x–3x), double-click reset, and expand/collapse toggle.
  - B mode renders a self-contained HTML/JS teaching lesson inside a sandboxed iframe.
  - Generates B-mode code through a manual raw-HTML AI call after structured `VisualSpec` JSON is available, avoiding large HTML/CSS/JS strings inside JSON.
  - Generates a local B-mode fallback lesson from safe `VisualSpec` data when raw AI HTML is missing, unsafe, or too incomplete to teach the selected mechanism.
  - Keeps A mode as the structured React/SVG fallback with playback state, focused steps, and parameter sliders.
  - A mode prefers `mechanismBrief`, `principleDiagram`, and the `VisualSpec.scene` mechanism track when present, rendering regions, units, operations, and active steps through local React/SVG.
  - Normalizes AI-provided scene coordinates, rejects broken or overlapping region layouts, inherits missing unit placements, and reindexes units by region/lane to avoid collapsed diagrams.
  - Supports both legacy `nodes` / `edges` flow diagrams and richer declarative `visualElements` such as matrices, layer stacks, formulas, brackets, bars, axes, annotations, and arrows.
  - Can still generate a standalone `VisualSpec`, but the right-side primary flow now comes through `AiWorkbench` and `WorkspaceSpec`.
  - Extracts, lightly repairs, and validates model JSON before rendering; failed generation falls back to a local preview scene.
- `apps/desktop/src/visualSimulation.ts`
  - Computes the local Visual Lab A-mode simulation state from `VisualSpec.parameters` and current slider values.
  - Infers or uses `VisualSpec.simulation.model` for teaching-oriented models such as KV cache layout, attention flow, memory transfer, pipeline, or generic flow.
  - Returns derived values for sequence length, KV pairs, interleave stride, block size, GPU lanes, bandwidth, block counts, locality, utilization, speed, and display metrics.
- `apps/desktop/src/components/AiChatPanel.tsx`
  - Renders the left AI chat pane, Markdown AI answers, and stream event updates.
- `apps/desktop/src/utils.ts`
  - Provides shared renderer helpers.
  - `parseModelJsonObject` extracts model JSON from fenced/plain responses, repairs common comma issues, and throws clearer diagnostics when parsing still fails.
  - `extractJsonCandidate` supports both `{...}` objects and `[...]` arrays — arrays are extracted when `[` appears before the first `{`.
- `apps/desktop/src/log.ts`
  - Logs to renderer DevTools and forwards structured log events to main through `window.paperSuper.log`.

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
8. The translation popup is draggable by its header; regenerate and close buttons stop pointer propagation so they remain functional during drag.
9. Right-clicking while the translation popup is open closes it without stopping event propagation, so the next right-click reaches the highlight underneath and opens a new translation menu.
10. The highlight action menu uses CSS `pointer-events: none` on the container and `pointer-events: auto` on the translate button, so right-clicking the menu area passes through to the highlight and the menu reappears immediately.
11. Translation is non-streaming in the current version; the existing streaming path remains reserved for the left AI chat.

### Streaming AI Chat

1. User submits a message in the left `AiChatPanel`.
2. Renderer appends a user message and an empty assistant message.
3. Renderer calls `window.paperSuper.sendAiMessageStream(requestId, request)`.
4. Main process calls `streamAiCompletion`.
5. `ai.ts` parses provider SSE events and emits text deltas.
6. Main process forwards deltas through `paperSuper:aiStreamEvent`.
7. Renderer appends deltas into the assistant message.

### AI Workbench

1. User opens the AI activity in the right workbench.
2. `Workbench` passes the current `contextItems` into `AiWorkbench`.
3. User clicks `Generate` after selecting a paragraph or region in the PDF.
4. `AiWorkbench` asks the current AI provider for strict `WorkspaceSpec` JSON using `window.paperSuper.sendAiMessage`.
5. The workbench shell remains structured JSON. It must not include HTML, JavaScript, CSS, SVG markup, executable code, or `htmlDemo`.
6. The renderer extracts and validates the JSON into safe local primitives.
7. `AiWorkbench` renders modules as a single scrollable page with Overview, Visual, Formula, Experiment, and Insight blocks.
8. The compact navigator scrolls to each block rather than replacing content.
9. `WorkspaceAction` supports first-pass UI intents such as `focus_block`, `focus_pdf_context`, `open_workspace`, and `open_learning_report`.
10. Local learning events are dispatched as `papersuper:learning-event` for workspace generation, preview rendering, module views, UI actions, and slider changes.
11. The Visual module passes a validated `VisualSpec` into `VisualLab`.
12. The Formula module renders expression, plain-language explanation, variables, and derivation steps.
13. The Experiment module renders parameter sliders, local computed metrics, a lightweight teaching curve, and observations.
14. The Insight module renders key points, assumptions, limitations, and next questions.
15. VisualLab receives the validated `VisualSpec` and shows local preview/fallback content without calling AI again.
16. When the user clicks VisualLab `生成可视化`, VisualLab generates three AI visual tracks in parallel: raw HTML for B mode, multi-facet SVG for S mode, and a text explanation.
17. S mode Phase 1 asks AI for 3-4 facet definitions `[{title, focus}]` identifying distinct visual aspects of the concept.
18. S mode Phase 2 generates each facet's `<svg>` in parallel. Each facet completes independently; `setSvgFacets` updates progressively so the first-to-return facet displays immediately as a switchable tab.
19. Each facet's SVG is sanitized by `sanitizeSvg` which removes scripts, event handlers, `foreignObject`, external links, and overlong payloads before rendering.
20. After manual visual generation succeeds, VisualLab switches to S mode by default so the first generated result is a principle diagram rather than a generic flow diagram.
21. S mode SVG supports Ctrl+wheel zoom (0.3x–3x), double-click reset, and an expand/collapse toolbar.
22. B mode asks for raw self-contained HTML/SVG/JS code, not JSON.
23. `extractHtmlFragment` accepts raw HTML or a single fenced ```html block, strips document wrappers, and passes the fragment to `normalizeHtmlDemo`.
24. If the raw HTML passes the unsafe/incomplete-demo check, B mode renders it in the iframe sandbox with CSP.
25. If raw HTML is missing, unsafe, or too incomplete to teach the mechanism, B mode generates a local self-contained teaching lesson from the structured `VisualSpec`.
26. The fallback lesson chooses a layout tendency from the semantic/template/title, such as memory prefetch, attention matrix, architecture, comparison, or generic mechanism.
27. KV interleaving/consolidation has a dedicated B-mode fallback lesson: separated K cache / V cache rows, animated K_i + V_i pairing, interleaved `[K_i|V_i]` output, token/group/speed sliders, and live I/O reduction metrics.
28. A mode draws the structured fallback scene with React/SVG instead of executing generated code.
29. A mode prefers `mechanismBrief`, `principleDiagram`, and `VisualSpec.scene` for mechanism-first diagrams. The renderer turns AI-provided regions, units, operations, and steps into a stable SVG animation.
30. `normalizeMechanismScene` treats model coordinates as flexible input: `0..1` values become normalized canvas coordinates, `0..100` values become percentages, and invalid or heavily overlapping regions fall back to a stable local layout.
31. Scene unit placement inherits missing `lane` / `index` values, reindexes units by region/lane, and applies KV-specific lanes for K cache, V cache, and interleaved `[K|V]` outputs.
32. A mode falls back to semantic diagrams or the legacy visual canvas when no `scene` exists.
33. A mode renders `nodes` / `edges` for flow-like explanations and overlays safe declarative `visualElements` when the passage needs structure diagrams, attention matrices, tensor grids, formulas, brackets, bars, or annotations.
34. A-mode parameter sliders update `parameterValues`, then `computeVisualSimulation` recomputes a local teaching simulation.
35. The simulation state drives visible SVG changes: K/V cache block counts, token-wise interleaving blocks, block transfer count, GPU lane count, metric cards, and packet animation speed.
36. Individual `visualElements` can bind to a `parameterId`, allowing sliders to change matrix intensity, layer count, circle size, bar fill, or rectangle size without executing generated code.
37. B-mode HTML demos remain isolated in the existing iframe sandbox.
38. If generation fails or JSON is invalid, the panel keeps a local preview workspace and displays the error.

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

### PDF Highlight Layer Rendering

1. `PdfHighlighter` renders highlight overlays as children of each page's `textLayer.div`, positioned via `findOrCreateContainerLayer`.
2. The highlight layer uses `z-index: 3 !important` to beat the PDF.js rule `.textLayer > :not(.markedContent) { z-index: 1 }` which has higher specificity (0,2,0) than a single-class selector.
3. `onTextLayerRendered` re-appends the highlight layer div after text spans to fix a DOM order race condition on the first page, where the RAF from `pagerendered` can execute before text stream processing completes.
4. Native `::selection` color is set to `rgba(255, 226, 143, 1)` to match the highlight overlay color, eliminating a visible color flash during selection.
5. Selection debounce is 200ms (reduced from 500ms), so highlight overlays appear faster after text selection.

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
- `WorkspaceSpec`: modular right-side AI Workbench scene generated from selected paper context
- `WorkspaceModule`: Visual, Formula, Experiment, or Insight module
- `WorkspaceAction`: first-pass intent object for focusing blocks, selected PDF context, or future report views
- `LearningEvent`: local event shape dispatched for future learning analytics and left-agent coordination
- `VisualSpec`: structured visualization scene rendered locally in the right AI Workspace
- `VisualSemanticSpec`: semantic source-of-truth object/flow/takeaway track for Visual Lab
- `VisualMechanismBrief`: short source-of-truth explanation of the mechanism, objects, causal chain, learning goal, and takeaway
- `VisualPrincipleDiagram`: static principle/structure diagram with regions, relations, annotations, and takeaway
- `VisualMechanismScene`: mechanism-first visual scene with regions, units, operations, placements, and teaching steps
- `VisualHtmlDemo`: self-contained HTML/JS demo rendered only inside the Visual Lab iframe sandbox
- Sanitized SVG principle diagram: renderer state only, generated by the S-mode AI request and never persisted in `VisualSpec`
- `SvgFacet`: multi-facet SVG state with `title`, `focus`, `svg`, `status`, and `error` fields; S mode generates 3-4 facets in parallel
- `VisualSimulationSpec`: optional model hint for the local Visual Lab simulation engine
- `VisualElement`: safe declarative SVG primitive for richer A-mode diagrams
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
- Right AI Workbench includes a page-style Overview plus Visual, Formula, Experiment, and Insight blocks.
- The Visual module includes Visual Lab with S/B/A mode switching. S is the preferred generated mode for multi-facet principle/structure diagrams with tab switching and Ctrl+wheel zoom.
- B mode uses safe raw AI HTML generated only after the user manually requests visual generation and otherwise generates a local fallback lesson from `VisualSpec`.
- A-mode local SVG rendering remains available as a manual structured fallback; it prefers `principleDiagram` and mechanism `scene` diagrams, then semantic diagrams, and can still combine flow nodes, edges, simulation layers, and declarative visual elements for non-flowchart diagrams.
- Draggable vertical split handles between left/PDF and PDF/right zones.
- Compact chat styling at narrow widths, with auto-collapse below the threshold and same-drag reopen when the pointer moves back right.

The AI chat has streaming and Markdown support. As of 2026-04-30, it is implemented as a collapsible and manually resizable left pane controlled by the activity bar.
