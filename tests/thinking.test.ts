import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexModelInfo,piThinking,validateThinking} from '../src/thinking.ts';
import {Engine} from '../src/engine.ts';
import {Store} from '../src/store.ts';

test('model catalogs supply thinking levels, including future values, without guessed capabilities',()=>{
  const a=codexModelInfo({id:'one',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Fast reasoning'},{reasoningEffort:'ultra',description:'Deep reasoning'}],defaultReasoningEffort:'ultra'});
  assert.deepEqual(a.thinking?.map(x=>x.value),['low','ultra']);assert.equal(a.defaultThinking,'ultra');assert.equal(a.thinking?.[0].description,'Fast reasoning');
  assert.equal(codexModelInfo({id:'unknown'}).thinking?.length,0);assert.equal(codexModelInfo({id:'unknown',defaultReasoningEffort:'high'}).defaultThinking,undefined);
  assert.deepEqual(piThinking({reasoning:true} as any),[]);
  assert.deepEqual(piThinking({reasoning:true,thinkingLevelMap:{off:null,minimal:'low',low:'low',medium:null,high:'high',max:'max'}} as any).map(x=>x.value),['low','high','max']);
  assert.throws(()=>validateThinking(a,'medium'),/unavailable/);assert.equal(validateThinking(a,'ultra'),'ultra');assert.equal(validateThinking(undefined,''),undefined);
});
test('thinking preferences are per model, survive restart, reject invalid changes and busy changes',async()=>{
  const data=await mkdtemp(join(tmpdir(),'loom-thinking-')),engine=new Engine(data,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();engine.runtime.registerProvider('opencode-go',{apiKey:'fixture',models:[{id:'one',name:'One',api:'openai-completions',baseUrl:'http://127.0.0.1:1',reasoning:true,thinkingLevelMap:{low:'low',high:'high'},input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8000,maxTokens:1000},{id:'two',name:'Two',api:'openai-completions',baseUrl:'http://127.0.0.1:1',reasoning:true,thinkingLevelMap:{max:'max'},input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8000,maxTokens:1000}]});
    const chat=await engine.store.newChat({provider:'opencode-go',model:'one'});
    await engine.handle('updateChat',{id:chat.id,thinking:'low'});assert.equal(chat.thinking,'low');
    await assert.rejects(engine.handle('updateChat',{id:chat.id,thinking:'ultra'}),/unavailable/);assert.equal(chat.thinking,'low');
    await engine.handle('updateChat',{id:chat.id,model:'two'});assert.equal(chat.thinking,undefined);await engine.handle('updateChat',{id:chat.id,thinking:'max'});
    await engine.handle('updateChat',{id:chat.id,model:'one'});assert.equal(chat.thinking,'low');
    assert.equal((await engine.store.newChat({provider:'opencode-go',model:'one'})).thinking,'low');
    const reopened=new Store(data);await reopened.init();assert.equal(reopened.chat(chat.id).thinking,'low');
    (engine as any).run(chat.id).busy=true;await assert.rejects(engine.handle('updateChat',{id:chat.id,thinking:'high'}),/Finish or stop/);assert.equal(chat.thinking,'low');(engine as any).run(chat.id).busy=false;
    await engine.handle('updateChat',{id:chat.id,thinking:''});assert.equal(chat.thinking,undefined);
  }finally{await engine.close();await rm(data,{recursive:true,force:true});}
});
test('default and legacy empty judge selections use free Jev, with no paid model fallback',async()=>{
  const data=await mkdtemp(join(tmpdir(),'loom-free-judge-')),engine=new Engine(data,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();assert.equal(engine.store.db.settings.judge,'opencode');assert.equal(engine.store.db.settings.judgeModel,'jev-1.13-free');
    engine.runtime.registerProvider('opencode',{apiKey:'fixture',models:[{type:'classifier',api:'typesafe-system-one',id:'jev-1.13',name:'Paid Jev',baseUrl:'http://127.0.0.1:1',input:['text'],cost:{input:1,output:1,cacheRead:0,cacheWrite:0},contextWindow:8000}]});
    const chat=await engine.store.newChat(),canvas=await engine.store.publishCanvas(chat.id,{title:'Check',html:'<p>A check</p>',rubric:[{id:'idea',label:'Idea',description:'A correct explanation.'}]});
    await assert.rejects(engine.grade(canvas.id,'An answer'),/selected Jev model is unavailable/);
    engine.store.db.settings.judgeModel='';engine.store.db.settings.judge='typesafe';await engine.store.commit();const reopened=new Store(data);await reopened.init();assert.equal(reopened.db.settings.judge,'opencode');assert.equal(reopened.db.settings.judgeModel,'jev-1.13-free');
  }finally{await engine.close();await rm(data,{recursive:true,force:true});}
});
