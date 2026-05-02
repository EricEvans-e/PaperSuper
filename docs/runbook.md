# PaperSuper Runbook

Last updated: 2026-05-02

## Commands

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview built output:

```bash
npm run preview
```

`scripts/run-electron-vite.cjs` clears `ELECTRON_RUN_AS_NODE` before launching `electron-vite`. Keep using the root npm scripts instead of calling `electron-vite` directly on Windows.

## Smoke Test

1. Run `npm run dev`.
2. Confirm the Electron window opens.
3. Confirm the sample arXiv PDF renders.
4. Click text in the PDF and confirm only the nearby sentence is auto-highlighted and added to AI context.
5. Click the same highlighted context again and confirm it is removed from the PDF.
6. Add several context highlights, click blank PDF space, and confirm all AI context highlights are cleared.
7. Select text or Alt-drag a text region and verify it is auto-highlighted as text, counted as text AI context, and does not leave a rectangular area box.
8. Create several adjacent AI context highlights, including a wrapped line or a small visual gap, right-click one of them, choose `翻译`, and confirm the floating Markdown translation panel includes the adjacent highlighted sentences.
9. Open a local PDF with the title-bar Open PDF button.
10. Switch between Paper, AI, and Settings activities.
11. Toggle the left AI chat from the activity bar and confirm the PDF pane expands/collapses cleanly.
12. Drag the left split handle to a narrow width and confirm the chat becomes compact, auto-collapses below the threshold, and reopens if the still-held pointer is dragged back right.
13. Drag both vertical split handles and confirm the left chat, center PDF, and right workbench widths adjust without overlap.
14. Refresh/restart and confirm the adjusted workspace widths are retained.
15. Press `Ctrl/Cmd + +` or `Ctrl/Cmd + =`, `Ctrl/Cmd + -`, and `Ctrl/Cmd + 0`; confirm the whole app zooms and reset works.
16. Hold `Ctrl/Cmd` and scroll the mouse wheel inside the PDF pane; confirm only the PDF view zooms, the header percentage updates, and existing highlights stay aligned with the selected text or region.
17. Restart the app and confirm the last non-reset global zoom factor is retained.
18. Configure one AI provider and send a short prompt from the left AI chat.
19. Open the AI activity in the right workbench and confirm the AI Workbench renders a preview workspace.
20. Confirm the right workbench has a visible scrollbar when content exceeds the available height.
21. Use the compact block navigator and confirm it scrolls to Overview, Visual, Formula, Experiment, and Insight blocks.
22. Confirm selecting PDF text only updates highlights/local preview and does not automatically send VisualLab S/B generation requests.
23. In the right AI Workbench, click `Generate` and confirm it requests the configured AI provider and renders a generated `WorkspaceSpec` or a clear error fallback.
24. In the Visual module, click `生成可视化` and confirm S mode becomes active when generation completes.
25. In S mode, confirm multiple facet tabs appear (3-4 tabs with Chinese titles like "整体架构", "数据流"). Click each tab and confirm each shows a different focused SVG diagram.
26. In S mode, hold `Ctrl` and scroll the mouse wheel over the SVG area; confirm the diagram zooms in/out (0.3x–3x range). Double-click the SVG to reset to 100%. Confirm the toolbar shows the current zoom percentage and a 1:1 reset button.
27. Switch to B mode, move the sliders, and confirm the principle canvas, animation/highlighted blocks, live metrics, and step explanation update without leaving the sandbox.
28. Switch to A mode, use playback controls to advance steps, then move each slider and confirm the upper SVG visibly changes: K/V cache blocks, token-wise interleaving blocks, block transfer blocks, GPU lanes, metric cards, and packet speed should update.
29. In Visual A mode, confirm richer declarative elements can render in the preview or generated scene: matrix cells, layer stacks, formulas, bars, annotations, brackets, axes, or arrows should appear when present in `visualElements`.
30. In the Formula module, confirm expression, variables, and derivation steps fit and scroll if needed.
31. In the Experiment module, move sliders and confirm metrics plus the teaching curve update locally.
32. In the Insight module, confirm key points, assumptions, limitations, and next questions are visible.
33. Click an Overview suggested action and confirm the page scrolls to the target block.
34. Ask the AI chat to translate or explain the selected context.
35. Confirm streaming output appears as Markdown.
36. Check DevTools and the Electron `userData/logs/papersuper-YYYY-MM-DD.log` file for renderer/main log lines when diagnosing generation failures.
37. Run `npm run build`.

## AI Configuration

Use the Settings activity.

Recommended base URLs:

| Provider | API Base |
| --- | --- |
| OpenAI Chat Completions | `https://api.openai.com/v1` |
| OpenAI Responses | `https://api.openai.com/v1` |
| Anthropic Messages | `https://api.anthropic.com` |

For third-party OpenAI-compatible gateways:

- Use `OpenAI Chat Completions` first.
- Set `API Base` to either the provider base URL or the full chat completions endpoint.
- Only use `OpenAI Responses` when the gateway explicitly supports `/v1/responses`.

## Troubleshooting

### OpenAI 404 with `openresty`

The selected provider and API base probably do not match. Common fixes:

- Choose `OpenAI Chat Completions` for OpenAI-compatible gateways.
- Use `https://api.openai.com/v1` for official OpenAI endpoints.
- Avoid putting `/v1/responses` in `API Base` while also choosing a chat-only gateway.

### Anthropic works but OpenAI does not

This usually means the app wiring is fine and the OpenAI base URL, provider mode, or model name is wrong. Test the same key/base/model with a minimal curl request if needed.

### Streaming does not update

Check:

- `paperSuper:sendAiMessageStream` is exposed in `apps/desktop/electron/preload.ts`.
- `paperSuper:aiStreamEvent` is being sent from `apps/desktop/electron/main.ts`.
- The provider returns SSE chunks matching the parser in `apps/desktop/electron/ai.ts`.

### Highlight translation fails

Check:

- The Settings activity has a valid provider, API base, key, model, and token cap.
- The highlight was created as an `AI Context` text highlight.
- The PDF text extraction may still be running immediately after opening a large file; translation still works, but with less paper context until extraction finishes.

### PDF does not load

Check:

- The sample arXiv URL is reachable from the machine.
- Local PDF selection returns an `ArrayBuffer` from the main process.
- `pdfjs-dist/build/pdf.worker.min.mjs?url` still resolves in `PdfReaderPane`.

### AI chat area is hidden

The chat lives in the collapsible left pane. Use the chat button in the far-left activity bar to show or hide it. Drag the vertical split handles to rebalance the three zones. If it still disappears, check the `threeZoneWorkspace`, `workspaceSplitHandle`, and `aiChatPanel` styles.

### AI Workbench content is cut off

The right workbench should scroll as a whole. Check `.aiWorkbench` has `overflow: auto`, `.workspacePage` renders block content, and workspace blocks do not clip taller module content.

### AI Workbench block navigation does not move

Check:

- Each module section uses its module id as the DOM `id`.
- The Overview section uses `workspace-overview`.
- `focusBlock()` calls `scrollIntoView`.
- The right workbench outer container can scroll.

### Learning events are not visible in development

In development, `AiWorkbench` dispatches `papersuper:learning-event` browser events and logs them with `console.debug`. Check the browser devtools console and event listeners before adding persistence.

### Visual module S mode is blank or only shows one facet

Check:

