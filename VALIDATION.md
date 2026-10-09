# Validation

Tested on Linux on 2026-10-08 with Electron 44.4.2 and Pi 1.1.0. The latest deterministic checks launch the development Electron build; earlier packaged checks are also recorded in local reports.

- TypeScript check passed.
- All 28 unit tests passed. They cover scoped paths and symlinks, attachment persistence, canvas validation and revisions, streaming, concurrent Codex chats and context reuse, provider-supported thinking levels, steering and cancellation, Jev classification and caching, PDF parsing/rendering and cache invalidation, arXiv provenance, credential import, and memory persistence.
- All 28 desktop end-to-end checks passed with no renderer errors. These cover direct project chats, real disk folders, PDF pages/citations, native upload and clipboard paste, inline and embedded math, full-height canvases, offline export, themes, steering/Stop, saved state after restart, and a 400-message history.
- Separate screenshot and PDF clipboard tests ran one after the other using actual **Ctrl+V** on Linux. They verified previews, exact image pixels or PDF bytes, sent-message attachment references, and persistence after restart. They restored the prior clipboard contents afterward.
- Reading checks cover locally bundled Computer Modern, the 18 px default, 12/16/18/20/24 px settings, matching chat/canvas fonts and palettes in every appearance, automatic and changing LaTeX, narrow-window reflow, and long lessons without internal scrolling.
- Thinking-selector checks use actual model-catalog fields and protocol fixtures, including pagination, future values, per-model preferences, and Low on the wire. Unknown capabilities remain explicit rather than guessed.
- The theme suite measured at least 4.5:1 text contrast in app menus, labels, placeholders, and selection, across Light, Dark, and both System appearances. It exercised hover, pressed, focus, disabled states, keyboard selection, Escape, and reduced motion. Arbitrary generated diagrams and authored colors require separate visual inspection.
- The streaming test preserved all 1,000 ordered text chunks. A separate progressive-HTML fixture showed readable explanation, typeset math, and a figure before final publication. Incomplete scripts stayed inert; validated final interactions ran normally.
- A real TLS/HTTP2 transport test verified that canceling one quiz check retained the connection for subsequent parallel checks. PDF search results supplied cached physical pages, repeated reads shared work, and editing a PDF invalidated its cache.

Latest desktop measurements on this machine:

| Measurement | Time |
| --- | --- |
| First usable window | 0.64 s |
| Restart | 0.72 s |
| 400-message history startup | 0.65 s |
| Sample canvas ready | 226 ms |
| Slider paint | 28 ms |
| Typing latency, 95th percentile | 33 ms |
| Progressive HTML first preview, local protocol fixture | 330 ms |

The 1383 × 822 history benchmark showed 9 complete short messages at 18 px. The composer accepted typing while provider discovery continued. Earlier separate packaged launches measured 0.57–0.64 s. These are warm-cache Linux measurements, not cold-boot results or guarantees on other hardware. Rendering measurements do not establish model response speed.

## Live teaching checks

An opt-in Luna Low run used ordinary topic requests for nine topics, each in an empty project and a project containing a real source PDF: heaps, FFT, backpropagation, attention, Hecke algebras, the modular representation cde triangle, cohomology, p-adic Galois theory, and the Riesz representation theorem. All 18 produced working figures, controls, conceptual rubrics, and detailed-feedback actions without the user asking for a quiz. Structural checks passed with no renderer errors. These checks are not a complete mathematical review of every lesson.

Live free Jev 1.13 checked misconception and correct-answer attempts in all 18 lessons, including editing an answer during an active check. The earlier live run had a median request time of 355 ms, median visible feedback of 701 ms, and 95th-percentile visible feedback of 1,033 ms with the 300 ms editing pause. Four broad test answers received partial or uncertain criterion results; the UI retained that uncertainty. These measurements precede the dedicated HTTP2 transport and do not prove universal classifier accuracy.

Earlier live Go promo tests verified publication, interaction, saved state, and the live Jev bridge. LongCat short streams returned first text in 2.2–5.3 s; full Step 5 lesson generation was much slower and variable. Promo availability depends on the provider. Tests never substitute an unavailable selected model.

Linux is validated here. macOS/Windows builds, their clipboard behavior, and live Claude/Gemini inference remain unverified. Voice and dictation are deferred. The Antigravity subscription route is not yet implemented; Gemini currently uses the official signed-in Gemini CLI.

Reports, downloaded source papers, credentials, and screenshots remain local under ignored test directories. Run instructions are in [README.md](README.md).
