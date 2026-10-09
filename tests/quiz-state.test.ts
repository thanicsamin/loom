import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,migrateQuizState} from '../src/store.ts';
import type {Canvas} from '../src/shared.ts';
test('quiz answers persist independently of authored object, string, array or null state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-quiz-state-'));
 try{const store=new Store(root);await store.init();const chat=await store.newChat();const canvas=await store.publishCanvas(chat.id,{title:'Lesson',html:'<p>Lesson</p>'});
 for(const value of [{x:3},JSON.stringify({x:4}),[1,2],null]){await store.saveCanvasState(canvas.id,value);await store.saveQuizAnswer(canvas.id,'question','My explanation');await store.saveCanvasState(canvas.id,value);const restarted=new Store(root);await restarted.init();assert.deepEqual(restarted.canvas(canvas.id).state,value);assert.equal(restarted.canvas(canvas.id).quizAnswers?.question,'My explanation');}
 await assert.rejects(store.saveQuizAnswer(canvas.id,'question','a'.repeat(32001)),/Invalid/);await store.publishCanvas(chat.id,{id:canvas.id,title:'Reset',html:'<p>Reset</p>',resetState:true});assert.deepEqual(store.canvas(canvas.id).quizAnswers,{});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('legacy quiz migration recovers string state without coercing legitimate numeric object keys',()=>{
 const value=JSON.stringify({x:1.3});const canvas={state:Object.assign({},value,{quizAnswers:{question:'An answer'}})}as unknown as Canvas;assert(migrateQuizState(canvas));assert.equal(canvas.state,value);assert.deepEqual(canvas.quizAnswers,{question:'An answer'});
 const normal={state:{'0':'a','2':'b',quizAnswers:{question:'Answer'}}}as unknown as Canvas;assert(migrateQuizState(normal));assert.equal(typeof normal.state,'object');
});

test('legacy workspace migration keeps a private recovery copy of the original database',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-quiz-migrate-'));
 try{const store=new Store(root);await store.init();const chat=await store.newChat();const meta=await store.publishCanvas(chat.id,{title:'Legacy',html:'<p>Lesson</p>'});store.canvas(meta.id).state=Object.assign({},JSON.stringify({x:2}),{quizAnswers:{q:'Saved answer'}});await store.commit();const original=await readFile(join(root,'workspace.json'),'utf8');const next=new Store(root);await next.init();assert.equal(next.canvas(meta.id).state,'{"x":2}');assert.equal(next.canvas(meta.id).quizAnswers?.q,'Saved answer');assert.equal(await readFile(join(root,'workspace-before-quiz-state.json'),'utf8'),original);await next.init();assert.equal(await readFile(join(root,'workspace-before-quiz-state.json'),'utf8'),original);}finally{await rm(root,{recursive:true,force:true});}
});
