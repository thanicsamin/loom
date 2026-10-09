import {_electron as electron, type ElectronApplication, type Page} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Store} from '../src/store.ts';
import {SYSTEM_PROMPT} from '../src/system-prompt.ts';
import {teachingCases} from './teaching-cases.ts';
import type {PublicState,Canvas} from '../src/shared.ts';

if(process.env.LOOM_TEACHING_LIVE!=='1')throw Error('Set LOOM_TEACHING_LIVE=1. This suite makes real Luna and Jev requests.');
const root=resolve('test-results/teaching'), manifestPath=join(root,'session.json');
await mkdir(root,{recursive:true});
const mode=process.argv[2]||'generate';
type Case={id:string;topic:string;condition:'empty'|'sources';chatId:string;projectId:string;directory:string;generationMs?:number;firstTextMs?:number;canvasId?:string;error?:string;promptHash?:string};
type Manifest={data:string;cases:Case[];model:string;judge:string};
let app:ElectronApplication|undefined,page!:Page;
const rendererErrors:string[]=[];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const save=async(m:Manifest)=>writeFile(manifestPath,JSON.stringify(m,null,2),{mode:0o600});
const state=()=>page.evaluate(()=>window.studio.call<PublicState>('state'));
async function select(c:Case){
  await page.evaluate(id=>window.studio.call('selectChat',{id}),c.chatId);
  // IPC completion precedes the React update. Wait for the project breadcrumb, not a fixed delay.
  await page.locator('.breadcrumb').filter({hasText:c.topic+' · '+c.condition}).waitFor();
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
}
async function launch(m:Manifest){
  const env=Object.fromEntries(Object.entries({...process.env,STUDIO_DATA_DIR:m.data,LOOM_TEACHING_TRACE:join(root,'tools.jsonl')}).filter((e):e is [string,string]=>typeof e[1]==='string'&&e[0]!=='ELECTRON_RUN_AS_NODE'));
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['.','--no-sandbox','--ozone-platform=x11','--force-device-scale-factor=1'],env});
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setContentSize(1440,900);});
  page=await app.firstWindow();page.on('pageerror',e=>rendererErrors.push(e.message));await page.locator('.app').waitFor();
  await page.evaluate(()=>{(window as any).__teachingDeltas={};(window as any).__teachingCompleted={};(window as any).__teachingPreviews={};const busy:Record<string,boolean>={};window.studio.onEvent(event=>{if(event.type==='state'){for(const run of event.state.runs){if(busy[run.chatId]&&!run.busy)(window as any).__teachingCompleted[run.chatId]=Date.now();busy[run.chatId]=run.busy;}}if(event.type==='canvas-preview'&&event.preview&&!(window as any).__teachingPreviews[event.chatId])(window as any).__teachingPreviews[event.chatId]=Date.now();if(event.type==='delta'&&event.delta.trim()&&!(window as any).__teachingDeltas[event.chatId]){(window as any).__teachingDeltas[event.chatId]=Date.now();}});});
  await page.evaluate(()=>window.studio.call('refreshAccounts'));
  const s=await state();assert(s.providers.find(p=>p.id==='openai-codex')?.configured,'A connected Codex subscription is required');
  assert(s.providers.find(p=>p.id==='openai-codex')?.models.some(p=>p.id===m.model),'Luna must be in the real catalog; no model fallback');
  assert(s.providers.find(p=>p.id==='openai-codex')?.models.find(p=>p.id===m.model)?.thinking?.some(t=>t.value==='low'),'Luna Low must be advertised by the provider');
  assert(s.judges.find(j=>j.id==='opencode')?.models.some(p=>p.id===m.judge),'The free Jev route must exist');
  assert.equal(s.settings.customPrompt,'','No per-topic teaching instructions');
}
async function setup(){
  const data=await mkdtemp(join(tmpdir(),'loom-teaching-')),account=process.env.LOOM_ACCOUNT_DIR||join(homedir(),'.config','Loom');
  await mkdir(join(data,'pi'),{mode:0o700});await mkdir(join(data,'codex'),{mode:0o700});
  const auth=JSON.parse(await readFile(join(account,'pi','auth.json'),'utf8'));assert(auth.opencode,'A connected Zen account is required for Jev');
  await writeFile(join(data,'pi','auth.json'),JSON.stringify({opencode:auth.opencode}),{mode:0o600});await copyFile(join(account,'codex','auth.json'),join(data,'codex','auth.json'));
  // Transparent protocol observation around the actual private Codex runtime. No fixture replies.
  const bin=join(data,'runtime/node_modules/@openai/codex/bin');await mkdir(bin,{recursive:true});await writeFile(join(data,'runtime/.ready'),'ready');
  const actual=join(account,'runtime/node_modules/@openai/codex/bin/codex.js');
  await writeFile(join(bin,'codex.js'),`const {spawn}=require('node:child_process'),fs=require('node:fs'),rl=require('node:readline');
const child=spawn(process.execPath,[${JSON.stringify(actual)},...process.argv.slice(2)],{env:process.env,stdio:['pipe','pipe','inherit']});
const pending=new Map(),log=o=>fs.appendFileSync(process.env.LOOM_TEACHING_TRACE,JSON.stringify({at:Date.now(),pid:process.pid,...o})+'\\n');
rl.createInterface({input:child.stdout}).on('line',line=>{try{const p=JSON.parse(line);if(p.method==='item/tool/call'){pending.set(p.id,p.params.tool);const a=p.params.arguments;log({direction:'tool',requestId:p.id,name:p.params.tool,args:['publish_canvas','stream_canvas'].includes(p.params.tool)?{id:a.id,title:a.title,rubric:a.rubric}:a});}}catch{}process.stdout.write(line+'\\n');});
rl.createInterface({input:process.stdin}).on('line',line=>{try{const p=JSON.parse(line);if(p.method==='thread/start')log({direction:'model',model:p.params.model,cwd:p.params.cwd});if(p.method==='turn/start')log({direction:'request',effort:p.params.effort,text:p.params.input.filter(i=>i.type==='text').map(i=>i.text).join('\\n')});if(pending.has(p.id)&&p.result){log({direction:'result',requestId:p.id,name:pending.get(p.id),success:p.result.success});pending.delete(p.id);}}catch{}child.stdin.write(line+'\\n');});
child.on('exit',code=>process.exit(code||0));process.on('SIGTERM',()=>{child.kill('SIGTERM');process.exit(0)});`);
  const store=new Store(data);await store.init();Object.assign(store.db.settings,{theme:'light',judge:'opencode',judgeModel:'jev-1.13-free',customPrompt:''});
  const manifest:Manifest={data,cases:[],model:'gpt-6-luna',judge:'jev-1.13-free'};
  await mkdir(join(root,'sources'),{recursive:true});
  const downloads=await Promise.allSettled(teachingCases.map(async c=>{
    const path=join(root,'sources',c.file);let bytes:Buffer;try{bytes=await readFile(path);}catch{const response=await fetch(c.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`${c.id}: download ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());await writeFile(path,bytes);}
    assert(bytes.subarray(0,1024).includes(Buffer.from('%PDF-')),c.id+' must have a real PDF');return{id:c.id,url:c.url,file:c.file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }));
  for(let i=0;i<downloads.length;i++){const d=downloads[i];if(d.status==='rejected')throw d.reason;console.log('SOURCE',JSON.stringify(d.value));}
  await writeFile(join(root,'sources.json'),JSON.stringify(downloads.map(d=>d.status==='fulfilled'?d.value:null),null,2));
  for(const c of teachingCases)for(const condition of ['empty','sources'] as const){
    const id=c.id+'-'+condition,directory=join(root,'projects',id);await mkdir(directory,{recursive:true});
    if(condition==='sources'){await mkdir(join(directory,'books'),{recursive:true});await copyFile(join(root,'sources',c.file),join(directory,'books',c.file));await writeFile(join(directory,'books/SOURCES.txt'),`${c.file}\nOriginal source: ${c.url}\nThis is the original PDF. Cite physical PDF pages, which may differ from printed labels.\n`);}
    const project=await store.createProject(c.topic+' · '+condition,directory);
    const folder=await store.createFolder({kind:'chat',projectId:project.id,name:'Lessons'});
    assert('id' in folder);const chat=await store.newChat({projectId:project.id,folderId:folder.id,provider:'openai-codex',model:manifest.model});chat.title=c.topic;chat.thinking='low';
    manifest.cases.push({id,topic:c.topic,condition,chatId:chat.id,projectId:project.id,directory});
  }
  await store.commit();await save(manifest);return manifest;
}
async function capture(m:Manifest,c:Case){
  await select(c);
  const s=await state();const metadata=s.canvases.filter(x=>x.chatId===c.chatId);assert(metadata.length,'A topic-only request should create a lesson canvas');
  const canvas=await page.evaluate(id=>window.studio.call<Canvas>('getCanvas',{id}),metadata[0].id);c.canvasId=canvas.id;
  const folder=join(root,'lessons',c.id);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'canvas.json'),JSON.stringify(canvas,null,2));await writeFile(join(folder,'source.html'),canvas.html);
  await writeFile(join(folder,'messages.json'),JSON.stringify(s.chats.find(x=>x.id===c.chatId)!.messages,null,2));
  await page.locator('iframe').first().waitFor();await sleep(300);
  await page.locator(`iframe[src^="studio://canvas/${canvas.id}?"]`).waitFor();
  const frame=page.frames().find(f=>f.url().startsWith('studio://canvas/'+canvas.id+'?'));assert(frame,'The real lesson must render in its own sandbox');
  const ui=await frame.evaluate(()=>({text:document.body.innerText,width:innerWidth,height:document.body.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,figures:document.querySelectorAll('svg,canvas').length,mathErrors:document.querySelectorAll('.katex-error').length,math:document.querySelectorAll('.katex').length,controls:[...document.querySelectorAll('button,input,select,textarea,summary')].map(el=>({tag:el.tagName,id:el.id,type:el.getAttribute('type'),label:el.getAttribute('aria-label')||('labels'in el?(el as HTMLInputElement).labels?.[0]?.textContent:'')||el.textContent,value:'value'in el?(el as HTMLInputElement).value:null})),solutions:[...document.querySelectorAll('details')].map(el=>({open:el.open,label:el.querySelector('summary')?.textContent}))}));
  await writeFile(join(folder,'ui.json'),JSON.stringify(ui,null,2));await page.screenshot({path:join(folder,'initial.png')});
  // Full-document screenshot must not contain host controls over the portion outside the frame.
  await page.locator('iframe').evaluate((el,height)=>{(el as HTMLElement).style.height=height+'px';},ui.height);
  await page.locator('iframe').screenshot({path:join(folder,'lesson.png')});
  const checks={topicOnly:true,low:s.chats.find(x=>x.id===c.chatId)!.thinking==='low',luna:s.chats.find(x=>x.id===c.chatId)!.model===m.model,figure:ui.figures>0,controls:ui.controls.length>3,conceptualRubric:canvas.rubric.length>0,realJev:/Studio(?:\?\.|\.)(?:check|bindQuiz)/.test(canvas.html),detailedFeedback:/Studio(?:\?\.|\.)(?:ask|bindQuiz)/.test(canvas.html),mathRenders:ui.math>0&&ui.mathErrors===0,withinWidth:!ui.overflow,rendererErrors:[...rendererErrors]};
  await writeFile(join(folder,'structural.json'),JSON.stringify(checks,null,2));console.log('LESSON',JSON.stringify({id:c.id,generationMs:Math.round(c.generationMs||0),bytes:canvas.html.length,rubric:canvas.rubric.map(x=>x.id),checks}));
}
try{
  if(mode==='cleanup'){const m=JSON.parse(await readFile(manifestPath,'utf8'));await rm(m.data,{recursive:true,force:true});await rm(manifestPath);}
  else{
    let m:Manifest;try{m=JSON.parse(await readFile(manifestPath,'utf8'));await stat(m.data);}catch{m=await setup();}
    await launch(m);
    const selected=process.argv[3]?.split(',');const cases=m.cases.filter(c=>!selected||selected.includes(c.id));
    if(mode==='reset'){
      await app!.close();app=undefined;const store=new Store(m.data);await store.init();
      for(const c of cases){const previous=store.chat(c.chatId),chat=await store.newChat({projectId:c.projectId,folderId:previous.folderId,provider:'openai-codex',model:m.model});chat.title=c.topic;chat.thinking='low';Object.assign(c,{chatId:chat.id,canvasId:undefined,error:undefined,generationMs:undefined,firstTextMs:undefined,promptHash:undefined});}
      await store.commit();
    }else if(mode==='inspect'){for(const c of cases.filter(c=>c.canvasId))await capture(m,c);}
    else if(mode==='generate'){
      for(let i=0;i<cases.length;i+=2){const batch=cases.slice(i,i+2).filter(c=>!c.canvasId&&!c.error),started=new Map<string,number>(),wallStart=new Map<string,number>();
        for(const c of batch){await select(c);await page.getByRole('textbox',{name:'Message',exact:true}).fill(`Teach me ${c.topic}.`);started.set(c.id,performance.now());wallStart.set(c.id,Date.now());c.promptHash=createHash('sha256').update(SYSTEM_PROMPT).digest('hex');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');
          for(let attempt=0;attempt<100;attempt++){const s=await state();if(s.chats.find(x=>x.id===c.chatId)?.messages.some(x=>x.role==='user'&&x.text===`Teach me ${c.topic}.`))break;if(attempt===99)throw Error('The topic request was not sent to its intended chat');await sleep(50);}console.log('START',c.id);}
        const pending=new Set(batch.map(c=>c.id));let nextLog=Date.now()+30000;
        while(pending.size){const s=await state();for(const c of batch.filter(c=>pending.has(c.id))){const run=s.runs.find(r=>r.chatId===c.chatId);if(run?.error){c.error=run.error;pending.delete(c.id);console.log('FAIL',c.id,c.error);}else if(run&&!run.busy){const completed=await page.evaluate(id=>(window as any).__teachingCompleted[id],c.chatId);c.generationMs=completed?completed-wallStart.get(c.id)!:performance.now()-started.get(c.id)!;const preview=await page.evaluate(id=>(window as any).__teachingPreviews[id],c.chatId);(c as any).firstPreviewMs=preview?preview-wallStart.get(c.id)!:undefined;const first=await page.evaluate(id=>(window as any).__teachingDeltas[id],c.chatId);c.firstTextMs=first?first-wallStart.get(c.id)!:undefined;pending.delete(c.id);await capture(m,c).catch(e=>{c.error=e.message;console.log('FAIL',c.id,c.error);});await save(m);}else if(performance.now()-started.get(c.id)!>540000){await page.evaluate(chatId=>window.studio.call('stop',{chatId}),c.chatId);c.error='Timed out after nine minutes';pending.delete(c.id);}}
          if(Date.now()>nextLog){console.log('PROGRESS',JSON.stringify(batch.filter(c=>pending.has(c.id)).map(c=>({id:c.id,seconds:Math.round((performance.now()-started.get(c.id)!)/1000),activity:s.runs.find(r=>r.chatId===c.chatId)?.activity}))));nextLog=Date.now()+30000;}await sleep(500);}
        await save(m);
      }
    }else throw Error('Unknown mode');
    await save(m);assert.deepEqual(rendererErrors,[],'No renderer errors');if(mode==='generate')assert.deepEqual(cases.filter(c=>c.error).map(c=>({id:c.id,error:c.error})),[],'All topic requests must produce a working lesson');
  }
}finally{await app?.close();}
