import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdown,renderMarkdown} from '../src/markdown.ts';

test('display formulas following prose survive equals and dash lines that resemble Setext headings',()=>{
  for(const [open,close] of [['\\[','\\]'],['$$','$$']])for(const operator of ['=','-']){
    const source=`A calculation follows.\n${open}\nf(x)\n${operator}\nx^2 + 1\n${close}\n\nAnother paragraph.`;
    const parsed=parseMarkdown(source);assert.equal(parsed.math.size,1);assert.equal([...parsed.math.values()][0].source.trim(),`f(x)\n${operator}\nx^2 + 1`);assert(!/<h[12]>/.test(parsed.html));
    const rendered=renderMarkdown(source,h=>h);assert(rendered.includes('katex-display'));assert(!rendered.includes('katex-error'));assert(rendered.includes('Another paragraph.'));
  }
});
test('real Setext headings, fenced code, inline code and currency retain Markdown behavior',()=>{
  const source='A real heading\n===\n\nAnother heading\n---\n\n```tex\n\\[\nf(x)\n=\nx^2\n\\]\n```\n\n`\\[literal\\]` costs $5 or $10. Inline math: $x^2$.';
  const parsed=parseMarkdown(source);assert(parsed.html.includes('<h1>A real heading</h1>'));assert(parsed.html.includes('<h2>Another heading</h2>'));assert.equal(parsed.math.size,1);assert.equal([...parsed.math.values()][0].source,'x^2');assert(parsed.html.includes('costs $5 or $10.'));
});
test('multiline display math retains underbraces, matrix row separators, and subsequent formulas',()=>{
  const source=String.raw`Trace the operations.
\[
F
=
\underbrace{a}_{\text{first}}\underbrace{b}_{\text{second}}
\]

Matrix:
\[
\begin{pmatrix}1&2\\3&4\end{pmatrix}
\]

Then $F=ab$.`;
  const parsed=parseMarkdown(source);assert.equal(parsed.math.size,3);assert([...parsed.math.values()][1].source.includes(String.raw`2\\3`));const html=renderMarkdown(source,h=>h);assert(!html.includes('katex-error'));assert(!parsed.html.includes('underbrace'));
});
