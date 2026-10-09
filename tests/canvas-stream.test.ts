import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appendCanvas} from '../src/canvas-stream.ts';
import {Engine} from '../src/engine.ts';
import {lessonSearchTerm} from '../src/lesson-sources.ts';

test('canvas chunks concatenate exactly, bound memory, and reject unrelated draft ids',()=>{
  const first=appendCanvas(undefined,{title:'A lesson',html:'<p>First'});assert.equal(appendCanvas(first,{id:first.id,html:' part</p>'}).html,'<p>First part</p>');assert.equal(appendCanvas(first,{id:first.id,html:'<p>Repaired</p>',replace:true}).html,'<p>Repaired</p>');assert.throws(()=>appendCanvas(first,{id:'other',html:'oops'}),/returned/);assert.throws(()=>appendCanvas(first,{id:first.id,html:'x'.repeat(2_000_000)}),/full canvas/);
});
test('partial documents never persist; invalid final scripts can be repaired; revisions preserve state and ownership',async()=>{
  const data=await mkdtemp(join(tmpdir(),'loom-stream-')),events:any[]=[],engine=new Engine(data,e=>events.push(e),join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();const chat=await engine.store.newChat(),other=await engine.store.newChat();(engine as any).run(chat.id).busy=true;
    const first=await (engine as any).streamCanvas(chat.id,{title:'Streaming',html:'<p>Early figure</p>'});assert.equal(engine.store.db.canvases.length,0);assert(!JSON.stringify(engine.snapshot()).includes('Early figure'));assert(events.some(e=>e.type==='canvas-preview'&&e.preview.html.includes('Early figure')));
    await assert.rejects((engine as any).streamCanvas(chat.id,{id:first.id,html:'<script>const x = ;</script>',complete:true}),/JavaScript/);assert.equal(engine.store.db.canvases.length,0);
    const final=await (engine as any).streamCanvas(chat.id,{id:first.id,html:'<p>Complete</p><script>const x = 1;</script>',replace:true,complete:true});assert.equal(engine.store.db.canvases.length,1);assert.equal(engine.snapshot().runs.find(r=>r.chatId===chat.id)?.preview,undefined);
    await engine.store.saveCanvasState(final.id,{answer:'Keep me'});const revision=await (engine as any).streamCanvas(chat.id,{id:final.id,title:'Revised',html:'<p>Updated'});assert.equal(engine.store.canvas(final.id).revision,1);assert.deepEqual(engine.store.canvas(final.id).state,{answer:'Keep me'});
    await (engine as any).streamCanvas(chat.id,{id:revision.id,html:' lesson</p>',complete:true});assert.equal(engine.store.canvas(final.id).revision,2);assert.deepEqual(engine.store.canvas(final.id).state,{answer:'Keep me'});
    (engine as any).run(other.id).busy=true;await assert.rejects((engine as any).streamCanvas(other.id,{id:final.id,title:'Wrong chat',html:'oops'}),/another chat/);
    await (engine as any).streamCanvas(chat.id,{title:'Unfinished',html:'<p>Draft</p>'});await engine.stop(chat.id);assert.equal(await engine.handle('getPreview',{chatId:chat.id}),null);assert.equal(engine.store.db.canvases.length,1);
  }finally{await engine.close();await rm(data,{recursive:true,force:true});}
});
test('project retrieval searches the exact request term rather than a guessed related subject',()=>{
  assert.equal(lessonSearchTerm('Teach me cde triangles in representation theory.'),'cde');assert.equal(lessonSearchTerm('Teach me the fast Fourier transform.'),'fast');assert.equal(lessonSearchTerm('Help me understand cohomology.'),'cohomology');assert.equal(lessonSearchTerm('Thanks!'),undefined);
});
