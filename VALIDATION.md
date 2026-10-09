# Validation

Tested on Linux on 2026-10-09 with Electron 44.4.2 and Pi 1.1.0. The desktop and reading checks also passed against the standalone packaged app.

- TypeScript check passed.
- All 44 unit tests passed. They cover scoped paths and symlinks, attachment persistence, silence/total deadlines, empty-response errors, provider outages, unavailable models, expired sign-ins, quota errors, dropped connections, process exits, manual retry isolation, quota cooldowns, private migration backups, Antigravity mixed-provider catalogs, future thinking labels, streaming sessions and structured errors, Windows npm wrapper bin resolution and long Claude prompt files, canvas validation and revisions, streaming, concurrent Codex chats and context reuse, provider-supported thinking levels, steering and cancellation, Jev classification and caching, PDF parsing/rendering and cache invalidation, arXiv provenance, credential import, memory persistence, and multiline Markdown math alongside headings and code.
- All 30 desktop end-to-end checks passed with no renderer errors. These cover direct project chats, real disk folders, PDF pages/citations, native upload and clipboard paste, inline and embedded math, full-height canvases, offline export, themes, steering/Stop, empty-response and provider-outage errors, manual Retry retaining attachments, fullscreen document preservation, saved state after restart, and a 400-message history.
- Separate screenshot and PDF clipboard tests ran one after the other using actual **Ctrl+V** on Linux. They verified previews, exact image pixels or PDF bytes, sent-message attachment references, and persistence after restart. They restored the prior clipboard contents afterward.
- Reading checks cover locally bundled Computer Modern, the 18 px default, 12/16/18/20/24 px settings, matching chat/canvas fonts and palettes in every appearance, automatic and changing LaTeX, narrow-window reflow, and long lessons without internal scrolling. Display equations containing standalone equals lines remain math rather than becoming Markdown headings; literal delimiters in code stay literal.
- Thinking-selector checks use actual model-catalog fields and protocol fixtures, including pagination, future values, per-model preferences, and Low on the wire. Unknown capabilities remain explicit rather than guessed.
- The theme suite measured at least 4.5:1 text contrast in app menus, labels, placeholders, and selection, across Light, Dark, and both System appearances. It exercised hover, pressed, focus, disabled states, keyboard selection, Escape, and reduced motion. Arbitrary generated diagrams and authored colors require separate visual inspection.
- The streaming test preserved all 1,000 ordered text chunks. A separate progressive-HTML fixture showed readable explanation, typeset math, and a figure before final publication. Incomplete scripts stayed inert; validated final interactions ran normally.
- A real TLS/HTTP2 transport test verified that canceling one quiz check retained the connection for subsequent parallel checks. PDF search results supplied cached physical pages, repeated reads shared work, and editing a PDF invalidated its cache.

Latest desktop measurements on this machine:

| Measurement | Time |
| --- | --- |
| First usable window | 1.38 s |
| Restart | 0.79 s |
| 400-message history startup | 0.82 s |
| Sample canvas ready | 850 ms |
| Slider paint | 30 ms |
| Typing latency, 95th percentile | 33 ms |
| Canvas expansion, without reloading the live document | 56 ms |
| Progressive HTML first preview, local protocol fixture | 330 ms |

The 1383 × 822 history benchmark showed 9 complete short messages at 18 px. The composer accepted typing while provider discovery continued. Earlier separate packaged launches measured 0.57–0.64 s. These are warm-cache Linux measurements, not cold-boot results or guarantees on other hardware. Rendering measurements do not establish model response speed.

## Live teaching checks

An opt-in Luna Low run used ordinary topic requests for nine topics, each in an empty project and a project containing a real source PDF: heaps, FFT, backpropagation, attention, Hecke algebras, the modular representation cde triangle, cohomology, p-adic Galois theory, and the Riesz representation theorem. All 18 produced working figures, controls, conceptual rubrics, and detailed-feedback actions without the user asking for a quiz. Structural checks passed with no renderer errors. These checks are not a complete mathematical review of every lesson.

Live free Jev 1.13 checked misconception and correct-answer attempts in all 18 lessons, including editing an answer during an active check. The earlier live run had a median request time of 355 ms, median visible feedback of 701 ms, and 95th-percentile visible feedback of 1,033 ms with the 300 ms editing pause. Four broad test answers received partial or uncertain criterion results; the UI retained that uncertainty. These measurements precede the dedicated HTTP2 transport and do not prove universal classifier accuracy.

Earlier live Go promo tests verified publication, interaction, saved state, and the live Jev bridge. LongCat short streams returned first text in 2.2–5.3 s; full Step 5 lesson generation was much slower and variable. Promo availability depends on the provider. Tests never substitute an unavailable selected model.

A dedicated OpenCode Go run used GPT-6 Luna Low with ordinary backpropagation requests in empty and Stanford-PDF projects. Both chose interactive figures and conceptual Jev questions. Generation took 22.3 and 28.3 seconds. Actual free Jev requests took 0.29–0.51 seconds in the latest interaction check; wrong/correct attempts, edits during checking, detailed Go feedback, and process restart passed. The shared quiz-state fix retained authored JSON string state and quiz answers independently, with the original lesson sources untouched. A new LongCat promo lesson run timed out before publication; Go connectivity passing does not establish that every promo model works reliably.

Gemini 3.8 Flash Low was tested through the official Antigravity CLI and the existing Google subscription, with models and thinking variants read from the CLI. Topic-only requests generated lessons with and without a source PDF. The source lesson completed in 48.4 seconds with typeset math, an SVG computation graph, sliders, and a live Jev question. Actual Jev scored a misconception and a correct explanation in 553 and 349 ms. Detailed Gemini feedback took 10.7 seconds, and the written answer survived restart. The empty-project lesson used a DOM computation graph rather than SVG, preserved exact computed weight updates in separate JavaScript state, and restored its controls after restart. No lesson HTML was manually corrected.

Generated-content limits remain explicit: the source-based Go and Gemini lessons rounded a gradient update through a coarse slider. The source-based Gemini lesson also omitted authored slider persistence. Its displayed forward values and gradients matched independent calculations, and the step reduced loss, but its exact update did not match the stated learning rate. These limitations are recorded in the live reports; structural and provider checks do not prove complete mathematical correctness or adherence to every teaching instruction. The system prompt gives general guidance to retain exact computational state and round only display values.

The approved [Windows/Claude PR](https://github.com/thanicsamin/loom/pull/1) is integrated. Its memory recovery uses a writable handle, Claude prompts use private files to avoid command-line limits, and npm wrapper targets come from package metadata. Local tests simulate Windows wrapper resolution and exercise large Unicode prompts through a real child process; this host runs Linux.

Antigravity's actual catalog also advertised Claude Opus/Sonnet 5.5 Low/Medium/High and GPT-OSS 120B Medium. All are exposed. Deterministic transport checks verify that non-Google selections send their exact advertised slugs. Live inference for these additional models remains untested; Gemini 3.8 Flash was tested live as described above.

A credential audit compared local account tokens with all Git blobs, commit messages and tags, scanned common token/private-key patterns, and checked the packaged app. No matches were found. Temporary copied live-test account files were removed.

Linux is validated here. macOS/Windows builds, their clipboard behavior, and live Claude inference remain unverified. Voice and dictation are deferred.

Reports, downloaded source papers, credentials, and screenshots remain local under ignored test directories. Run instructions are in [README.md](README.md).
