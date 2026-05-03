# PaperSuper

PaperSuper is an Electron + React + TypeScript prototype for a PDF-first AI research IDE. The current app wraps `react-pdf-highlighter` as the PDF reading and annotation base, then uses a three-zone IDE layout: collapsible AI chat on the left, PDF reading in the center, and a modular AI Workbench on the right.

## Current Capabilities

- Desktop app built with Electron, electron-vite, React, and TypeScript.
- PDF reader based on PDF.js and `react-pdf-highlighter`.
- Default sample PDF: `Attention Is All You Need` from arXiv.
- Local PDF open flow through Electron IPC.
- Text highlights, comments, and click-to-jump annotation list.
- Single-clicked text, selected text, and Alt-dragged text regions are automatically saved as AI context.
- Single-click context is limited to the nearby sentence instead of a broad multi-line block.
- Alt-dragged regions use a temporary rectangle only while dragging, then extract matching PDF text and save it as normal text highlights without sending screenshots to the model.
- Auto-saved context is highlighted in the PDF and used silently by the AI chat.
- Clicking the same AI context highlight again removes it from the PDF and the AI context state.
- Right-clicking an AI context highlight opens a translation action; adjacent same-page highlights are merged for translation and shown in a floating Markdown panel near the PDF.
- Translation merging uses line-level highlight geometry, so small gaps, wrapped lines, and slight PDF text-layer offsets can still be treated as one selected passage.
- Highlight translation uses the configured AI provider and includes extracted paper text context for terminology consistency.
- Translation popup is draggable by its header for manual repositioning.
- Right-clicking while the translation popup or action menu is open passes the event through to the highlight underneath, so the translation menu immediately reappears on a different highlight.
- Clicking any blank space inside the PDF viewer clears all auto-saved AI context highlights.
- AI configuration stored in renderer `localStorage`.
- Supported AI provider formats:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Anthropic Messages
- AI answers are rendered as Markdown with GFM support.
- Streaming AI output is wired through Electron IPC events.
- Three-zone workspace: collapsible left AI chat, central PDF reader, and right interaction/reserved panel.
- Left AI chat width and right reserved panel width can be adjusted manually and are persisted locally.
- The left AI chat uses a compact layout at narrow widths, auto-collapses below the threshold, and can reopen during the same drag if pulled back right.
- Right AI Workbench renders a page-style learning workspace generated from the selected paper context:
  - A compact block navigator jumps to page sections instead of hiding modules behind tabs.
  - Visual module: preferred sanitized SVG principle diagram, sandboxed HTML/JS mechanism lesson, and structured React/SVG fallback.
  - Formula module: expression, variable meanings, and derivation steps.
  - Experiment module: sliders, computed teaching metrics, curves, and observations.
  - Insight module: key points, assumptions, limitations, and next questions.
  - First-pass UI actions support focusing workspace blocks, returning to selected PDF context later, and opening a future learning report.
  - Lightweight learning events are dispatched for workspace generation, module views, actions, and slider changes.
- The Visual module includes Visual Lab S/B/A output:
  - S mode is the preferred generated view. After the user manually clicks the visual generation button, it uses two-phase multi-facet generation: Phase 1 asks AI for 3-4 facet definitions, Phase 2 generates each facet's SVG in parallel with progressive loading. Facets display as switchable tabs with Ctrl+wheel zoom (0.3x–3x) and expand/collapse toggle.
  - B mode renders a self-contained HTML/JS teaching lesson inside an iframe sandbox, with a principle canvas, playable mechanism animation, parameter controls, live metrics, steps, and a takeaway strip.
  - B mode uses a manual follow-up AI generation step: structured `VisualSpec` JSON first, then the VisualLab `生成可视化` action can request raw HTML/SVG/JS so complex visualization code is not embedded inside JSON strings.
  - If the AI does not provide safe and complete raw HTML content, B mode automatically builds a local fallback lesson from `VisualSpec` instead of showing a blank or unsafe demo.
  - Selecting PDF text only prepares context and local preview; it does not automatically ask AI to generate S/B visual assets.
  - KV interleaving/consolidation gets a dedicated B-mode fallback: separated K cache / V cache rows, animated K_i + V_i pairing, interleaved `[K_i|V_i]` output, token/group/speed sliders, and live I/O reduction metrics.
  - A mode remains available as the structured fallback. It renders validated `VisualSpec` data with local React/SVG playback, parameter sliders, `mechanismBrief`, `principleDiagram`, `scene`, `semantic`, and `visualElements`.
  - The A-mode `scene` renderer normalizes model-provided coordinates, detects broken or overlapping layouts, and falls back to stable local placement for cases such as KV cache K/V lanes and interleaved `[K|V]` units.
  - A mode also supports safe declarative `visualElements` for richer diagrams such as model architecture blocks, matrices, layer stacks, formula callouts, brackets, bars, axes, annotations, and arrows.
