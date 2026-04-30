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
3. Add visible PDF zoom controls and optional persistence for reader zoom.
4. Add a minimal smoke-test script or Playwright check for the app shell.

## Verification Snapshot

`npm run build` succeeded on 2026-04-30 after improving adjacent highlight merging for right-click AI translation.
