import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store, scopedPath } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { canvasDocument } from '../src/canvas-document.ts';
import { canvasPreviewDocument } from '../src/canvas-preview-document.ts';
import { SYSTEM_PROMPT } from '../src/system-prompt.ts';
const temporary = () => mkdtemp(join(tmpdir(), 'loom-test-'));
test('Android asset routing preserves authored source and learner state',()=>{
 const html='<p>Keep studio://app/ as literal lesson text.</p>',state={answer:'studio://app/'};
 const android=canvasDocument(html,state,'test',{},[],{},'android');
 assert(android.includes(html));assert(android.includes(JSON.stringify(state)));
 assert(android.includes('https://appassets.androidplatform.net/assets/canvas-toolkit.js'));
 assert(android.includes("connect-src 'none'"));
 assert(canvasPreviewDocument('test',{},'android').includes('https://appassets.androidplatform.net/assets/canvas-preview.js'));
 assert(canvasDocument(html,state,'test').includes('src="studio://app/canvas-toolkit.js"'));
});
async function until(check: () => boolean, ms = 12000) { const start=Date.now(); while(!check()) { if(Date.now()-start>ms)throw Error('Timed out'); await new Promise(r=>setTimeout(r,20)); } }

test('project chat folders and real disk folders remain distinct; paths cannot escape through traversal or links', async () => {
  const root=await temporary(); try {
    const store=new Store(join(root,'data'));await store.init();const path=join(root,'project');await mkdir(path);const project=await store.createProject('Lab',path);
    const folder=await store.createFolder({kind:'chat',projectId:project.id,name:'Lessons'});assert('id' in folder);const nested=await store.createFolder({kind:'chat',projectId:project.id,parent:folder.id,name:'Physics'});assert('id' in nested);
    const chat=await store.newChat({projectId:project.id,folderId:nested.id});await store.createFolder({kind:'disk',chatId:chat.id,projectId:project.id,name:'Sources'});
    await store.writeProjectFile(chat.id,'Sources/notes.txt','Real project notes');assert.equal(await store.readProjectFile(chat.id,'Sources/notes.txt'),'Real project notes');
    await assert.rejects(stat(join(path,'Lessons')));assert.equal((await stat(join(path,'Sources'))).isDirectory(),true);
    await assert.rejects(scopedPath(path,'../outside',true),/inside/);await symlink(root,join(path,'escape'));await assert.rejects(scopedPath(path,'escape/secret',true),/outside/);
    await assert.rejects(store.createFolder({kind:'disk',projectId:project.id,name:'../escape'}),/separators/);
    await assert.rejects(store.newChat({projectId:project.id,folderId:'missing'}),/folder/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('attachments are copied, isolated by chat, bounded under concurrent uploads, and retained across restart', async () => {
  const root=await temporary();try{
    const store=new Store(root);await store.init();const chat=await store.newChat(),other=await store.newChat();
    const results=await Promise.allSettled(Array.from({length:12},(_,i)=>store.addAttachment(chat.id,`../../${i}.txt`,'text/plain',Buffer.from('Example source'))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10);assert.equal(chat.draftAttachments.length,10);const item=store.attachment(chat.draftAttachments[0]);assert(!item.name.includes('/'));
    await assert.rejects(store.attachmentContext(other.id,[item.id]),/another chat/);await assert.rejects(store.addAttachment(other.id,'fake.png','image/png',Buffer.from('<html>')),/PNG/);
    await store.flush();const reopened=new Store(root);await reopened.init();assert.equal(reopened.chat(chat.id).draftAttachments.length,10);assert.equal(await readFile(item.path,'utf8'),'Example source');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('canvas revisions preserve meaningful interaction state and restore previous source',async()=>{
  const root=await temporary();try{const store=new Store(root);await store.init();const chat=await store.newChat();const c=await store.publishCanvas(chat.id,{title:'Quiz',html:'<button>One</button>'});await store.saveCanvasState(c.id,{answer:'A',slider:2});await store.publishCanvas(chat.id,{id:c.id,title:'Quiz',html:'<button>Two</button>'});assert.deepEqual(store.canvas(c.id).state,{answer:'A',slider:2});await store.restoreCanvas(c.id,0);assert.equal(store.canvas(c.id).html,'<button>One</button>');assert.equal(store.canvas(c.id).revision,3);await assert.rejects(store.saveCanvasState(c.id,'x'.repeat(70000)),/too large/);await store.publishCanvas(chat.id,{id:c.id,title:'Quiz',html:'<p>Reset</p>',resetState:true});assert.equal(store.canvas(c.id).state,null);}finally{await rm(root,{recursive:true,force:true});}
});
test('canvas policy precedes even malformed source; prompt has canvas freedom, ASD-STE100, and purposeful diagrams',()=>{
  const doc=canvasDocument('<script>fetch("https://example.com")</script><head></head>',{text:'</script>'},'test');assert(doc.indexOf('Content-Security-Policy')<doc.indexOf('fetch('));assert(doc.includes('connect-src \'none\''));assert(doc.includes('\\u003c/script>'));assert.match(SYSTEM_PROMPT,/80% ASD-STE100/);assert.match(SYSTEM_PROMPT,/FULL CREATIVE FREEDOM/);assert.match(SYSTEM_PROMPT,/convinced of their explanatory power/);
});
test('adding a free Go promo preserves the complete provider catalog and never replaces an unavailable selection',async()=>{
  const root=await temporary(),engine=new Engine(root,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();await engine.handle('refreshAccounts',{});assert(engine.runtime.getModel('opencode-go','longcat-2.5-preview-free'));assert(engine.runtime.getModel('opencode-go','step-5-preview-free'));assert(engine.runtime.getModels('opencode-go').length>5);assert.equal(engine.snapshot().providers.find(p=>p.id==='opencode-go')!.models[0].id,'step-5-preview-free');engine.runtime.registerProvider('opencode-go',{apiKey:'local-fixture-key',models:[{id:'local-only',name:'Local',api:'openai-completions',baseUrl:'http://127.0.0.1:1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8000,maxTokens:1000}]});const chat=await engine.store.newChat({provider:'opencode-go',model:'unavailable-free-model'});await assert.rejects(engine.send(chat.id,'Use the selected model'),/No model is available/);}
  finally{await engine.close();await rm(root,{recursive:true,force:true});}
});

test('real Pi HTTP stream invokes canvas tool, consumes initial steering, and preserves newer drafts',async()=>{
  const root=await temporary();const requests:any[]=[];const requestHeaders:any[]=[];let gate:()=>void=()=>{};const waiting=new Promise<void>(r=>gate=r);
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);requests.push(payload);requestHeaders.push(req.headers);res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk=(delta:any,finish:any=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
    if(requests.length===1){await waiting;chunk({role:'assistant',tool_calls:[{index:0,id:'call_canvas',type:'function',function:{name:'publish_canvas',arguments:JSON.stringify({title:'Pi fixture',html:'<button id="working">A real tool result</button>'})}}]},'tool_calls');}
    else {chunk({role:'assistant',content:'The canvas is ready.'});chunk({},'stop');}res.end('data: [DONE]\n\n');
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const engine=new Engine(root,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();engine.runtime.registerProvider('opencode-go',{api:'openai-completions',apiKey:'local-fixture-key',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,models:[{id:'local',name:'Local fixture',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:4000}]});
    const chat=await engine.store.newChat({provider:'opencode-go',model:'local'});chat.draft='Build a canvas';await engine.store.commit();
    await engine.send(chat.id,'Build a canvas');await engine.send(chat.id,'Add a clear label');await until(()=>requests.length===1);await engine.handle('saveDraft',{chatId:chat.id,text:'My next question'});gate();await until(()=>!engine.runs.get(chat.id)?.busy);
    assert.equal(engine.store.db.canvases.length,1);assert.equal(engine.store.db.canvases[0].title,'Pi fixture');assert.equal(engine.snapshot().canvases[0].html,'');assert.match((await engine.handle('getCanvas',{id:engine.store.db.canvases[0].id})).html,/A real tool result/);assert(chat.messages.some(m=>m.text==='Add a clear label'&&m.steering));assert.equal(chat.draft,'My next question');assert(requests[0].messages.some((m:any)=>JSON.stringify(m).includes('Add a clear label')));assert(chat.messages.some(m=>m.text.includes('canvas is ready')));assert.equal(engine.runs.get(chat.id)?.error,undefined);
    await engine.send(chat.id,'Continue this conversation');await until(()=>!engine.runs.get(chat.id)?.busy);
    engine.runs.get(chat.id)!.session!.settingsManager.applyOverrides({compaction:{keepRecentTokens:1,reserveTokens:100}});
    await engine.runs.get(chat.id)!.session!.compact();
    assert(requestHeaders.length>=4,'Observe tool continuation, another turn, and compaction requests');
    for(const headers of requestHeaders){assert.equal(headers['x-opencode-session'],chat.id);assert.equal(headers['user-agent'],'loom-studio/0.1.0');}
    const other=await engine.store.newChat({provider:'opencode-go',model:'local'});await engine.send(other.id,'A separate conversation');await until(()=>!engine.runs.get(other.id)?.busy);assert.equal(requestHeaders.at(-1)['x-opencode-session'],other.id);
  }finally{gate();await engine.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('Jev uses the real classifier HTTP protocol and treats low confidence or invalid probabilities as uncertain',async(context)=>{
  let clock=Date.now();context.mock.method(Date,'now',()=>clock);
  const root=await temporary();let malformed=false;let captured:any;
  const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;captured=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answers:{concept:{type:'choice',choice:'demonstrated',confidence:malformed?.9:.4,probabilities:{missing:0,partial:0,demonstrated:malformed?2:1,contradicted:0}}}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const engine=new Engine(root,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();engine.runtime.registerProvider('typesafe',{apiKey:'local-fixture-key',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,models:[{type:'classifier',api:'typesafe-system-one',id:'jev-local',name:'Jev fixture',input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000}]});const chat=await engine.store.newChat();const c=await engine.store.publishCanvas(chat.id,{title:'Concept',html:'<p>A concept</p>',rubric:[{id:'concept',label:'Concept',description:'Frequency is cycles per second.',hint:'Describe one second.'}]});
    engine.store.db.settings.judge='typesafe';engine.store.db.settings.judgeModel='jev-unavailable-free';await assert.rejects(engine.grade(c.id,'Use only the selected judge'),/selected Jev model is unavailable/);assert.equal(typeof captured,'undefined');engine.store.db.settings.judge='typesafe';engine.store.db.settings.judgeModel='jev-local';
    const grade=await engine.grade(c.id,'Two cycles each second means 2 Hz.');assert.equal(grade.items[0].status,'uncertain');assert.equal(captured.questions.concept.type,'choice');assert.equal(captured.state.answer,'Two cycles each second means 2 Hz.');await assert.rejects(engine.grade(c.id,'again'),/moment/);clock+=770;malformed=true;assert.equal((await engine.grade(c.id,'same')).items[0].status,'uncertain');
  }finally{await engine.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
test('editing a live answer cancels the old Jev request and only the newest judgement completes',async()=>{
  const root=await temporary();let received=0;const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const payload=JSON.parse(body);received++;setTimeout(()=>{if(res.destroyed)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answers:{concept:{type:'choice',choice:payload.state.answer==='new'?'demonstrated':'contradicted',confidence:.95,probabilities:{missing:0,partial:0,demonstrated:payload.state.answer==='new'?1:0,contradicted:payload.state.answer==='new'?0:1}}}}));},payload.state.answer==='old'?1000:10);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const engine=new Engine(root,()=>{},join(process.cwd(),'dist/mcp.cjs'));
  try{await engine.init();engine.runtime.registerProvider('typesafe',{apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,models:[{type:'classifier',api:'typesafe-system-one',id:'jev-local',name:'Jev',input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000}]});const chat=await engine.store.newChat(),canvas=await engine.store.publishCanvas(chat.id,{title:'Live',html:'<p>Question</p>',rubric:[{id:'concept',label:'Concept',description:'A correct concept.'}]});engine.store.db.settings.judge='typesafe';engine.store.db.settings.judgeModel='jev-local';const old=engine.grade(canvas.id,'old');const rejected=assert.rejects(old,/replaced|abort/i);await until(()=>received===1);await engine.handle('cancelGrade',{id:canvas.id});await new Promise(r=>setTimeout(r,270));assert.equal((await engine.grade(canvas.id,'new')).items[0].status,'demonstrated');await rejected;
  }finally{await engine.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('identical Jev answers reuse a bounded result while revised rubrics and uncertain grades are checked again',async()=>{
 const root=await temporary();let requests=0,uncertain=false;let captured:any;const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;captured=JSON.parse(body);requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answers:{concept:{type:'choice',choice:'demonstrated',confidence:uncertain?.4:.99,probabilities:{missing:.01,partial:.01,demonstrated:.97,contradicted:.01}}}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const engine=new Engine(root,()=>{},join(process.cwd(),'dist/mcp.cjs'));
 try{await engine.init();engine.runtime.registerProvider('typesafe',{apiKey:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,models:[{type:'classifier',api:'typesafe-system-one',id:'jev-local',name:'Jev fixture',input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000}]});await engine.handle('settings',{judge:'typesafe',judgeModel:'jev-local'});const chat=await engine.store.newChat();const canvas=await engine.store.publishCanvas(chat.id,{title:'Concept',html:'<p>Explain.</p>',rubric:[{id:'concept',label:'Frequency',description:'Frequency is cycles per second.'}]});const input={question:'What is frequency?',answer:'Three cycles in each second means 3 Hz.'};const first=await engine.grade(canvas.id,input),start=performance.now();const again=await engine.grade(canvas.id,input);assert.deepEqual(again,first);assert(performance.now()-start<30);assert.equal(requests,1);assert.equal(captured.state.answer,input.answer);assert.equal(captured.state.question,input.question);again.items[0].status='contradicted';assert.equal((await engine.grade(canvas.id,input)).items[0].status,'demonstrated','Callers cannot mutate a cached judgement');
  await new Promise(r=>setTimeout(r,210));await engine.store.publishCanvas(chat.id,{id:canvas.id,title:'Revised question',html:'<p>A revised lesson.</p>',rubric:[{id:'concept',label:'Frequency',description:'State the units and compare the period.'}]});uncertain=true;assert.equal((await engine.grade(canvas.id,input)).items[0].status,'uncertain');assert.equal(requests,2);await new Promise(r=>setTimeout(r,210));await engine.grade(canvas.id,input);assert.equal(requests,3,'Uncertain results remain eligible for fresh checking');
 }finally{await engine.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