- AI-generated JSON for Visual Lab and the AI Workbench is extracted and lightly repaired before parsing, so common model mistakes such as fenced output, trailing commas, or missing commas fail with clearer diagnostics. The JSON extractor supports both `{...}` objects and `[...]` arrays.
- Global UI zoom uses `Ctrl/Cmd + +` or `Ctrl/Cmd + =`, `Ctrl/Cmd + -`, and `Ctrl/Cmd + 0`, with the zoom factor persisted by Electron.
- PDF reader zoom uses `Ctrl/Cmd + mouse wheel` inside the paper pane, affects only the PDF view, and keeps existing highlights aligned after scaling.

## Setup

```bash
npm install
npm run dev
```

Build the production output:

```bash
npm run build
```

Preview the built app:

```bash
npm run preview
```

## Using AI Providers

Open the Settings activity and configure:

- `Provider`: `OpenAI Chat Completions`, `OpenAI Responses`, or `Anthropic Messages`
- `API Base`: provider base URL, for example `https://api.openai.com/v1` or `https://api.anthropic.com`
- `API Key`: your key
- `Model`: provider model name
- `Max Tokens`: output token cap

For OpenAI-compatible gateways that only implement Chat Completions, choose `OpenAI Chat Completions`. If `OpenAI Responses` returns a 404, the backend probably does not expose `/v1/responses`.

## Project Layout

```text
apps/desktop/electron/   Electron main process, preload bridge, AI HTTP clients
apps/desktop/src/        React renderer app
apps/desktop/src/components/
                         PDF pane, activity bar, title bar, AI Workbench, Visual Lab
apps/desktop/src/types.ts
                         Shared AI, workspace, visual, and mechanism scene contracts
apps/desktop/src/utils.ts
                         Shared renderer helpers, including AI JSON extraction/repair
apps/desktop/src/log.ts
                         Renderer logging helper forwarding logs to Electron main
apps/desktop/src/visualSimulation.ts
                         Local parameter-driven simulation engine for Visual Lab A-mode fallback
apps/desktop/electron/logger.ts
                         Main-process log file writer under Electron userData/logs
react-pdf-highlighter/   Vendored PDF highlighting source used by the app
scripts/                 Local helper scripts
docs/                    Architecture, runbook, and handoff notes
```

## Current Limitations

- There is no installer or release packaging yet.
- Paper library/database persistence is not implemented.
- Highlights and chat messages are in renderer state only.
- API keys are stored in `localStorage`; use a secure key store before treating this as a production app.

## Safety Notes

- Generated HTML/JS demos run only inside the Visual Lab iframe sandbox with a restrictive CSP.
- Generated SVG principle diagrams are sanitized before rendering; scripts, event handlers, `foreignObject`, and external links are stripped.
- AI Workbench requests a structured `WorkspaceSpec` only. Visual code is generated by a second raw-HTML AI call from `VisualLab`, so large HTML/CSS/JS is not embedded in JSON.
- Unsafe or incomplete raw HTML content is rejected before rendering. Missing sliders, missing `recalc()`, or KV demos without K/V/interleaving structure fall back to the local B-mode lesson.
- Model JSON is parsed through a helper that extracts fenced JSON and repairs common comma issues, but invalid model output can still require regeneration.
