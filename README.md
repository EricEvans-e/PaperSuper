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
  - Visual module: structure diagrams, animations, parameters, and optional sandbox demo.
  - Formula module: expression, variable meanings, and derivation steps.
  - Experiment module: sliders, computed teaching metrics, curves, and observations.
  - Insight module: key points, assumptions, limitations, and next questions.
  - First-pass UI actions support focusing workspace blocks, returning to selected PDF context later, and opening a future learning report.
  - Lightweight learning events are dispatched for workspace generation, module views, actions, and slider changes.
- The Visual module includes Visual Lab A/B output:
  - A mode renders validated AI-generated `VisualSpec` data with local React/SVG playback, parameter sliders, and a local simulation engine that recomputes blocks, active windows, GPU lanes, metrics, and animation speed as sliders move.
  - A mode also supports safe declarative `visualElements` for richer diagrams such as model architecture blocks, matrices, layer stacks, formula callouts, brackets, bars, axes, annotations, and arrows.
  - B mode renders a self-contained HTML/JS teaching demo inside an iframe sandbox when provided, with its own controls and recomputation loop for comparison.
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
apps/desktop/src/visualSimulation.ts
                         Local parameter-driven simulation engine for Visual Lab A mode
react-pdf-highlighter/   Vendored PDF highlighting source used by the app
scripts/                 Local helper scripts
docs/                    Architecture, runbook, and handoff notes
```

## Current Limitations

- There is no installer or release packaging yet.
- Paper library/database persistence is not implemented.
- Highlights and chat messages are in renderer state only.
- API keys are stored in `localStorage`; use a secure key store before treating this as a production app.
