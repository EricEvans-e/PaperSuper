# PaperSuper

PaperSuper is an Electron + React + TypeScript prototype for a PDF-first AI research IDE. The current app wraps `react-pdf-highlighter` as the PDF reading and annotation base, then uses a three-zone IDE layout: collapsible AI chat on the left, PDF reading in the center, and a reserved interaction workbench on the right.

## Current Capabilities

- Desktop app built with Electron, electron-vite, React, and TypeScript.
- PDF reader based on PDF.js and `react-pdf-highlighter`.
- Default sample PDF: `Attention Is All You Need` from arXiv.
- Local PDF open flow through Electron IPC.
- Text highlights, area highlights, comments, and click-to-jump annotation list.
- Clicked text, selected text, and selected visual regions are automatically saved as AI context.
- Auto-saved context is highlighted in the PDF and used silently by the AI chat.
- Clicking the same AI context highlight again removes it from the PDF and the AI context state.
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
                         PDF pane, activity bar, title bar, workbench components
react-pdf-highlighter/   Vendored PDF highlighting source used by the app
scripts/                 Local helper scripts
docs/                    Architecture, runbook, and handoff notes
```

## Current Limitations

- There is no installer or release packaging yet.
- Paper library/database persistence is not implemented.
- Highlights and chat messages are in renderer state only.
- API keys are stored in `localStorage`; use a secure key store before treating this as a production app.
