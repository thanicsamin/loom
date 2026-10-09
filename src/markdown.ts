import { Marked, Tokenizer, type TokenizerAndRendererExtension } from 'marked';
import katex from 'katex';

type Formula = { source: string; display: boolean };
type MathToken = { type: 'loomMath'; raw: string; source: string; display: boolean };

// Cache only immutable formula layout, never messages or sanitized model HTML.
// Both entry count and retained UTF-16 characters (keys included) are bounded.
const layouts = new Map<string, string>();
const layoutLimit = 128, characterLimit = 256 * 1024;
let layoutCharacters = 0;
function mathLayout(formula: Formula): string {
  const key = (formula.display ? 'display:' : 'inline:') + formula.source;
  const cached = layouts.get(key);
  if (cached !== undefined) { layouts.delete(key); layouts.set(key, cached); return cached; }
  let rendered: string;
  try {
    rendered = katex.renderToString(formula.source, {
      displayMode: formula.display, output: 'htmlAndMathml', trust: false,
      throwOnError: false, strict: 'ignore', maxExpand: 1000, maxSize: 10,
    });
  } catch {
    // Unsupported or incomplete streamed formulas must never break a message.
    rendered = formula.source.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  }
  const characters = key.length + rendered.length;
  if (characters <= characterLimit) {
    while (layouts.size && (layouts.size >= layoutLimit || layoutCharacters + characters > characterLimit)) {
      const [oldKey, oldValue] = layouts.entries().next().value!;
      layouts.delete(oldKey); layoutCharacters -= oldKey.length + oldValue.length;
    }
    layouts.set(key, rendered); layoutCharacters += characters;
  }
  return rendered;
}

function formula(src: string): MathToken | undefined {
  const delimiters = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false]] as const;
  for (const [open, close, display] of delimiters) {
    if (!src.startsWith(open)) continue;
    if (open === '$' && (src.startsWith('$$') || /\s/.test(src[1] || ''))) return;
    let end = src.indexOf(close, open.length);
    while (end !== -1) {
      // A delimiter preceded by an odd number of backslashes is escaped.
      let slashes = 0;
      for (let i = end - 1; i >= open.length && src[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0) break;
      end = src.indexOf(close, end + close.length);
    }
    if (end === -1) return;
    const source = src.slice(open.length, end);
    if (!source.trim() || (!display && source.includes('\n'))) return;
    if (open === '$' && (/\s$/.test(source) || /[\d$]/.test(src[end + 1] || ''))) return;
    return { type: 'loomMath', raw: src.slice(0, end + close.length), source, display };
  }
}

// Formulas are recognized by the Markdown lexer, so code spans, fenced code,
// HTML attributes, escaped dollars and link destinations are left untouched.
export function parseMarkdown(text: string) {
  const prefix = 'loom-math-' + crypto.randomUUID();
  const math = new Map<string, Formula>();
  const render = (token: any) => {
    const id = prefix + '-' + math.size;
    math.set(id, { source: token.source, display: token.display });
    return `<span data-loom-math="${id}"></span>`;
  };
  const inline: TokenizerAndRendererExtension = {
    name: 'loomMath', level: 'inline',
    start: src => src.search(/\$|\\[([]/),
    tokenizer: src => formula(src), renderer: render,
  };
  const block: TokenizerAndRendererExtension = {
    name: 'loomMath', level: 'block',
    // Marked searches this hint from src.slice(1); only line breaks are safe.
    start: src => { const match = /\n[ \t]{0,3}(?:\$\$|\\\[)/.exec(src); return match?.index; },
    tokenizer: src => {
      const leading = /^[ \t]{0,3}/.exec(src)![0];
      const token = formula(src.slice(leading.length));
      if (!token?.display) return;
      // Preserve text after the closing delimiter on the same line.
      return { ...token, raw: leading + token.raw };
    }, renderer: render,
  };
  const parser = new Marked({ gfm: true, breaks: false, extensions: [block, inline], tokenizer: {
    lheading(src) {
      const token = Tokenizer.prototype.lheading.call(this, src);
      // A Setext heading may span several lines. Without this guard it can
      // consume a display-math opener and an equation's standalone '=' line
      // before the block extension gets to that formula.
      if (token && /(?:^|\n)[ \t]{0,3}(?:\$\$|\\\[)/.test(token.text)) return;
      return token;
    },
  } });
  return { html: parser.parse(text, { async: false }) as string, math };
}

export function renderMarkdown(text: string, sanitize: (html: string) => string): string {
  const { html, math } = parseMarkdown(text);
  // Sanitize all model/user HTML first. Only our random, per-render placeholders
  // can receive KaTeX's generated layout styles; user-supplied styles stay blocked.
  return sanitize(html).replace(/<span data-loom-math="([^"]+)"><\/span>/g, (placeholder, id: string) => {
    const formula = math.get(id);
    return formula ? mathLayout(formula) : placeholder;
  });
}
