# PaperSuper Agent Notes

Last updated: 2026-04-30

## Project Shape

PaperSuper is an Electron + React + TypeScript desktop prototype for a PDF-first AI research IDE.

- Renderer app: `apps/desktop/src`
- Electron main/preload: `apps/desktop/electron`
- AI HTTP clients: `apps/desktop/electron/ai.ts`
- PDF wrapper export: `apps/desktop/src/pdf-highlighter.ts`
- Upstream PDF base: `react-pdf-highlighter/`
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

- Do not delete or rewrite `react-pdf-highlighter/.git`; it is a nested upstream project.
- Prefer app-level wrappers and components over editing upstream `react-pdf-highlighter` internals.
- Keep renderer access to native capabilities behind `window.paperSuper` in preload.
- Do not expose broad Node APIs to the renderer.
- Keep provider HTTP logic in `apps/desktop/electron/ai.ts`.
- API keys currently live in renderer `localStorage`; treat that as prototype-only.

## PDF Context Behavior

- AI context highlights use `comment.text === "AI Context"`.
- The right workbench does not render a selected-context list; PDF highlights are the visible source of truth.
- Clicking PDF text, selecting text, or selecting a visual region auto-adds AI context and creates a highlight.
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

## Layout Notes

The current UI is a dark IDE shell with:

- activity bar on the far left
- title bar at the top
- PDF pane on the left
- draggable vertical split handle
- workbench pane on the right

As of 2026-04-30, the right workbench is split vertically: upper area for Paper/AI/Settings tools, lower area for a resizable AI chat panel. A later iteration can promote chat to a full-width global bottom dock if needed.
