# PaperSuper Handoff

Last updated: 2026-05-03

## Completed

- Root Electron + React + TypeScript app scaffold.
- `electron-vite` config and root npm scripts.
- Windows-safe `scripts/run-electron-vite.cjs` launcher.
- PDF pane based on `react-pdf-highlighter`.
- `react-pdf-highlighter/` is vendored as normal source in the main repository.
- Default sample arXiv PDF.
- Local PDF open through Electron IPC.
- Text highlights, comments, and annotation jump list.
- Clicked PDF text, selected text, and Alt-dragged text regions are auto-added to AI context.
- Single-click context is sentence-level with a bounded character window.
- Alt-dragged regions extract matching PDF text into text highlight rects and do not retain rectangular area boxes or forward screenshots to AI providers.
- Auto-added AI context is shown as PDF highlights rather than as a right-side context list.
- Right-clicking an AI context highlight opens a floating AI translation panel that merges adjacent highlighted sentences and uses extracted paper text context.
- Translation merging uses line-level highlight geometry so small whitespace gaps, wrapped lines, and slight PDF text-layer offsets still merge into one translation source.
- Clicking an AI context highlight removes that single context item.
- Clicking blank PDF space clears all AI context highlights and linked context items.
- Right workbench activities: Paper, AI, Settings.
- Three-zone workspace with collapsible and resizable left AI chat, center PDF reader, and resizable right reserved workbench.
- Left AI chat has compact narrow-width styling, auto-collapses when dragged below the threshold, and can reopen during the same drag when pulled back right.
- Workspace widths and chat visibility are persisted in renderer `localStorage`.
- Right AI Workbench with modular Visual, Formula, Experiment, and Insight panels generated from selected paper context.
- Main AI Workbench generation requests structured `WorkspaceSpec` JSON only. It no longer embeds HTML/CSS/JS/SVG in JSON; VisualLab generates S-mode SVG and B-mode raw HTML only when the user manually clicks `生成可视化` / standalone `Generate`.
- Right AI Workbench content scrolls as a whole so taller modules are not clipped.
- The AI activity panel keeps the header fixed in the right workbench, then lets `AiWorkbench` own the remaining-height vertical scroller; workspace blocks and Visual Lab content should not reintroduce fixed `height: 100%` clipping inside that scroll flow.
- Visual module with S/B/A output: S mode is now the preferred generated view for sanitized SVG principle/structure diagrams, B mode is the sandboxed HTML/JS teaching lesson, and A mode remains the structured React/SVG fallback.
- Visual Lab S mode uses a two-phase multi-facet generation: Phase 1 asks AI for 3-4 facet definitions `[{title, focus}]`, Phase 2 generates each facet's SVG in parallel with progressive loading. Facets display as switchable tabs; first-to-return shows immediately.
- S mode SVG supports Ctrl+wheel zoom (0.3x–3x), double-click reset, and an expand/collapse toolbar with zoom percentage display.
- `extractJsonCandidate` in `utils.ts` now supports both `{...}` objects and `[...]` arrays, fixing Phase 1 facet definition parsing.
- Phase 1 facet definition `maxTokens` increased to 8000 to prevent truncated JSON responses.
- Visual Lab B mode uses safe and complete raw AI HTML from the manual code-generation call when available and otherwise generates a local self-contained teaching lesson from the structured `VisualSpec`.
- Visual Lab B mode now rejects incomplete AI demos without sliders, `recalc()`, or a drawing surface; KV interleaving/consolidation demos must include K/V/interleaving structure or fall back to the dedicated local template.
- KV interleaving/consolidation fallback now shows separated K cache / V cache rows, animated K_i + V_i pairing, an interleaved `[K_i|V_i]` output row, token/group/speed sliders, and live I/O reduction metrics.
- Visual Lab B fallback lessons include a principle canvas, dynamic mechanism view, parameter controls, live metrics, clickable/autoplay steps, and takeaway strip.
- Visual Lab A mode now uses a local parameter-driven simulation engine, so slider changes recompute and redraw teaching visuals such as K/V cache blocks, token interleaving, transfer blocks, GPU lanes, metric cards, and flow speed.
- Visual Lab A mode also supports declarative `visualElements`, allowing generated scenes to render richer non-flowchart diagrams such as architecture blocks, matrices, layer stacks, formulas, bars, brackets, axes, annotations, and arrows.
- Visual Lab no longer auto-generates S/B AI assets when `specOverride` or selected context changes. It shows local preview first; manual visual generation then requests a sanitized inline SVG principle diagram and a teaching-oriented self-contained HTML/JS demo with visible controls and a recomputation loop.
- VisualLab and AiWorkbench parse model JSON through `parseModelJsonObject`, which extracts fenced JSON, removes trailing commas, repairs common missing-comma boundaries, and reports clearer parse hints.
- `parseModelJsonObject` now handles a common model error where an array of objects ends with a value such as `"unit": "GB/s" }` and then starts the next property without the missing `],`.
- Added `SvgFacet` interface to `types.ts` for multi-facet SVG state management.
- Added renderer/main logging: `window.paperSuper.log` forwards renderer logs to `paperSuper:log`, and Electron main writes daily logs under `userData/logs/`.
- API configuration stored in renderer `localStorage`.
- Real AI provider support:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Anthropic Messages
- Markdown rendering for assistant answers.
- Streaming response support over Electron IPC events.
- OpenAI endpoint retry/fallback behavior for common base URL mismatches.
- Global UI zoom shortcuts: `Ctrl/Cmd + +` / `Ctrl/Cmd + =`, `Ctrl/Cmd + -`, and `Ctrl/Cmd + 0`, persisted in Electron `userData`.
- PDF reader zoom with `Ctrl/Cmd + mouse wheel` inside the paper pane, separate from global UI zoom.
- Highlight layers are refreshed after PDF scale/page/text-layer render events so AI context highlights stay aligned during PDF zoom.
- PDF page text is extracted in the renderer for contextual highlight translation.
- Translation popup is now draggable by its header; regenerate and close buttons remain fully functional during drag.
- Right-clicking a highlight while the translation popup is open closes the popup, allowing the next right-click to open a new translation menu.
- Right-clicking while the highlight action menu is open passes the event through to the highlight underneath via CSS `pointer-events: none` on the menu container, so the translation menu immediately reappears on the new highlight.
- Selection debounce reduced from 500ms to 200ms so highlight overlays appear faster after text selection.
- Native `::selection` color now matches the highlight overlay color (`#FFE28F`), eliminating the visible color flash during selection.
- First page highlight layer no longer sits behind text spans: CSS `z-index: 3 !important` beats the PDF.js specificity override, and `onTextLayerRendered` re-appends the highlight layer to ensure correct DOM order regardless of rendering race conditions.

