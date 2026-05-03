# PaperSuper Agent Notes

Last updated: 2026-05-02

## Project Shape

PaperSuper is an Electron + React + TypeScript desktop prototype for a PDF-first AI research IDE.

- Renderer app: `apps/desktop/src`
- Electron main/preload: `apps/desktop/electron`
- AI HTTP clients: `apps/desktop/electron/ai.ts`
- Global UI zoom shortcuts and persistence: `apps/desktop/electron/main.ts`
- PDF wrapper export: `apps/desktop/src/pdf-highlighter.ts`
- Right AI Workbench container: `apps/desktop/src/components/AiWorkbench.tsx`
- Visual Lab renderer and HTML sandbox: `apps/desktop/src/components/VisualLab.tsx`
- Visual Lab local simulation engine: `apps/desktop/src/visualSimulation.ts`
- Shared renderer helpers, including AI JSON parsing repair: `apps/desktop/src/utils.ts`
- Main/renderer logging bridge: `apps/desktop/electron/logger.ts`, `apps/desktop/src/log.ts`
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
- Keep the right side organized around page-style `WorkspaceSpec` modules in `AiWorkbench`; `VisualLab` is the visual block, not the whole right-side product.
- `AiWorkbench` has a first-pass UI action/event protocol: `WorkspaceAction` describes UI intents, and learning events are dispatched as `papersuper:learning-event` browser events.
- `AiWorkbench` should request structured `WorkspaceSpec` JSON only for the workbench shell. Do not put HTML, JavaScript, CSS, SVG markup, executable code, or `htmlDemo` inside Workbench JSON.
- Visual Lab has three modes: S for AI-generated sanitized SVG principle diagrams, B for sandboxed HTML/SVG/JS demos, and A for structured local React/SVG. S/B provider calls are manual: selecting PDF context or receiving `specOverride` should only prepare local preview state, not automatically call AI.
- Visual Lab B mode uses a manual follow-up flow: after a structured `VisualSpec` exists, the user clicks `生成可视化` / `Generate` before VisualLab asks AI for raw sandbox HTML/SVG/JS code. It falls back to local lessons when raw HTML is missing, unsafe, or too incomplete.
- Do not reintroduce a `useEffect` that calls `sendAiMessage` from `VisualLab` merely because `activeContext`, `specOverride`, or `hideGenerate` changed; this caused repeated unwanted AI requests while selecting paper context.
- Visual Lab A mode is the structured fallback/manual alternative. Keep right-side structured visualization work in renderer-owned `VisualSpec` data and local React/SVG rendering.
- A-mode `VisualSpec` can include both legacy `nodes` / `edges` and richer declarative `visualElements`; prefer adding safe SVG primitives over executing generated code.
- A-mode `VisualSpec` can also include `semantic` and `scene`; `scene` is the preferred mechanism-first track for diagrams that need regions, concrete units, operations, and step animation.
- A-mode `VisualSpec` can include `mechanismBrief` and `principleDiagram`; use them to explain the paper mechanism before the step animation.
- Do not trust AI-provided `scene` coordinates blindly. Keep `normalizeMechanismScene`, region fallback, placement inheritance, and unit reindexing in place so normalized coordinates, overlapping regions, or missing `lane` / `index` values cannot collapse the SVG into the top-left corner.
- KV/cache layout scenes should preserve the stable K lane, V lane, animated K/V pairing, and interleaved KV output lane behavior unless a later renderer intentionally replaces it.
- Visual Lab A mode parameters should flow through `computeVisualSimulation`; sliders must visibly recompute local state, not only update numeric labels.
- HTML/JS visual demos must stay inside the `VisualLab` iframe sandbox with CSP; do not run AI-generated HTML/JS directly in the renderer.
- Treat AI-generated HTML/JS as untrusted teaching/demo content. It may run only in the sandboxed iframe and must not get renderer, Node, network, or file access.
- `normalizeHtmlDemo` rejects obvious unsafe HTML patterns and incomplete demos, including missing sliders, missing `recalc()`, or KV demos without K/V/interleaving structure; keep that fallback path working.
- AI-generated SVG principle diagrams are inserted with `dangerouslySetInnerHTML` only after `sanitizeSvg` removes scripts, event handlers, foreignObject, external links, and overlong payloads. Keep that sanitizer intact.
- `window.paperSuper.log` forwards renderer logs to the main process file logger. Keep logging fire-and-forget and do not expose filesystem paths or Node APIs to the renderer.
- Use `parseModelJsonObject` for model JSON payloads that may be fenced, have trailing commas, or be missing commas. `extractJsonCandidate` supports both `{...}` objects and `[...]` arrays.
- Keep the stack-based array/property repair in `parseModelJsonObject`; it intentionally handles model output where an object array ends with a value like `"unit": "GB/s" }` and then starts the next property without the missing `],`.
- API keys currently live in renderer `localStorage`; treat that as prototype-only.

