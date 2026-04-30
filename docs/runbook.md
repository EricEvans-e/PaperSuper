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
4. Click text in the PDF and confirm nearby context is auto-highlighted and added to AI context.
5. Click the same highlighted context again and confirm it is removed from the PDF.
6. Add several context highlights, click blank PDF space, and confirm all AI context highlights are cleared.
7. Select text or draw a visual region and verify it is auto-highlighted.
8. Open a local PDF with the title-bar Open PDF button.
9. Switch between Paper, AI, and Settings activities.
10. Configure one AI provider and send a short prompt.
11. Confirm streaming output appears as Markdown.
12. Run `npm run build`.

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

### PDF does not load

Check:

- The sample arXiv URL is reachable from the machine.
- Local PDF selection returns an `ArrayBuffer` from the main process.
- `pdfjs-dist/build/pdf.worker.min.mjs?url` still resolves in `PdfReaderPane`.

### AI chat area is hard to see

The chat lives in the lower part of the right workbench. Drag the horizontal handle above the chat to resize it. If it still disappears, check the `workbenchDock`, `workbenchChatResizeHandle`, and `rightChatPanel` styles.

## Safe Editing Notes

- Do not delete or flatten `react-pdf-highlighter/.git`; it is a nested upstream project.
- Prefer wrapping `react-pdf-highlighter` from `apps/desktop/src/pdf-highlighter.ts` instead of editing upstream internals.
- Keep Electron IPC API minimal. Do not expose raw Node APIs to the renderer.
- Keep provider-specific HTTP behavior in `apps/desktop/electron/ai.ts`.
