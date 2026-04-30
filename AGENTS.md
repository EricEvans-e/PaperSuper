# PaperSuper Agent Notes

Last updated: 2026-04-30

## Project Shape

PaperSuper is an Electron + React + TypeScript desktop prototype for a PDF-first AI research IDE.

- Renderer app: `apps/desktop/src`
- Electron main/preload: `apps/desktop/electron`
- AI HTTP clients: `apps/desktop/electron/ai.ts`
- Global UI zoom shortcuts and persistence: `apps/desktop/electron/main.ts`
- PDF wrapper export: `apps/desktop/src/pdf-highlighter.ts`
- Vendored PDF base: `react-pdf-highlighter/`
- Docs: `docs/`

## Commands

Use root scripts:

```bash
npm install
npm run dev
npm run build
npm run preview
```

The helper `scripts/run-electron-vite.cjs` clears `ELECTRON_RUN_AS_NODE`; keep using it through npm scripts.

## Important Rules

- `react-pdf-highlighter/` is vendored source inside the main repository, not a submodule.
- Prefer app-level wrappers and components before editing vendored `react-pdf-highlighter` internals.
- Keep renderer access to native capabilities behind `window.paperSuper` in preload.
- Do not expose broad Node APIs to the renderer.
- Keep provider HTTP logic in `apps/desktop/electron/ai.ts`.
- Keep global app zoom in Electron main via `webContents.setZoomFactor`; renderer may call the minimal `adjustUiZoom` preload fallback for keyboard layout compatibility.
- Keep PDF-only zoom in the renderer/PDF reader path via `pdfScaleValue`; do not mix it with global app zoom.
- Keep right-side structured visualization work in renderer-owned `VisualSpec` data and local React/SVG rendering.
- HTML/JS visual demos must stay inside the `VisualLab` iframe sandbox with CSP; do not run AI-generated HTML/JS directly in the renderer.
- API keys currently live in renderer `localStorage`; treat that as prototype-only.

## PDF Context Behavior

- AI context highlights use `comment.text === "AI Context"`.
- The right workbench does not render a selected-context list; PDF highlights are the visible source of truth.
- The AI activity in the right workbench renders `VisualLab`; it can call the current AI provider to generate both validated `VisualSpec` JSON and a self-contained HTML/JS sandbox demo from the newest selected context item, with local preview fallback.
- Clicking PDF text, selecting text, or Alt-dragging a text region auto-adds AI context and creates a text highlight.
- Single-click context uses caret position plus sentence boundaries with a bounded character window; do not revert it to broad previous/current/next-line capture.
- Alt-dragged regions extract matching text-layer spans, convert them to text highlight rects, and do not keep a rectangular area highlight or send screenshots to AI providers.
- Right-clicking an `AI Context` text highlight opens a translate action and floating Markdown translation panel.
- Translation dynamically merges same-page, same-column, visually adjacent `AI Context` text highlights around the right-clicked highlight; this affects only the translation source and does not mutate highlights.
- Translation merge adjacency uses each highlight's line-level rects rather than only its outer bounding box, so small whitespace gaps, wrapped lines, and slight PDF text-layer offsets should still merge.
- Translation reuses `window.paperSuper.sendAiMessage` with the current `ModelConfig`, selected highlight text, existing selected context, and background-extracted PDF page text.
- Clicking an existing `AI Context` highlight removes that single context item.
- Clicking any blank space in the PDF viewer clears all `AI Context` highlights and linked context items.

## Current AI Support

Supported provider IDs:

- `openai-chat`
- `openai-responses`
- `anthropic`

Streaming flow:

`AiChatPanel` -> `window.paperSuper.sendAiMessageStream` -> `ipcMain` -> `streamAiCompletion` -> `paperSuper:aiStreamEvent` -> renderer message updates.

OpenAI-compatible gateways often support only Chat Completions. For a 404 on `/v1/responses`, switch to `openai-chat` or verify the gateway supports the Responses API.

## Current Zoom Support

Global app zoom:

- `Ctrl/Cmd + +` and `Ctrl/Cmd + =` zoom in.
- `Ctrl/Cmd + -` zooms out.
- `Ctrl/Cmd + 0` resets to 100%.
- Zoom range is 75% to 150%, step 10%.
- The setting is stored in Electron `userData/papersuper-settings.json`.

PDF reader zoom:

- `Ctrl/Cmd + mouse wheel` inside the PDF pane zooms only the PDF view.
- PDF reader zoom range is 50% to 250%, step 10%.
- PDF reader zoom is currently renderer state, not persisted.
- `PdfHighlighter` refreshes highlight layers on `pdfScaleValue` changes plus PDF.js `scalechanging`, `pagerendered`, and `textlayerrendered` events so selected context highlights stay aligned after zoom.

## Layout Notes

The current UI is a dark IDE shell with:

- activity bar on the far left
- title bar at the top
- collapsible AI chat pane on the left, toggled from the activity bar
- PDF pane in the center
- reserved workbench pane on the right for Paper/AI/Settings tools
- right AI Workspace renders a compact Visual Lab with A/B mode switching, playback, step focus, parameter sliders, and iframe sandbox HTML demos
- draggable vertical handles between the three zones
- compact AI chat styling at narrow widths, with drag-to-collapse and same-drag reopen behavior

As of 2026-04-30, AI chat is no longer inside the right workbench. `App` owns the three-zone grid, renders `AiChatPanel` as the collapsible left pane, and persists workspace widths in `localStorage` under `papersuper:workspace-layout`.
