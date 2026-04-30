# PaperSuper Handoff

Last updated: 2026-04-30

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
- Main AI Workbench generation now requests structured `WorkspaceSpec` JSON only, keeping HTML/JS sandbox demos out of the primary request path to reduce timeouts.
- Right AI Workbench content scrolls as a whole so taller modules are not clipped.
- Visual module with A/B output: validated AI-generated `VisualSpec` JSON rendered locally with React/SVG, plus self-contained HTML/JS demos rendered only inside an iframe sandbox with CSP when provided.
- Visual Lab A mode now uses a local parameter-driven simulation engine, so slider changes recompute and redraw teaching visuals such as K/V cache blocks, token interleaving, transfer blocks, GPU lanes, metric cards, and flow speed.
- Visual Lab A mode also supports declarative `visualElements`, allowing generated scenes to render richer non-flowchart diagrams such as architecture blocks, matrices, layer stacks, formulas, bars, brackets, axes, annotations, and arrows.
- Visual Lab B mode prompt now asks for a teaching-oriented self-contained HTML/JS demo with visible controls and a recomputation loop, isolated in the existing iframe sandbox.
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
4. Add richer simulation templates beyond the current KV-cache-oriented default, especially for equations, attention, diffusion, optimization, and statistical experiments.
5. Add more A-mode visual element kinds if needed, such as heatmaps with labels, small multiples, decision trees, coordinate plots, or simple 3D projections.
6. Add visible PDF zoom controls and optional persistence for reader zoom.
7. Add a minimal smoke-test script or Playwright check for the app shell, AI Workbench tabs, and Visual module sliders.

## Verification Snapshot

`npm run build` succeeded on 2026-04-30 after adding the modular AI Workbench, right-side scrolling, declarative visual elements, parameter-driven simulations, structured SVG rendering, and sandboxed HTML/JS demos.
