# Loom

A local desktop chat for studying books and papers through interactive HTML explanations.

## Run

```sh
git clone https://github.com/thanicsamin/loom.git
cd loom
npm ci
npm start
```

If your npm configuration blocks install scripts, run `node node_modules/electron/install.js` once. Node 24 or newer is required for development. The packaged application includes Electron and Pi 1.1.0.

Choose a provider in the chat header. Connect accounts in **Settings & connections**. Add a project folder to access your textbooks and papers. Click a PDF in **Files** to view pages, extracted text, or tables, then use **Explain this page**. Drag files into the window, use the attachment button, or paste an image.

**Enter** sends a message. During a response, **Enter** steers the active run. **Shift+Enter** inserts a line break. **Stop** cancels a response. Silent requests show a waiting state, stop after two minutes without progress, and offer **Retry** with the original message and attachments. Empty responses show an error; partial replies stay in the chat. Total response time is bounded to ten minutes. **Ctrl/Cmd+N** creates a chat; **Ctrl/Cmd+K** searches chats.

## Learning tools

- Original HTML, CSS, JavaScript, SVG, and canvas answers run inline. The assistant can use bundled KaTeX and Chart.js. It has no fixed explainer templates.
- Interactions persist independently from conversation compaction. Canvases support fullscreen, source inspection, recoverable revisions, and offline HTML export.
- Exact quizzes run locally. Free-form answers use the configured Jev classifier after a pause; changing an answer cancels its older check. A detailed-feedback action prepares a request for the selected chat model.
- PDF tools extract page text, metadata, contents outlines, and tables, or render a page for visual reading. They run in separate workers with size, concurrency, memory, and time limits. Scans need a vision-capable chat model; there is no standalone OCR service in this prototype.
- The assistant can search arXiv and download public HTTPS PDFs into `papers/`. Each download records its source URL. Existing files are never replaced. Search requests are serialized, spaced by three seconds, and cached.
- Each chat has OptMem-inspired append-only notes and binary summary caches. The model can save notes, merge pending summaries, zoom a range, search original notes, and repair a summary. Original messages remain retrievable. Pi also compacts active sessions. Summaries are lossy; this is an independent TypeScript adaptation, not the upstream Python runtime.
- Projects map to actual disk folders. Chats appear directly beneath their project. Project files and disk folders stay available beside the chat list. File tools stay inside the chosen project or a standalone chat workspace.
- Locally bundled Computer Modern text, 18 px by default; adjustable from 12–24 px.
- Dark, Light, and System appearance; a calligraphic L logo; dense chat spacing with readable text and a plain start screen. HTML frames fit their contents and shrink when sections close.

## Accounts

| Connection | Runtime |
| --- | --- |
| Codex subscription | Official `codex app-server` when installed; Pi subscription fallback otherwise |
| Claude subscription | Official signed-in Claude Code CLI, streaming JSON + Loom MCP tools |
| Gemini subscription | Official signed-in Antigravity CLI (`agy`), streaming JSON + Loom MCP tools; Gemini CLI/ACP when Antigravity is absent |
| OpenCode Go | Pi, with a Go subscription key |
| Jev feedback | Pi classifier route through TypeSafe AI, OpenRouter, or OpenCode Zen |

**Import connections from Autoum** copies compatible primary/named accounts into Loom's private account files. It preserves existing Loom connections and returns provider names only. A matching official Codex sign-in is copied for the native runtime. Claude and Gemini use their official CLI sign-ins. Import is an explicit action; logging out does not trigger automatic re-import.

Loom prefers a verified private Codex installation in its data directory's `runtime/node_modules/@openai/codex/` when `runtime/.ready` exists, then falls back to `codex` on the system path. It uses Loom's own sign-in; updating it does not change the system CLI or Codex desktop app.

GPT-6.1 Sol and speed options come from the installed Codex runtime's model catalog. **Sol Ultrafast** appears as a speed option but is disabled unless that runtime/account advertises it. Loom does not silently substitute another tier. See the [official Codex speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed).