## Known Gaps

- No packaged desktop installer.
- No persistent paper library.
- No persistent annotation database.
- No secure OS keychain storage for API keys.
- No automated tests yet.
- The UI copy is still prototype-level and should be reviewed once the layout stabilizes.

## Suggested Next Steps

1. Add persistence for highlights and chat sessions.
2. Move API key storage from `localStorage` to a safer Electron-side storage strategy.
3. Add caching for generated WorkspaceSpecs, VisualSpecs, simulation states, and HTML demos per highlight/context.
4. Add an automated or semi-automated visual smoke test for S mode that verifies generated SVG is not a tiny node-link flowchart and contains spatial regions, nested structures, labels, and mechanism arrows.
5. Improve generated B-mode lesson quality with stricter validation for required sliders, metrics, steps, and visible DOM updates.
6. Add richer simulation templates beyond the current KV-cache-oriented default, especially for equations, attention, diffusion, optimization, and statistical experiments.
7. Add more A-mode visual element kinds if needed, such as heatmaps with labels, small multiples, decision trees, coordinate plots, or simple 3D projections.
8. Add visible PDF zoom controls and optional persistence for reader zoom.
9. Add a minimal smoke-test script or Playwright check for the app shell, AI Workbench blocks, Visual S-mode diagram rendering, B-mode lesson sliders, and A-mode fallback sliders.

## Verification Snapshot

`npm run build` passed on 2026-05-03 after translation popup drag, right-click pass-through, selection debounce/color fixes, first-page z-index fix, and documentation sync.
