# Loom UI conventions

Use these conventions for every new or changed control. Preserve the compact desktop layout, readable text, fast startup, and immediate streaming.

## Interaction

- Every enabled button, select, expandable row, and summary needs visible hover feedback, a pointer cursor, and a distinct pressed state. Start feedback immediately. Use short color transitions; never move the layout on hover or press.
- Keyboard focus needs a visible outline. Preserve native keyboard behavior. Escape closes the innermost menu before its dialog. Dialog focus stays inside and returns to the prior control when closed.
- Selected and expanded states must remain recognizable during interaction. Expose them through `aria-pressed` or `aria-expanded` where appropriate.
- Disabled controls remain readable, explain why they are unavailable when useful, and do not display enabled hover or pressed cues. Use native `disabled` for actions that cannot run.
- Keep small icons visually small, but give their controls at least a 24 × 24 CSS pixel target. Do not reduce the conversation's text size to make room.
- Show progress for pending work and a result or error on completion. Use concrete labels such as “Adding files…” and “Instructions saved.”

## Themes and readability

- Use the shared tokens and interaction rules in `src/ui.css`. Avoid local hardcoded control colors. Primary, selected, and inverted surfaces have their own state colors.
- Text must maintain at least 4.5:1 contrast in normal, hover, pressed, and focus states. Icons that convey an action need at least 3:1. Loom also keeps secondary and disabled text readable.
- Give dropdown options an opaque themed background. Check the open popup, not just the closed select. System appearance must follow the OS in both directions.
- Support reduced motion. Keep focus visible without animation. Do not signal important state changes by color alone.
- Retain the dense spacing and plain language. Avoid ornamental copy, redundant controls, and oversized empty canvas frames.

## Verification

Run `npm run test:contrast` for shared controls or theme changes. It opens actual Electron menus, measures rendered text colors, exercises hover/pressed/focus/disabled behavior, checks keyboard selection and Escape, and verifies stable geometry in four theme/OS combinations. Run `npm run test:desktop` when interaction behavior changes. Inspect the light and dark screenshots in `test-results/` before shipping.

These checks cover the app shell. Generated HTML has creative freedom; its source prompt should require readable controls and useful interaction, and each explainer needs its own verification.

## Reference guides

- [NN/g: Button States — Communicate Interaction](https://www.nngroup.com/articles/button-states-communicate-interaction/) informs the enabled, disabled, hover, focus, pressed, loading, and selected states.
- [Microsoft Fluent 2: Button usage](https://fluent2.microsoft.design/components/web/react/core/button/usage) informs contrast, action labels, hierarchy, and unavailable-action explanations.
- [Chrome: A customizable select](https://developer.chrome.com/blog/a-customizable-select) documents the native, styleable select picker used by Loom's bundled Chromium.

Loom applies these principles to its own dense interface; it does not depend on the Fluent component library.
