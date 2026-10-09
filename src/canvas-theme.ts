export const READING_FONT='"CMU Serif","Noto Serif",Georgia,serif';
export type CanvasAppearance={theme?:'light'|'dark'|'system';fontSize?:number};
export const readingSize=(size?:number)=>Number.isInteger(size)&&size!>=12&&size!<=24?size!:18;
// Same palette as the conversation. Layout and subject-specific figures remain authored.
export const CANVAS_THEME_CSS=`
:root{--loom-bg:#fafbf9;--loom-panel:#fff;--loom-ink:#273331;--loom-muted:#526158;--loom-line:#d2dad2;--loom-accent:#1f695b;--loom-soft:#e2eee7;--loom-hover:#e8ede7;--loom-error:#a83e35;--loom-font:${READING_FONT};--loom-font-size:18px;color-scheme:light!important}
:root[data-theme=dark]{--loom-bg:#181e1c;--loom-panel:#212a26;--loom-ink:#e2ebe4;--loom-muted:#b4c4b9;--loom-line:#536358;--loom-accent:#9ed8ba;--loom-soft:#2e4639;--loom-hover:#29362e;--loom-error:#ffaca0;color-scheme:dark!important}
@media(prefers-color-scheme:dark){:root[data-theme=system]{--loom-bg:#181e1c;--loom-panel:#212a26;--loom-ink:#e2ebe4;--loom-muted:#b4c4b9;--loom-line:#536358;--loom-accent:#9ed8ba;--loom-soft:#2e4639;--loom-hover:#29362e;--loom-error:#ffaca0;color-scheme:dark!important}}
html{font-size:var(--loom-font-size)!important;font-family:var(--loom-font)!important;background:var(--loom-bg)!important;color:var(--loom-ink)!important}
body{margin:0!important;padding:12px 0!important;background:var(--loom-bg)!important;color:var(--loom-ink)!important;font:1rem/1.55 var(--loom-font)!important;min-height:0!important;overflow:visible!important}
body :where(main,article,header,footer){background:transparent!important;color:var(--loom-ink)!important}
body :where(section,aside,fieldset,.panel,.card,.callout,.formula){background:var(--loom-panel)!important;color:var(--loom-ink)!important;border-color:var(--loom-line)!important;box-shadow:none!important}
body .badge{background:var(--loom-soft)!important;color:var(--loom-ink)!important}
body :where(main,article,section,.panel,.card){max-height:none!important;overflow:visible!important}
body :where(p,li,td,th,label,output,figcaption){font-size:1rem!important;line-height:1.55!important;color:var(--loom-ink)!important}
body :where(button,input,select,textarea,summary){font-family:var(--loom-font)!important;font-size:1rem!important;line-height:1.45!important;color:var(--loom-ink)!important}
body :where(button,input,select,textarea){background:var(--loom-panel)!important;border:1px solid var(--loom-line)!important;border-radius:6px;min-height:28px}
body :where(button,summary){cursor:pointer}
body :where(button:enabled,summary):hover{background:var(--loom-hover)!important;border-color:var(--loom-accent)!important}
body :where(button:enabled,summary):active{background:var(--loom-soft)!important;transform:none!important}
body button:disabled{opacity:1!important;color:var(--loom-muted)!important;cursor:default!important}
body :where(button,input,select,textarea,summary,a,[tabindex]):focus-visible{outline:2px solid var(--loom-accent)!important;outline-offset:3px!important}
body :where(input,select,textarea):hover{border-color:var(--loom-accent)!important}
body :where(h1,h2,h3,h4){font-family:var(--loom-font)!important;color:var(--loom-ink)!important;line-height:1.3!important}
body h1{font-size:1.25rem!important}body h2{font-size:1.125rem!important}body h3{font-size:1rem!important}
body :where(.muted,.sub,.why,.readout,.eyebrow,small){color:var(--loom-muted)!important}
body a{color:var(--loom-accent)!important}body svg text{font-family:var(--loom-font)!important}
body table{border-collapse:collapse}body :where(td,th){border-color:var(--loom-line)!important}body th{background:var(--loom-soft)!important}
body :where(.formula,[data-math]){font-family:inherit!important;color:var(--loom-ink)!important}
body .katex{font-size:1.06em!important}body .katex-display{margin:.5em 0;overflow-x:auto;overflow-y:hidden;padding:.2em 0 .35em}
body .katex-error{color:var(--loom-error)!important}::selection{color:var(--loom-ink);background:var(--loom-soft)}
.loom-feedback-summary{font-size:.9rem;margin:.35em 0;color:var(--loom-muted)}.loom-feedback-ideas{display:flex;flex-wrap:wrap;gap:.4rem;align-items:start}
body .loom-feedback-idea{font-size:.9rem;border:1px solid var(--loom-line);border-radius:6px;padding:.25em .5em;margin:0;max-width:100%}
body .loom-feedback-idea summary{font-size:.9rem!important;padding:0;background:transparent!important}body .loom-feedback-idea p{font-size:.9rem!important;margin:.35em 0 0;max-width:28em}
body :where(.loom-feedback-summary,.loom-feedback-idea)[data-status=demonstrated]{color:var(--loom-accent)!important}body :where(.loom-feedback-summary,.loom-feedback-idea)[data-status=contradicted]{color:var(--loom-error)!important}
body :where(.feedback,.good,.stat,.note){color:var(--loom-ink)!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
export function canvasTheme(appearance:CanvasAppearance={}){
  return `<style id="loom-appearance">${CANVAS_THEME_CSS}</style><script>document.documentElement.dataset.theme=${JSON.stringify(appearance.theme||'system')};document.documentElement.style.setProperty('--loom-font-size',${JSON.stringify(readingSize(appearance.fontSize)+'px')});</script>`;
}