## PDF Context Behavior

- AI context highlights use `comment.text === "AI Context"`.
- The right workbench does not render a selected-context list; PDF highlights are the visible source of truth.
- The AI activity in the right workbench renders `AiWorkbench`; it can call the current AI provider to generate a modular `WorkspaceSpec` from the newest selected context item, with local preview fallback.
- Clicking PDF text, selecting text, or Alt-dragging a text region auto-adds AI context and creates a text highlight.
- Single-click context uses caret position plus sentence boundaries with a bounded character window; do not revert it to broad previous/current/next-line capture.
- Alt-dragged regions extract matching text-layer spans, convert them to text highlight rects, and do not keep a rectangular area highlight or send screenshots to AI providers.
- Right-clicking an `AI Context` text highlight opens a translate action and floating Markdown translation panel.
- Translation dynamically merges same-page, same-column, visually adjacent `AI Context` text highlights around the right-clicked highlight; this affects only the translation source and does not mutate highlights.
- Translation merge adjacency uses each highlight's line-level rects rather than only its outer bounding box, so small whitespace gaps, wrapped lines, and slight PDF text-layer offsets should still merge.
- Translation reuses `window.paperSuper.sendAiMessage` with the current `ModelConfig`, selected highlight text, existing selected context, and background-extracted PDF page text.
- Translation popup is draggable by its header; regenerate and close buttons stop mouse propagation so they remain functional during drag.
- The highlight action menu uses CSS `pointer-events: none` on the container and `pointer-events: auto` on the translate button so right-clicks pass through to the highlight underneath.
- Right-clicking while the translation popup is open closes it without `stopPropagation`, so the next right-click reaches the highlight and opens a new menu.
- The highlight layer z-index uses `!important` to beat the PDF.js specificity override; `onTextLayerRendered` re-appends the highlight layer div to fix first-page DOM order.
- Selection debounce is 200ms; native `::selection` color matches the highlight overlay color `#FFE28F`.
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

Non-streaming AI requests use a 300-second timeout in `apps/desktop/electron/ai.ts`. This longer window is intentional because Visual Lab and AI Workbench generation can request large structured JSON.

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
- right AI Workbench renders a page-style workspace with Visual, Formula, Experiment, and Insight blocks plus compact block navigation; the Visual block contains Visual Lab with S/B/A mode switching, sanitized SVG principle diagrams, B-mode sandbox mechanism lessons, playback, step focus, parameter sliders, local simulation metrics, and declarative SVG fallback rendering
- Visual Lab S mode uses two-phase multi-facet generation: Phase 1 asks AI for 3-4 facet definitions `[{title, focus}]`, Phase 2 generates each facet's SVG in parallel with progressive loading. Facets display as switchable tabs with Ctrl+wheel zoom (0.3x–3x), double-click reset, and expand/collapse toggle
- Visual Lab B mode prefers safe raw AI HTML generated by the manual visual-generation action, then falls back to any legacy `htmlDemo`, then the local self-contained lesson generated by `createFallbackHtmlDemo`; KV interleaving/consolidation has a dedicated fallback that shows separated K/V rows, animated pairing, interleaved `[K_i|V_i]` output, sliders, and I/O metrics
- Visual Lab A mode prefers `principleDiagram` plus the local `scene` renderer when present, then falls back to semantic diagrams or the legacy visual canvas
- draggable vertical handles between the three zones
- compact AI chat styling at narrow widths, with drag-to-collapse and same-drag reopen behavior

As of 2026-04-30, AI chat is no longer inside the right workbench. `App` owns the three-zone grid, renders `AiChatPanel` as the collapsible left pane, and persists workspace widths in `localStorage` under `papersuper:workspace-layout`.