- Selecting PDF context or loading a `VisualSpec` should not call `generateSvgFacets`; only the VisualLab `生成可视化` / standalone `Generate` action should do that.
- The manual visual-generation flow should call `generateSvgFacets` which runs Phase 1 (facet definitions) then Phase 2 (parallel SVG generation).
- `buildSvgFacetsPrompt` should ask AI for a JSON array `[{title, focus}]` with 3-4 distinct facets.
- `extractJsonCandidate` must support `[...]` arrays (not just `{...}` objects). If Phase 1 returns a JSON array and parsing fails, check that the array-first extraction path is intact.
- Phase 1 `maxTokens` should be at least 8000 to prevent truncated facet definitions.
- If only one facet appears, check the logs for `generateSvgFacets phase 1 failed` — this means the facet definition JSON was unparseable and fell back to a single default facet.
- `buildFacetSvgPrompt` should focus each facet on a distinct aspect (architecture, data flow, performance, etc.).
- `extractSvgDiagram` should accept a raw `<svg>` or fenced ```svg block.
- `sanitizeSvg` should reject unsafe or oversized SVG but keep valid diagrams. It strips scripts, event handlers, `foreignObject`, external hrefs, and unsafe URL references.
- Individual facet failures should not block other facets. Check logs for `generateSvgFacets facet failed` to see which facet had issues.
- If S mode fails entirely, the UI should show the SVG error state rather than silently falling back to a simple flowchart.

### SVG zoom does not work

Check:

- Ctrl+wheel zoom requires the `onWheel` handler on `.visualSvgDiagram` in `FacetSvgRenderer`.
- The zoom range is 0.3x–3x, applied via CSS `transform: scale(zoom)`.
- Double-click should reset zoom to 1.0.
- The toolbar should show the current zoom percentage and a 1:1 reset button.

### Visual module sliders do not change the scene

Check:

- If B mode is selected, confirm the iframe content has at least one range input and each input calls the local `recalc()` function. Unsafe, missing, or incomplete raw HTML content should fall back to the local teaching lesson.
- For KV interleaving/consolidation passages, confirm B mode shows separated K/V rows, animated K_i + V_i pairing, interleaved `[K_i|V_i]` output, and live I/O metrics. If not, `normalizeHtmlDemo` should reject the AI demo and use the dedicated KV fallback.
- If A mode is selected, continue with the local SVG checks below.
- `apps/desktop/src/visualSimulation.ts` still exports `computeVisualSimulation`.
- `VisualLab` passes the current `parameterValues` into `computeVisualSimulation`.
- `SimulationLayer` receives `simulationState` and maps it to block counts, GPU lanes, metrics, and packet speed.
- Generated `VisualSpec.parameters` have useful ranges and non-identical `min` / `max` values.
- If a `visualElements` item should react to a slider, confirm its `parameterId` matches one generated parameter id.

### Visual module A mode still looks like only a flowchart

Check:

- The generated JSON includes `visualElements`, not only `nodes` and `edges`.
- The `kind` value matches the passage, such as `architecture`, `matrix`, `equation-playground`, `comparison`, `geometry`, or `timeline`.
- `visualElements.kind` values are supported: `rect`, `circle`, `text`, `formula`, `matrix`, `layer`, `bracket`, `annotation`, `bar`, `axis`, or `arrow`.
- Element coordinates stay inside the 700 x 360 canvas.

### AI Workbench generation times out

The main Workbench generation should request a structured `WorkspaceSpec` only. It must not include HTML, JavaScript, CSS, SVG markup, executable code, or `htmlDemo`. VisualLab generates S-mode SVG and B-mode raw HTML only after the user clicks `生成可视化` / standalone `Generate`. If timeouts return, check the selected model speed, `maxTokens`, selected context length, and whether the JSON-stage prompt accidentally started requesting executable content.

### Visual module B mode looks unsafe or tries to load resources

Do not run the generated HTML directly in the renderer. Keep it inside the `HtmlSandbox` iframe with `sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`, and the restrictive CSP built by `buildSandboxSrcDoc`.

If B mode is blank or too simple, check:

- `extractHtmlFragment` should accept raw HTML or one fenced ```html block from the second-stage AI response.
- `normalizeHtmlDemo` should fall back to `createFallbackHtmlDemo` when raw HTML is missing, lacks a range slider, lacks `recalc()`, lacks a drawing surface, or contains obvious unsafe patterns such as external scripts, `fetch`, WebSocket, `import`, `eval`, or `new Function`.
- For KV scenes, `normalizeHtmlDemo` also checks for K/V/interleaving structure before accepting AI HTML.
- `createFallbackHtmlDemo` should still produce a complete teaching lesson from the structured `VisualSpec`.
- `AiWorkbench` should not request `htmlDemo`; `VisualLab` asks for S-mode inline SVG and B-mode raw HTML/SVG/JS only from the manual visual-generation action after structured JSON is available.

### Renderer logs are missing from the log file

Check:

- `window.paperSuper.log` is exposed in `apps/desktop/electron/preload.ts`.
- `paperSuper:log` is registered in `apps/desktop/electron/main.ts`.
- `apps/desktop/electron/logger.ts` writes to Electron `userData/logs/papersuper-YYYY-MM-DD.log`.
- Renderer code should use `apps/desktop/src/log.ts`; logs are also printed to DevTools.

### AI JSON parsing fails after generation

Check:

- `VisualLab` and `AiWorkbench` should parse model output through `parseModelJsonObject` in `apps/desktop/src/utils.ts`.
- The helper strips fenced JSON, extracts the outer object or array, removes trailing commas, and repairs common missing comma boundaries.
- If the error points near an object inside an array such as `"unit": "GB/s" }`, the model may have ended an array item and started the next property without `],`; keep the stack-based repair path in place.
- If parsing still fails, reduce `maxTokens` pressure or ask the model to regenerate strict JSON.

### UI zoom is wrong

Use `Ctrl/Cmd + 0` to reset the global zoom to 100%. The persisted setting lives in Electron `userData/papersuper-settings.json` under `uiZoomFactor`.

## Safe Editing Notes

- `react-pdf-highlighter/` is vendored source in the main repository, not a submodule.
- Prefer wrapping `react-pdf-highlighter` from `apps/desktop/src/pdf-highlighter.ts` before editing vendored internals.
- Keep Electron IPC API minimal. Do not expose raw Node APIs to the renderer.
- Keep provider-specific HTTP behavior in `apps/desktop/electron/ai.ts`.
