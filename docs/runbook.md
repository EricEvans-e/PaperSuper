# PaperSuper Runbook

Last updated: 2026-04-30

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
19. Open the AI activity in the right workbench and confirm the Visual Lab renders a preview scene.
20. In A mode, use playback controls to advance steps, then move each slider and confirm the upper SVG visibly changes: K/V cache blocks, token-wise interleaving blocks, block transfer blocks, GPU lanes, metric cards, and packet speed should update.
21. In A mode, confirm richer declarative elements can render in the preview or generated scene: matrix cells, layer stacks, formulas, bars, annotations, brackets, axes, or arrows should appear when present in `visualElements`.
22. Switch to B mode and confirm the HTML/JS sandbox preview loads in the iframe.
23. In B mode, move the demo controls and confirm the iframe demo recomputes its diagram or animation without opening external resources.
24. Alt-drag a paragraph/table text region, click `Generate`, and confirm the Visual Lab requests the configured AI provider and renders both the generated A-mode scene and B-mode HTML demo or a clear error fallback.
25. Ask the AI chat to translate or explain the selected context.
26. Confirm streaming output appears as Markdown.
27. Run `npm run build`.

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

### Visual Lab sliders do not change the scene

Check:

- A mode is selected, not B mode.
- `apps/desktop/src/visualSimulation.ts` still exports `computeVisualSimulation`.
- `VisualLab` passes the current `parameterValues` into `computeVisualSimulation`.
- `SimulationLayer` receives `simulationState` and maps it to block counts, GPU lanes, metrics, and packet speed.
- Generated `VisualSpec.parameters` have useful ranges and non-identical `min` / `max` values.
- If a `visualElements` item should react to a slider, confirm its `parameterId` matches one generated parameter id.

### Visual Lab A mode still looks like only a flowchart

Check:

- The generated JSON includes `visualElements`, not only `nodes` and `edges`.
- The `kind` value matches the passage, such as `architecture`, `matrix`, `equation-playground`, `comparison`, `geometry`, or `timeline`.
- `visualElements.kind` values are supported: `rect`, `circle`, `text`, `formula`, `matrix`, `layer`, `bracket`, `annotation`, `bar`, `axis`, or `arrow`.
- Element coordinates stay inside the 700 x 360 canvas.

### Visual Lab B mode looks unsafe or tries to load resources

Do not run the generated HTML directly in the renderer. Keep it inside the `HtmlSandbox` iframe with `sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`, and the restrictive CSP built by `buildSandboxSrcDoc`.

### UI zoom is wrong

Use `Ctrl/Cmd + 0` to reset the global zoom to 100%. The persisted setting lives in Electron `userData/papersuper-settings.json` under `uiZoomFactor`.

## Safe Editing Notes

- `react-pdf-highlighter/` is vendored source in the main repository, not a submodule.
- Prefer wrapping `react-pdf-highlighter` from `apps/desktop/src/pdf-highlighter.ts` before editing vendored internals.
- Keep Electron IPC API minimal. Do not expose raw Node APIs to the renderer.
- Keep provider-specific HTTP behavior in `apps/desktop/electron/ai.ts`.
