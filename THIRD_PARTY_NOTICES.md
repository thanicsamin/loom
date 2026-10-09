# Third-party notices

Loom depends on open-source packages that retain their own copyright and license notices in the installed dependencies and packaged application. Principal packages include Electron, React, Pi coding agent / Pi AI, KaTeX, Chart.js, DOMPurify, marked, lucide-react, pdf-parse / PDF.js, @napi-rs/canvas, the Agent Client Protocol SDK, and the Model Context Protocol SDK.

The calligraphic L logo uses an outline from KaTeX's `KaTeX_Caligraphic-Regular.ttf`. Its applicable font license and copyright notice are retained in the bundled KaTeX package.

The OptMem repository inspired the append-only note and binary summary design. Loom's memory implementation is independently written TypeScript and does not include copied OptMem source.

The Markdown renderer was adapted from the Autoum extension under the MIT license. Its original copyright notice is retained in [LICENSE](LICENSE). Loom builds without the Autoum repository.

Computer Modern Unicode (CMU Serif) webfonts are bundled locally from `computer-modern` 0.1.3 under the SIL Open Font License 1.1. Copyright and license text are shipped as `dist/Computer-Modern-OFL.txt`. Original project: https://cm-unicode.sourceforge.io/.

The Android companion bundles the same React, KaTeX, Chart.js, DOMPurify, marked, lucide, and Computer Modern rendering assets. Native libraries include AndroidX WebKit and Activity (Apache License 2.0), JourneyApps ZXing Android Embedded (Apache License 2.0), and ZXing Core (Apache License 2.0). Desktop phone pairing uses `selfsigned` and `qrcode` (MIT). Package license notices remain in dependencies; Android asset notices are included as `Third-Party-Notices.txt`.
