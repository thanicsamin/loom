import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.ts';

if(process.env.LOOM_LIVE_TEST!=='1')throw Error('Set LOOM_LIVE_TEST=1 to use connected accounts with the free promo models.');
const data=await mkdtemp(join(tmpdir(),'loom-live-'));await mkdir(join(data,'pi'),{mode:0o700});
const auth=JSON.parse(await readFile(join(process.env.LOOM_ACCOUNT_DIR||join(homedir(),'.config','Loom'),'pi','auth.json'),'utf8'));
await writeFile(join(data,'pi','auth.json'),JSON.stringify({'opencode-go':auth['opencode-go'],opencode:auth.opencode}),{mode:0o600});
const report:any={provider:'opencode-go',model:process.env.LOOM_TEST_MODEL||'step-5-preview-free',promoOnly:true};
let generationStart=0;const engine=new Engine(data,event=>{if(event.type==='delta'&&report.firstTextMs===undefined){report.firstTextMs=performance.now()-generationStart;console.log(JSON.stringify({firstTextMs:report.firstTextMs}));}if(event.type==='state'){const run=event.state.runs.find(r=>r.busy);if(event.state.canvases.length&&report.firstCanvasMs===undefined){report.firstCanvasMs=performance.now()-generationStart;console.log(JSON.stringify({firstCanvasMs:report.firstCanvasMs}));}if(run?.activity)console.log(JSON.stringify({activity:run.activity,canvases:event.state.canvases.length}));}},join(process.cwd(),'dist/mcp.cjs'));let app;
try{
  await engine.init();await engine.handle('refreshAccounts',{});
  const originalStream=engine.runtime.streamSimple.bind(engine.runtime);engine.runtime.streamSimple=(...args)=>{console.log(JSON.stringify({stage:'provider-request',model:args[0].id,messages:args[1].messages.length,elapsedMs:performance.now()-generationStart}));const stream=originalStream(...args);const push=stream.push.bind(stream);let first=true;stream.push=event=>{if(first&&event.type!=='start'){first=false;const elapsedMs=performance.now()-generationStart;report.firstProviderEventMs??=elapsedMs;console.log(JSON.stringify({stage:'first-provider-event',type:event.type,elapsedMs}));}if(event.type==='thinking_delta')report.thinkingChars=(report.thinkingChars||0)+event.delta.length;if(event.type==='toolcall_delta')report.toolCallChars=(report.toolCallChars||0)+event.delta.length;push(event);};return stream;};
  const model=engine.runtime.getModel('opencode-go',report.model);assert(model&&model.cost.input===0&&model.cost.output===0,'This test requires the free promo model.');
  const chat=await engine.store.newChat({provider:'opencode-go',model:model.id});
  const start=generationStart=performance.now();console.log(JSON.stringify({stage:'generating',model:model.id}));await engine.send(chat.id,'Create a compact interactive explainer of y = x squared. Call publish_canvas now. Include exactly one range input labelled x, an output element that displays x squared and updates on input, and a short prediction quiz. Save x with Studio.saveState. Use inline CSS/JS. Add exactly one rubric criterion: id square, label Quadratic relation, description Doubling x multiplies x squared by four. Do not use file or memory tools.');
  const deadline=Date.now()+180000;let loggedBound=false;while(engine.runs.get(chat.id)?.busy&&!engine.store.db.canvases.some(c=>c.chatId===chat.id)){if(!loggedBound&&performance.now()-start>3000){loggedBound=true;console.log(JSON.stringify({stage:'session-ready-check',bound:!!engine.runs.get(chat.id)?.session}));}if(Date.now()>deadline)throw Error('Promo model did not publish a canvas in 180 seconds.');await new Promise(r=>setTimeout(r,100));}
  if(engine.runs.get(chat.id)?.busy){report.responseStoppedAfterCanvas=true;await engine.stop(chat.id);}
  assert.equal(engine.runs.get(chat.id)?.error,undefined);assert(engine.store.db.canvases.length>0,'The model must publish an actual canvas.');report.generationMs=performance.now()-start;
  const canvas=engine.store.db.canvases.find(c=>c.chatId===chat.id)!;report.sourceBytes=Buffer.byteLength(canvas.html);await mkdir('test-results',{recursive:true});await writeFile('test-results/live-promo-source.html',canvas.html);
  // Free Jev checks the same conceptual answer used by the generated lesson.
  const judge=engine.runtime.getModelsOfType('classifier','opencode').find(m=>m.id==='jev-1.13-free');
  if(judge&&judge.cost.input===0&&engine.runtime.hasConfiguredAuth('opencode')){
    await engine.handle('settings',{judge:'opencode',judgeModel:judge.id});const checkStart=performance.now();const grade=await engine.grade(canvas.id,'Doubling x makes y four times larger, because (2x)^2 equals 4x^2.');report.judge={model:judge.id,durationMs:performance.now()-checkStart,statuses:grade.items.map(i=>i.status)};assert(grade.items.length>0);
  }
  await engine.close();
  app=await electron.launch({executablePath:process.env.ELECTRON_PATH||'node_modules/electron/dist/electron',args:['.','--no-sandbox','--ozone-platform=x11'],env:{...process.env,STUDIO_DATA_DIR:data}});
  const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.app').waitFor();
  const frame=page.frameLocator('iframe');await frame.locator('input[type=range]').waitFor();const context=page.frames().find(f=>f.url().startsWith('studio://canvas/'))!;
  const interaction=await context.evaluate(()=>{const input=document.querySelector('input[type=range]') as HTMLInputElement;const min=Number(input.min||0),max=Number(input.max||100);input.value=String(Math.min(max,Math.max(min,3)));input.dispatchEvent(new Event('input',{bubbles:true}));return{value:Number(input.value),expected:Number(input.value)**2};});
  await context.waitForFunction(expected=>[...document.querySelectorAll('output')].some(output=>Number(output.value.trim())===expected),interaction.expected);await page.waitForTimeout(400);report.interaction=interaction;
  const saved=await page.evaluate(id=>window.studio.call('getCanvas',{id}),canvas.id);assert(saved.state,'The model must save the interaction.');assert.deepEqual(errors,[]);assert.equal(await page.locator('.canvas-error').count(),0);
  if(report.judge){const start=performance.now();const grade=await context.evaluate(()=>(window as any).Studio.check('Doubling x multiplies x squared by four: (2x)^2 = 4x^2.'));assert.equal(grade.items[0].status,'demonstrated');report.judge.iframeBridgeVerified=true;report.judge.iframeBridgeMs=performance.now()-start;}
  report.interactiveOutputVerified=true;report.savedStateVerified=true;report.rendererErrors=errors;
  await page.screenshot({path:'test-results/live-promo-canvas.png'});await writeFile('test-results/live-promo-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){report.error=error instanceof Error?error.message:String(error);await mkdir('test-results',{recursive:true});await writeFile('test-results/live-promo-report.json',JSON.stringify(report,null,2));if(app){const page=await app.firstWindow();await page.screenshot({path:'test-results/live-promo-failure.png'}).catch(()=>{});console.log(JSON.stringify(await page.frames().find(f=>f.url().startsWith('studio://canvas/'))?.evaluate(()=>({outputs:[...document.querySelectorAll('output')].map(o=>o.value),range:document.querySelector('input[type=range]')?.outerHTML}))));}throw error;}finally{await app?.close();await engine.close();await rm(data,{recursive:true,force:true});}
