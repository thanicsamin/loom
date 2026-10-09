import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.ts';
import {canvasContent} from '../src/canvas-content.ts';
import {normalizeCanvasMath} from '../src/canvas-math.ts';
test('broken inline JavaScript cannot replace a saved working lesson',async()=>{
  const data=await mkdtemp(join(tmpdir(),'loom-validation-'));try{
    const store=new Store(data);await store.init();const chat=await store.newChat();const c=await store.publishCanvas(chat.id,{title:'Working',html:'<script>const x=1;</script>'});
    await assert.rejects(store.publishCanvas(chat.id,{id:c.id,title:'Broken',html:'<script>const x=;</script>'}),/invalid JavaScript.*Nothing was saved/);
    assert.equal(store.canvas(c.id).revision,1);assert.equal(store.canvas(c.id).title,'Working');assert.equal(store.canvas(c.id).versions.length,0);
    await store.publishCanvas(chat.id,{title:'Data',html:'<script type="application/json">{"data":1}</script><script type="module">export const x=1;</script>'});
  }finally{await rm(data,{recursive:true,force:true});}
});
test('wrapping a lesson preserves document tag strings inside JavaScript, styles, and comments',()=>{
  const raw='<script>const example="<html><head></head><body>Example</body></html>";</script>';
  assert.equal(canvasContent('<html><head></head><body>'+raw+'</body></html>'),raw);
});
test('math rendering removes a redundant escape layer while preserving legitimate TeX matrix rows',()=>{
  const real=String.raw`\mathbb{R}^2`,matrix=String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`;
  assert.equal(normalizeCanvasMath(real),real);
  assert.equal(normalizeCanvasMath(real.replaceAll('\\','\\\\')),real);
  assert.equal(normalizeCanvasMath(matrix),matrix);
  assert.equal(normalizeCanvasMath(matrix.replaceAll('\\','\\\\')),matrix);
  assert.equal(normalizeCanvasMath(String.raw`a\\b`),String.raw`a\\b`);
  assert.equal(normalizeCanvasMath(String.raw`\\unknowncommand{x}`),String.raw`\\unknowncommand{x}`);
});

test('formula containers require marked LaTeX without rejecting prose or declarative math',async()=>{
  const data=await mkdtemp(join(tmpdir(),'loom-math-validation-'));try{
    const store=new Store(data);await store.init();const chat=await store.newChat();
    await assert.rejects(store.publishCanvas(chat.id,{title:'Plain formula',html:'<div class="formula">x^2 = 4</div>'}),/plain text instead of LaTeX/);
    await store.publishCanvas(chat.id,{title:'Marked formula',html:'<div class="formula">$x^2=4$</div><span class="math" data-math="x=2"></span><p>A prose explanation.</p>'});
  }finally{await rm(data,{recursive:true,force:true});}
});
