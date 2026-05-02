# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # launch Electron app in dev mode (via scripts/run-electron-vite.cjs)
npm run build        # type-check (tsc --noEmit) then production build
npm run preview      # preview production build
```

The build helper `scripts/run-electron-vite.cjs` clears `ELECTRON_RUN_AS_NODE` before spawning `electron-vite` — required on Windows. Always run electron-vite through the npm scripts, not directly.

There are no automated tests for the main app. The vendored `react-pdf-highlighter/` has Playwright E2E tests (`npm run test:e2e` from that directory).

## Architecture

PaperSuper is an Electron + React + TypeScript desktop app — a PDF-first AI research IDE. The build system is electron-vite with Vite.

### Three-process model

```
Renderer (React)  →  window.paperSuper (preload bridge, 6 methods)  →  Electron Main (ipcMain)
                                                                              |
                                                                      +-----+------+
                                                                      |            |
                                                               Native dialog   AI HTTP clients
                                                               (fs.readFile)   (OpenAI / Anthropic)
                                                                      |            |
                                                                      v            v
                                                              PDF ArrayBuffer   SSE stream events
```

- **Main process**: `apps/desktop/electron/main.ts` (window, menu, zoom, IPC), `ai.ts` (HTTP clients for 3 providers with SSE streaming)
- **Preload**: `apps/desktop/electron/preload.ts` — exposes only `window.paperSuper` with 6 methods: `openPdfFile`, `adjustUiZoom`, `sendAiMessage`, `sendAiMessageStream`, `onAiStreamEvent`, `log`
- **Renderer**: `apps/desktop/src/` — React app with `@desktop` path alias resolving to this directory

### Key modules

| File | Role |
|---|---|
| `apps/desktop/electron/ai.ts` | All AI provider HTTP logic (OpenAI Chat, OpenAI Responses, Anthropic). SSE parsing, 300s timeout, endpoint fallback |
| `apps/desktop/electron/logger.ts` | Best-effort main/renderer file logging under Electron `userData/logs` |
| `apps/desktop/src/App.tsx` | Root component. Owns all top-level state, three-zone grid layout, split-handle resizing, localStorage persistence |
| `apps/desktop/src/components/AiWorkbench.tsx` | Generates `WorkspaceSpec` JSON from AI, renders page-style workspace with Overview/Visual/Formula/Experiment/Insight blocks |
| `apps/desktop/src/components/VisualLab.tsx` | Largest file (~5K lines). Visual module with S/B/A modes. S mode: sanitized AI SVG principle diagrams. B mode: sandboxed iframe HTML/JS via separate AI code generation. A mode: structured React/SVG with mechanism scenes and simulations |
| `apps/desktop/src/components/PdfReaderPane.tsx` | PDF viewer with text/sentence click-to-context, Alt-drag region extraction, highlight translation, PDF-only zoom |
| `apps/desktop/src/utils.ts` | `parseModelJsonObject()` — defensive JSON parser handling fenced code blocks, trailing commas, and missing commas with stack-based repair |
| `apps/desktop/src/log.ts` | Renderer logging helper that prints to DevTools and forwards to `window.paperSuper.log` |
| `apps/desktop/src/visualSimulation.ts` | Local parameter-driven simulation engine for A-mode Visual Lab |
| `apps/desktop/src/types.ts` | All shared type contracts |
| `react-pdf-highlighter/` | Vendored source (NOT a submodule). Wrapped via `apps/desktop/src/pdf-highlighter.ts` |

### Three-zone layout

The UI is a dark IDE shell: activity bar (far left) → collapsible AI chat pane (left) → PDF reader (center) → workbench pane (right). Draggable vertical handles between zones. Layout widths persisted in `localStorage` under `papersuper:workspace-layout`.

### AI provider support

Three provider IDs: `openai-chat`, `openai-responses`, `anthropic`. Settings stored in localStorage. Streaming uses `sendAiMessageStream`; workbench/translation uses non-streaming `sendAiMessage` with the 300s timeout.

## Editing Rules

These are the critical rules to follow when modifying code:

### Security boundaries

- **Renderer must never get broad Node APIs.** All native access goes through `window.paperSuper` in preload. Keep `nodeIntegration: false`, `contextIsolation: true`.
- **Provider HTTP logic stays in `apps/desktop/electron/ai.ts`.** Do not add fetch/HTTP calls to the renderer.
- **AI-generated HTML/JS runs only in the VisualLab iframe sandbox** with `sandbox="allow-scripts"` and CSP. Never run AI-generated code directly in the renderer.
- `normalizeHtmlDemo` rejects unsafe HTML patterns and incomplete demos — keep that validation working.
- **AI-generated SVG principle diagrams are untrusted too.** Render them only after `sanitizeSvg` removes scripts, event handlers, `foreignObject`, external links, and overlong payloads.
- API keys live in renderer localStorage — treat as prototype-only, not production.

### Zoom — two separate systems

- **Global app zoom**: Electron main via `webContents.setZoomFactor` (75%–150%, persisted to `userData/papersuper-settings.json`). Renderer calls `adjustUiZoom` preload fallback only for keyboard layout compatibility.
- **PDF-only zoom**: renderer state via `pdfScaleValue` (50%–250%, not persisted). Controlled by Ctrl+wheel inside the PDF pane. Do not mix these two systems.

### AI Workbench / Visual Lab

- `AiWorkbench` requests structured `WorkspaceSpec` JSON only. **Never put HTML, JS, CSS, SVG, or executable code inside Workbench JSON.**
- Visual Lab is the visual block within the workbench, not the whole right-side product.
- **S mode is the preferred generated view** for paper-style principle/structure diagrams. Preserve the S/B/A mode split and default to S after successful full generation.
- **Multi-track visual generation**: first parse structured `VisualSpec` JSON, then request sanitized inline SVG for S mode and raw HTML/SVG/JS for B mode. B mode falls back to local lessons when raw HTML is missing or unsafe.
- A-mode `VisualSpec` can include `mechanismBrief`, `principleDiagram`, `scene`, `semantic`, `visualElements`, `nodes`/`edges`. `scene` is the preferred mechanism-first track.
- Do not trust AI-provided `scene` coordinates — keep `normalizeMechanismScene`, region fallback, placement inheritance, and unit reindexing in place.
- A-mode parameters must flow through `computeVisualSimulation`; sliders must visibly recompute local state.
- KV/cache layout scenes should preserve stable K lane, V lane, animated K/V pairing, and interleaved KV output lane behavior.

### PDF context behavior

- AI context highlights use `comment.text === "AI Context"`.
- Clicking PDF text / selecting text / Alt-dragging a region auto-adds AI context and creates a text highlight.
- Single-click context uses caret position + sentence boundaries with a bounded character window — do not revert to broad line capture.
- Alt-dragged regions extract text-layer spans and convert to text rects — no rectangular area highlights, no screenshots to AI.
- Clicking an existing AI Context highlight removes that single item. Clicking blank space clears all.
- Translation (right-click AI Context highlight) dynamically merges same-page, same-column, visually adjacent highlights using line-level rects, not just bounding boxes.

### Vendored dependency

- `react-pdf-highlighter/` is vendored source committed directly, not a submodule.
- Prefer app-level wrappers before editing vendored internals. The import bridge is `apps/desktop/src/pdf-highlighter.ts`.
- Use `parseModelJsonObject` for any AI JSON that may be fenced, have trailing commas, or missing commas. Keep the stack-based array/property repair intact.
