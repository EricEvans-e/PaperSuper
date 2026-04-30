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
- Text highlights, area highlights, comments, and annotation jump list.
- Clicked PDF text, selected text, and selected visual regions are auto-added to AI context.
- Auto-added AI context is shown as PDF highlights rather than as a right-side context list.
- Clicking an AI context highlight removes that single context item.
- Clicking blank PDF space clears all AI context highlights and linked context items.
- Right workbench activities: Paper, AI, Settings.
- Three-zone workspace with collapsible left AI chat, center PDF reader, and right reserved workbench.
- API configuration stored in renderer `localStorage`.
- Real AI provider support:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Anthropic Messages
- Markdown rendering for assistant answers.
- Streaming response support over Electron IPC events.
- OpenAI endpoint retry/fallback behavior for common base URL mismatches.

## Known Gaps

- No packaged desktop installer.
- No persistent paper library.
- No persistent annotation database.
- No secure OS keychain storage for API keys.
- No automated tests yet.
- Left AI chat width is fixed; draggable resizing is not implemented yet.
- The UI copy is still prototype-level and should be reviewed once the layout stabilizes.

## Suggested Next Steps

1. Add draggable width resizing for the left AI chat pane and right reserved workbench.
2. Add persistence for highlights and chat sessions.
3. Move API key storage from `localStorage` to a safer Electron-side storage strategy.
4. Add a minimal smoke-test script or Playwright check for the app shell.

## Verification Snapshot

`npm run build` succeeded on 2026-04-30 after moving AI chat into the collapsible left pane.
