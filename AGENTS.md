# PaperSuper Agent Notes

Last updated: 2026-04-30

## Project Shape

PaperSuper is an Electron + React + TypeScript desktop prototype for a PDF-first AI research IDE.

- Renderer app: `apps/desktop/src`
- Electron main/preload: `apps/desktop/electron`
- AI HTTP clients: `apps/desktop/electron/ai.ts`
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
- collapsible AI chat pane on the left, toggled from the activity bar
- PDF pane in the center
- reserved workbench pane on the right for Paper/AI/Settings tools
- draggable vertical handles between the three zones

As of 2026-04-30, AI chat is no longer inside the right workbench. `App` owns the three-zone grid, renders `AiChatPanel` as the collapsible left pane, and persists workspace widths in `localStorage` under `papersuper:workspace-layout`.