Gemini models and thinking levels come from `agy models`, including Gemini 3.8 Flash when advertised. Loom pins the chosen model and uses the CLI’s existing Google subscription sign-in. It does not extract Google OAuth tokens, call private Google endpoints, or fall back to a separately billed API key. The current Antigravity input protocol accepts text; project PDFs can supply extracted text, while direct image inputs need another provider. See the [official headless protocol](https://antigravity.google/docs/cli/headless/).

Jev requests use the selected provider's API credits. OpenCode Zen and Go have separate credentials. A missing judge or uncertain answer produces an explicit state, never a fabricated score. Editing pauses debounce checks, and HTTP 429 responses block more judge requests until the provider’s `Retry-After` period ends (one minute when absent). Loom does not automatically retry failed chat requests. Provider terms, account limits, and enforcement still apply; an official CLI integration is not a guarantee against account restrictions.

Account/model discovery runs in the background. The UI and inline scripts do not receive account tokens. Linux/macOS credential files use private permissions; this prototype does not integrate an OS keychain. Windows credentials rely on the user's profile directory permissions.

OpenCode Go's **Step 5 Preview Free** and **LongCat 2.5 Preview Free** appear first in its model list. A new Go chat defaults to Step 5 while the promo is available. The [official Go documentation](https://opencode.ai/docs/en/go/) currently lists LongCat as a limited free promotion; Step 5 is a compatibility registration from an earlier catalog and may no longer be offered. An entry in Loom’s catalog does not establish current availability. An explicitly selected unavailable model produces an error rather than switching to another model. Step 5 uses a conservative text-only registration until Pi supplies its full metadata; choose a model marked for images to inspect scanned pages.

The initial window reads local chats and saved canvases before loading the model SDK. You can type while connections load. Streaming text is grouped once per display frame, preserving chunk order without rendering React for each token.

## Validation and builds

```sh
npm run typecheck
npm test
npm run test:desktop
npm run test:contrast
npm run package
npm run dist
```

Desktop tests launch the actual Electron app with Playwright. They cover rendering and isolation, offline export, project/disk folders, PDF reading, clipboard and upload previews, themes, chat persistence, steering and Stop, and typing with a large history. The contrast suite opens real menus and checks readable text, hover, pressed, focus, disabled controls, keyboard navigation, and reduced motion across Light, Dark, and both System appearances. The report and screenshots are written to `test-results/`. Provider tests exercise real Pi HTTP/classifier protocols and the Codex JSONL contract with local fixtures. The normal suite makes no paid model requests. Follow [UI_GUIDELINES.md](UI_GUIDELINES.md) when changing the interface.

An opt-in live test uses the saved Loom Go connection to generate a lesson with a free promo model, then opens it in Electron and verifies the slider and saved state. It also checks free Jev through OpenCode Zen when connected. Confirm current promo availability before running it:

```sh
LOOM_LIVE_TEST=1 npm run test:live
# Optional: LOOM_TEST_MODEL=longcat-2.5-preview-free
```

Live provider checks also cover Go with GPT-6 Luna Low and Gemini 3.8 Flash Low. They use ordinary teaching requests and real source PDFs, rather than asking the assistant to add quizzes. These commands use connected accounts and consume their quotas:

```sh
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts generate
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts interact
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts gemini
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts gemini-interact
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts gemini-empty
LOOM_LIVE_TEST=1 node --import tsx tests/provider-live.ts cleanup
```

The final command removes the private temporary account copies. Reports stay under ignored `test-results/providers/`. Set `ELECTRON_PATH` to a packaged executable to validate the installed build. See [VALIDATION.md](VALIDATION.md) for measured startup, interaction, and streaming results.

Linux has been built and tested here. Packaging targets also exist for macOS DMG and Windows NSIS; those OS builds and subscription sign-in flows have not been tested here. Claude/Gemini live requests require installed official runtimes. Voice chat and dictation are deferred under the chat-only prototype scope.

Architecture details: [ARCHITECTURE.md](ARCHITECTURE.md). Rollback instructions: [ROLLBACK.md](ROLLBACK.md).

## References

- [Pi](https://github.com/earendil-works/pi)
- [OptMem](https://github.com/VictorTaelin/OptMem) — the memory design inspiration; no upstream code copied
- [pdf-parse](https://github.com/mehmet-kozan/pdf-parse) / PDF.js — parsing and page rendering
- [arXiv API](https://info.arxiv.org/help/api/user-manual.html)
- [Antigravity headless mode](https://antigravity.google/docs/cli/headless/), [workspace MCP](https://antigravity.google/docs/mcp?tab=cli), [rules](https://antigravity.google/docs/rules/)
- [Codex app server](https://developers.openai.com/codex/app-server), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference), [Gemini ACP](https://geminicli.com/docs/cli/acp-mode/)

The logo is a vector outline from KaTeX's calligraphic font. The application bundles third-party open-source libraries under their respective licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
