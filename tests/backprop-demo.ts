import {_electron as electron, type ElectronApplication, type Page} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {Store} from '../src/store.ts';
import {exportStandalone} from '../src/export.ts';
import type {PublicState,Canvas} from '../src/shared.ts';

if(process.env.LOOM_DEMO_LIVE!=='1')throw Error('Set LOOM_DEMO_LIVE=1 to run this demo with connected Codex and Jev accounts.');
const mode=process.argv[2]||'generate';
const artifacts=resolve('demos/backprop');await mkdir(artifacts,{recursive:true});await mkdir('test-results',{recursive:true});
const manifestPath=resolve('test-results/backprop-session.json');
const prompt='Teach me backpropagation with a small interactive network. Show the forward pass, gradients flowing backward, and how a training step changes loss. Give me a prediction quiz and live Jev feedback.';
const wrong='Backprop sends predictions from the input to the loss again. It sends the same unchanged loss gradient to every weight and updates each weight before calculating the other derivatives. An inactive ReLU has derivative one, so all weights still receive nonzero gradients.';
const correct="First compute and save the forward values. Then start from the loss and move backward, multiplying each upstream derivative by the local derivative. The first weight gets (prediction-target) times v times ReLU's derivative times x. Compute all gradients before changing any weights. If z is negative, ReLU's derivative is zero, so w, b, and v get zero gradient. The separate output bias c can still have a nonzero gradient.";
let app:ElectronApplication|undefined,page:Page|undefined;
const errors:string[]=[];
async function launch(data:string,record=false){
  const env=Object.fromEntries(Object.entries({...process.env,STUDIO_DATA_DIR:data}).filter((e):e is [string,string]=>typeof e[1]==='string'&&e[0]!=='ELECTRON_RUN_AS_NODE'));
  app=await electron.launch({executablePath:process.env.ELECTRON_PATH||resolve('release/linux-unpacked/loom-studio'),args:['.','--no-sandbox','--ozone-platform=x11','--force-device-scale-factor=1'],env,...(record?{recordVideo:{dir:join(artifacts,'raw'),size:{width:1600,height:820}}}:{})});
  await app.evaluate(({BrowserWindow},record)=>BrowserWindow.getAllWindows()[0].setContentSize(record?1600:1440,record?820:900),record);
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.app').waitFor();
  await page.evaluate(()=>window.studio.call('refreshAccounts'));
  return page;
}
const state=()=>page!.evaluate(()=>window.studio.call<PublicState>('state'));
async function wait(test:()=>Promise<boolean>,timeout=30000){const deadline=Date.now()+timeout;while(!await test()){if(Date.now()>deadline)throw Error('Demo condition timed out');await new Promise(r=>setTimeout(r,100));}}
const number=async(id:string)=>page!.frameLocator('iframe').locator('#'+id).evaluate(el=>Number((el as HTMLOutputElement).value||el.textContent));
async function values(){return Object.fromEntries(await Promise.all(['prediction-value','loss-value','grad-w','grad-b','grad-v','grad-c'].map(async id=>[id,await number(id)])));}
const reference=(p:{w:number;b:number;v:number;c:number})=>{const z=p.w*2+p.b,a=Math.max(0,z),prediction=p.v*a+p.c,e=prediction-1;return{z,a,prediction,loss:.5*e*e,w:e*p.v*(z>0?1:0)*2,b:e*p.v*(z>0?1:0),v:e*a,c:e};};
function close(a:number,b:number,label:string,tolerance=1e-5){assert(Math.abs(a-b)<tolerance,`${label}: ${a} vs ${b}`);}
async function slider(label:string,value:number){await page!.frameLocator('iframe').getByRole('slider',{name:label,exact:true}).evaluate((el,value)=>{const input=el as HTMLInputElement;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function canvas(id:string){return page!.evaluate(id=>window.studio.call<Canvas>('getCanvas',{id}),id);}

try{
  if(mode==='generate'){
    const data=await mkdtemp(join(tmpdir(),'loom-backprop-'));const account=process.env.LOOM_ACCOUNT_DIR||join(homedir(),'.config','Loom');
    await mkdir(join(data,'pi'),{mode:0o700});await mkdir(join(data,'codex'),{mode:0o700});
    const auth=JSON.parse(await readFile(join(account,'pi','auth.json'),'utf8'));
    assert(auth.opencode,'The demo needs the connected OpenCode Zen Jev account.');
    await writeFile(join(data,'pi','auth.json'),JSON.stringify({opencode:auth.opencode}),{mode:0o600});
    await copyFile(join(account,'codex','auth.json'),join(data,'codex','auth.json'));
    await symlink(join(account,'runtime'),join(data,'runtime'));
    const store=new Store(data);await store.init();store.db.settings.theme='light';store.db.settings.judge='opencode';store.db.settings.judgeModel='jev-1.13-free';
    store.db.settings.customPrompt=await readFile('tests/backprop-demo-instructions.md','utf8');
    const chat=await store.newChat({provider:'openai-codex',model:'gpt-6.1-sol'});chat.title='Backpropagation';await store.commit();
    await writeFile(manifestPath,JSON.stringify({data,chatId:chat.id,artifacts,prompt},null,2),{mode:0o600});
    await launch(data);const catalog=await state();assert(catalog.providers.find(p=>p.id==='openai-codex')?.configured,'Codex must be signed in');
    assert(catalog.judges.find(j=>j.id==='opencode')?.models.some(m=>m.id==='jev-1.13-free'),'The selected Jev model must exist');
    await page!.getByRole('textbox',{name:'Message',exact:true}).fill(prompt);const start=performance.now();await page!.getByRole('textbox',{name:'Message',exact:true}).press('Enter');
    console.log('Generating a real backprop lesson with GPT-6.1 Sol…');
    let nextLog=Date.now()+30000;
    await wait(async()=>{const s=await state(),run=s.runs.find(r=>r.chatId===chat.id);if(run?.error)throw Error(run.error);if(Date.now()>nextLog){console.log(JSON.stringify({stage:'generating',elapsedSeconds:Math.round((performance.now()-start)/1000),activity:run?.activity||'model thinking',canvases:s.canvases.length}));nextLog=Date.now()+30000;}return !!s.canvases.length&&!run?.busy;},480000);
    const s=await state(),id=s.canvases.find(c=>c.chatId===chat.id)!.id,c=await canvas(id);
    assert(c.rubric.length===3,'The lesson must have a conceptual rubric');
    await writeFile(join(artifacts,'source.html'),c.html);await writeFile(join(artifacts,'rubric.json'),JSON.stringify(c.rubric,null,2));
    await writeFile(manifestPath,JSON.stringify({data,chatId:chat.id,canvasId:id,artifacts,prompt,generationMs:performance.now()-start,model:'gpt-6.1-sol',judge:'jev-1.13-free'},null,2),{mode:0o600});
    await page!.frameLocator('iframe').getByRole('button',{name:'Forward pass',exact:true}).waitFor();
    await page!.screenshot({path:join(artifacts,'initial.png')});
    console.log(JSON.stringify({stage:'generated',generationMs:performance.now()-start,sourceBytes:Buffer.byteLength(c.html),rubric:c.rubric.map(r=>r.id),rendererErrors:errors}));
  }else if(mode==='refine'){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));await launch(manifest.data);const revision=(await canvas(manifest.canvasId)).revision;
    const request='Refine the existing backprop canvas, keeping its id, rubric, working interactions and test labels. Its math passed independent finite-difference and training tests. Fix these presentation issues: (1) the main KaTeX formula has a tiny vertical scrollbar/clipped exponent: give its inline wrapper sufficient block height/padding so the whole expression is visible; (2) the loss plot axis title overlaps the top tick: put Loss vertically to the left of ticks or above the axis; format marker labels compactly and keep them in bounds; (3) the full [-2,2] sweep makes the default marker/tangent too small: choose a useful x window containing the current w, the positive-path optimum, and the ReLU boundary, with padding, so a reader can see the slope. Clearly show the chosen axis range and continue to hold other parameters fixed; (4) add reverse arrows and derivative labels to the actual parameter branches when dc, dv, db, and dw are collected, so loss-to-weight flow is explicit; (5) every button needs hover and pressed feedback including selected tabs and choices. Disabled buttons must not show active feedback. Use color/outline without moving the layout; remove pressed translateY. Preserve the compact, clear layout. Read get_canvas first, then publish a revision. Keep your chat reply to one sentence. Do not reset meaningful state.';
    await page!.getByRole('textbox',{name:'Message',exact:true}).fill(request);const start=performance.now();await page!.getByRole('textbox',{name:'Message',exact:true}).press('Enter');console.log('Refining the generated figures through Loom…');
    await wait(async()=>{const s=await state(),run=s.runs.find(r=>r.chatId===manifest.chatId);if(run?.error)throw Error(run.error);return s.canvases[0].revision>revision&&!run?.busy;},360000);
    const c=await canvas(manifest.canvasId);await copyFile(join(artifacts,'source.html'),join(artifacts,'source-rev1.html'));await writeFile(join(artifacts,'source.html'),c.html);manifest.refinementMs=performance.now()-start;manifest.revision=c.revision;await writeFile(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600});await page!.screenshot({path:join(artifacts,'refined.png')});console.log(JSON.stringify({stage:'refined',revision:c.revision,refinementMs:manifest.refinementMs}));
  }else if(mode==='validate'){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));await launch(manifest.data);
    const frame=page!.frameLocator('iframe');await frame.getByRole('button',{name:'Reset lesson',exact:true}).click();
    const report:any={model:manifest.model,judge:manifest.judge,generationMs:manifest.generationMs,checks:[],source:'Real packaged Loom, connected Codex subscription and real Jev; no fixture replies'};
    const check=(s:string)=>{report.checks.push(s);console.log('PASS',s);};
    const initial=await values();close(initial['prediction-value'],.75,'initial prediction');close(initial['loss-value'],.03125,'initial loss');
    for(const [key,n]of Object.entries({'grad-w':-.75,'grad-b':-.375,'grad-v':-.125,'grad-c':-.25}))close(initial[key],n,key);
    check('Default forward values and all four analytic derivatives are correct');
    const parameters={w:.5,b:-.5,v:1.5,c:0};
    const captions=[];for(let i=0;i<7;i++){const next=frame.getByRole('button',{name:'Next backward step',exact:true});if(await next.isDisabled())break;await next.click();captions.push(await frame.locator('#backward-explanation').innerText());}
    assert(new Set(captions).size>=4,'The backward walk must show meaningful intermediate steps');
    for(const [key,label]of Object.entries({w:'First weight w',b:'Hidden bias b',v:'Output weight v',c:'Output bias c'}))close(Number(await frame.getByRole('slider',{name:label,exact:true}).inputValue()),parameters[key as keyof typeof parameters],label+' unchanged during backprop');
    check('Backward traversal reveals intermediate derivatives without updating parameters');
    const epsilon=.01;for(const [key,label]of Object.entries({w:'First weight w',b:'Hidden bias b',v:'Output weight v',c:'Output bias c'})){
      const k=key as keyof typeof parameters;await slider(label,parameters[k]+epsilon);const plus=await number('loss-value');await slider(label,parameters[k]-epsilon);const minus=await number('loss-value');await slider(label,parameters[k]);close((plus-minus)/(2*epsilon),reference(parameters)[k],key+' finite difference',.002);
    }check('Analytic derivatives agree with independent finite differences');
    await frame.getByRole('button',{name:'Train once',exact:true}).click();const trained=await values();assert(trained['loss-value']<initial['loss-value']);
    const gradients=reference(parameters);const after={...parameters};for(const [key,label]of Object.entries({w:'First weight w',b:'Hidden bias b',v:'Output weight v',c:'Output bias c'})){const k=key as keyof typeof parameters;after[k]=parameters[k]-.05*gradients[k];const control=frame.getByRole('slider',{name:label,exact:true});const tolerance=Math.max(1e-5,Number(await control.getAttribute('step'))/2+1e-5);close(Number(await control.inputValue()),after[k],label+' simultaneous update',tolerance);}
    close(trained['prediction-value'],reference(after).prediction,'post-update prediction');close(trained['loss-value'],reference(after).loss,'post-update loss');
    report.firstTrainingStep={before:initial['loss-value'],after:trained['loss-value']};check('One simultaneous gradient step reduces loss');
    await frame.getByRole('button',{name:'Inactive ReLU',exact:true}).click();const off=await values();for(const id of ['grad-w','grad-b','grad-v'])close(off[id],0,id+' inactive');close(off['grad-c'],-1,'output bias still gets a derivative');await frame.getByRole('button',{name:'Train once',exact:true}).click();assert(await number('loss-value')<off['loss-value']);
    check('Inactive ReLU stops only the hidden path; output bias still learns');
    await frame.getByRole('button',{name:'Reset lesson',exact:true}).click();await frame.getByRole('button',{name:'Quiz',exact:true}).click();
    await frame.getByRole('button',{name:'Decrease w',exact:true}).click();await frame.locator('#prediction-feedback').getByText('Try again',{exact:false}).waitFor();await frame.getByRole('button',{name:'Increase w',exact:true}).click();await frame.locator('#prediction-feedback').getByText('Correct',{exact:false}).waitFor();
    check('Prediction quiz rejects the wrong direction and explains the correct one');
    const context=page!.frames().find(f=>f.url().startsWith('studio://canvas/'))!;
    await context.evaluate(`(()=>{window.__jevChecks=[];const original=Studio.check.bind(Studio);Studio.check=async answer=>{const start=performance.now();try{const result=await original(answer);window.__jevChecks.push({answer,durationMs:performance.now()-start,result});return result;}catch(error){window.__jevChecks.push({answer,error:String(error)});throw error;}};})()`);
    await frame.getByRole('textbox',{name:'Explain backprop',exact:true}).fill(wrong);await context.waitForFunction(()=>((window as any).__jevChecks||[]).length>=1,{},{timeout:30000});let grade=await context.evaluate(()=>(window as any).__jevChecks.at(-1));assert(grade.result.items.filter((i:any)=>i.status==='contradicted').length>=2,'Jev must catch the stated misconceptions');
    await frame.locator('#live-feedback').getByText('Contradicted',{exact:false}).first().waitFor();report.wrongAnswer=grade;check('Real live Jev feedback recognizes explicit misconceptions');
    await frame.getByRole('textbox',{name:'Explain backprop',exact:true}).fill(correct);await context.waitForFunction(()=>((window as any).__jevChecks||[]).length>=2,{},{timeout:30000});grade=await context.evaluate(()=>(window as any).__jevChecks.at(-1));assert(grade.result.items.every((i:any)=>i.status==='demonstrated'),'Jev must recognize the correct explanation');report.correctAnswer=grade;
    await frame.locator('#live-feedback').getByText('Demonstrated',{exact:false}).first().waitFor();check('Real live Jev recognizes the corrected chain rule, order, and ReLU explanation');
    await frame.getByRole('button',{name:'Get detailed feedback',exact:true}).click();const request=await page!.getByRole('textbox',{name:'Message',exact:true}).inputValue();assert(request.includes(correct));check('Detailed feedback prepares the current attempt for the selected smart model');
    await page!.getByRole('textbox',{name:'Message',exact:true}).fill('');
    const details=await context.evaluate(()=>[...document.querySelectorAll('details')].map(el=>({open:el.open,text:el.querySelector('summary')?.textContent})));assert(details.some(d=>/solution/i.test(d.text||'')&&!d.open));check('Solutions stay hidden until requested');
    await frame.getByRole('button',{name:'Explore',exact:true}).click();
    await slider('First weight w',.6);await wait(async()=>JSON.stringify((await canvas(manifest.canvasId)).state).includes('0.6'));
    await page!.screenshot({path:join(artifacts,'explore.png')});await app!.close();app=undefined;await launch(manifest.data);await page!.frameLocator('iframe').getByRole('slider',{name:'First weight w',exact:true}).waitFor();close(Number(await page!.frameLocator('iframe').getByRole('slider',{name:'First weight w',exact:true}).inputValue()),.6,'restored slider');
    check('Restart restores interactive state without re-generating the lesson');
    await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,900));await page!.waitForTimeout(300);const narrow=page!.frames().find(f=>f.url().startsWith('studio://canvas/'))!;assert(await narrow.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Narrow canvas must not overflow');await page!.screenshot({path:join(artifacts,'narrow.png')});check('Figures and controls reflow without horizontal overflow');
    assert.deepEqual(errors,[]);assert.equal(await page!.locator('.canvas-error').count(),0);report.rendererErrors=errors;
    const c=await canvas(manifest.canvasId);await exportStandalone({...c,state:null},join(artifacts,'backprop.html'),resolve('dist'));
    await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,wrongJevMs:report.wrongAnswer.durationMs,correctJevMs:report.correctAnswer.durationMs}));
  }else if(mode==='record'){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));const validated=JSON.parse(await readFile(join(artifacts,'report.json'),'utf8'));assert(validated.checks.length>=12,'Validate the lesson before recording it');
    const started=performance.now();await launch(manifest.data,true);const video=page!.video()!;
    const frame=page!.frameLocator('iframe');await frame.getByRole('button',{name:'Reset lesson',exact:true}).click();
    const timeline:{start:number;end?:number;text:string}[]=[];const gaps:{start:number;end:number;reason:string}[]=[];
    const elapsed=()=>(performance.now()-started)/1000;
    const cue=(text:string)=>{if(timeline.length)timeline.at(-1)!.end=elapsed();timeline.push({start:elapsed(),text});console.log('DEMO',text);};
    const pause=(ms:number)=>page!.waitForTimeout(ms);
    await page!.evaluate(`(()=>{const p=document.createElement('div');p.id='demo-pointer';p.setAttribute('aria-hidden','true');p.style.cssText='position:fixed;left:0;top:0;width:28px;height:28px;pointer-events:none;z-index:2147483647;transform:translate(-50px,-50px);filter:drop-shadow(0 1px 2px #0007)';p.innerHTML='<svg viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17 L14 25 L18 23 L14 15 L22 15 Z" fill="white" stroke="#202b33" stroke-width="1.6"/></svg>';document.body.append(p)})()`);
    let pointer={x:300,y:160};
    async function move(x:number,y:number,duration=350){const start={...pointer},steps=16;for(let i=1;i<=steps;i++){const t=i/steps,ease=t*t*(3-2*t);pointer={x:start.x+(x-start.x)*ease,y:start.y+(y-start.y)*ease};await page!.mouse.move(pointer.x,pointer.y);await page!.evaluate(p=>{document.getElementById('demo-pointer')!.style.transform=`translate(${p.x}px,${p.y}px)`;},pointer);await pause(duration/steps);}}
    async function click(control:ReturnType<typeof frame.getByRole>){await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert(box);await move(box.x+box.width/2,box.y+box.height/2);await page!.mouse.down();await pause(90);await page!.mouse.up();await pause(250);}
    async function drag(label:string,value:number){const control=frame.getByRole('slider',{name:label,exact:true});const box=await control.boundingBox();assert(box);const range=await control.evaluate(el=>({min:Number((el as HTMLInputElement).min),max:Number((el as HTMLInputElement).max),value:Number((el as HTMLInputElement).value)}));const x=(v:number)=>box.x+8+(box.width-16)*(v-range.min)/(range.max-range.min);await move(x(range.value),box.y+box.height/2);await page!.mouse.down();await move(x(value),box.y+box.height/2,900);await page!.mouse.up();await pause(600);}
    cue('One request becomes a working lesson. Generated by GPT-6.1 Sol.');await pause(4500);
    await click(page!.getByRole('button',{name:'Expand canvas',exact:true}));await pause(1000);
    cue('Forward: compute a prediction and compare it with the target.');await click(frame.getByRole('button',{name:'Forward pass',exact:true}));await pause(3500);
    cue('Change a weight. The graph and loss curve update together.');await drag('First weight w',.9);await pause(2000);await drag('First weight w',.2);await pause(1800);await click(frame.getByRole('button',{name:'Reset lesson',exact:true}));
    cue('Backward: trace local derivatives from the loss toward the first weight.');
    for(let i=0;i<7;i++){const next=frame.getByRole('button',{name:'Next backward step',exact:true});if(await next.isDisabled())break;await click(next);await pause(2300);}
    cue('Backprop computes gradients. The optimizer changes the weights afterward.');await pause(2500);await click(frame.getByRole('button',{name:'Train once',exact:true}));await pause(3500);for(let i=0;i<3;i++){await click(frame.getByRole('button',{name:'Train once',exact:true}));await pause(750);}
    cue('An inactive ReLU blocks the hidden path. The output bias can still learn.');await click(frame.getByRole('button',{name:'Inactive ReLU',exact:true}));await pause(3000);await click(frame.getByRole('button',{name:'Train once',exact:true}));await pause(2500);
    await click(frame.getByRole('button',{name:'Reset lesson',exact:true}));await click(frame.getByRole('button',{name:'Quiz',exact:true}));
    cue('First, predict the update direction. Exact checks run locally.');await pause(1800);await click(frame.getByRole('button',{name:'Decrease w',exact:true}));await pause(2300);await click(frame.getByRole('button',{name:'Increase w',exact:true}));await pause(2500);
    const context=page!.frames().find(f=>f.url().startsWith('studio://canvas/'))!;
    await context.evaluate(`(()=>{window.__jevChecks=[];const original=Studio.check.bind(Studio);Studio.check=async answer=>{const start=performance.now();const result=await original(answer);window.__jevChecks.push({answer,durationMs:performance.now()-start,result});return result;};})()`);
    cue('Explain it in your own words. Jev checks meaning after a short pause.');
    await click(frame.getByRole('textbox',{name:'Explain backprop',exact:true}));await frame.getByRole('textbox',{name:'Explain backprop',exact:true}).pressSequentially(wrong,{delay:8});
    await context.waitForFunction(()=>((window as any).__jevChecks||[]).length>=1,{},{timeout:30000});const wrongCheck=await context.evaluate(()=>(window as any).__jevChecks.at(-1));assert(wrongCheck.result.items.some((i:any)=>i.status==='contradicted'));await frame.locator('#live-feedback').getByText('Contradicted',{exact:false}).first().waitFor();
    cue(`Jev catches the misconceptions. This live check took ${Math.round(wrongCheck.durationMs)} ms.`);await pause(4500);
    await click(frame.getByRole('textbox',{name:'Explain backprop',exact:true}));await page!.keyboard.press('ControlOrMeta+A');
    cue('Revise the explanation: chain rule, reverse order, and the ReLU gate.');await frame.getByRole('textbox',{name:'Explain backprop',exact:true}).pressSequentially(correct,{delay:7});
    await context.waitForFunction(()=>((window as any).__jevChecks||[]).length>=2,{},{timeout:30000});const correctCheck=await context.evaluate(()=>(window as any).__jevChecks.at(-1));assert(correctCheck.result.items.every((i:any)=>i.status==='demonstrated'));await frame.locator('#live-feedback').getByText('Demonstrated',{exact:false}).first().waitFor();
    cue(`All three concepts demonstrated. Real Jev response: ${Math.round(correctCheck.durationMs)} ms.`);await pause(5000);await page!.screenshot({path:join(artifacts,'quiz.png')});
    cue('Ask the chat model for detailed feedback on this exact attempt.');await click(frame.getByRole('button',{name:'Get detailed feedback',exact:true}));await pause(800);await click(page!.getByRole('button',{name:'Exit fullscreen',exact:true}));
    await page!.getByRole('textbox',{name:'Message',exact:true}).scrollIntoViewIfNeeded();await click(page!.getByRole('button',{name:'Send',exact:true}));const feedbackStart=elapsed();
    let firstText=0;await wait(async()=>{const s=await state(),run=s.runs.find(r=>r.chatId===manifest.chatId);if(run?.error)throw Error(run.error);if(!firstText&&run?.text){firstText=elapsed();cue('The chat model explains the reasoning and gives the next exercise.');}return !run?.busy;},180000);
    const feedbackEnd=elapsed();if((firstText||feedbackEnd)-feedbackStart>5)gaps.push({start:feedbackStart+3,end:(firstText||feedbackEnd)-1,reason:'Quiet model wait shortened; inference timing is in the report'});
    const s=await state();assert.equal(s.canvases.length,1,'Detailed feedback should keep the existing lesson');const reply=s.chats.find(c=>c.id===manifest.chatId)!.messages.at(-1)!.text;assert(reply.length>100,'The selected chat model must supply real detailed feedback');
    cue('Explore, predict, explain, and try again — in one chat.');await pause(6500);await page!.screenshot({path:join(artifacts,'detailed-feedback.png')});
    timeline.at(-1)!.end=elapsed();assert.deepEqual(errors,[]);await app!.close();app=undefined;await video.saveAs(join(artifacts,'raw-demo.webm'));
    const recording={timeline,gaps,wrongJev:wrongCheck,correctJev:correctCheck,detailedFeedbackSeconds:feedbackEnd-feedbackStart,feedbackReply:reply,elapsedSeconds:elapsed(),generationMs:manifest.generationMs,rendererErrors:errors};await writeFile(join(artifacts,'recording.json'),JSON.stringify(recording,null,2));console.log(JSON.stringify({stage:'recorded',durationSeconds:recording.elapsedSeconds,wrongJevMs:wrongCheck.durationMs,correctJevMs:correctCheck.durationMs,detailedFeedbackSeconds:recording.detailedFeedbackSeconds}));
  }else if(mode==='cleanup'){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));assert(manifest.data.startsWith(join(tmpdir(),'loom-backprop-')));await rm(manifest.data,{recursive:true,force:true});await rm(manifestPath);console.log('Private temporary demo account files removed.');
  }else throw Error('Use generate, refine, validate, record, or cleanup.');
}catch(error){if(page)await page.screenshot({path:join(artifacts,'failure.png')}).catch(()=>{});console.error(error);process.exitCode=1;}
finally{await app?.close();}
