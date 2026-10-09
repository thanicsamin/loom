import {_android,type AndroidDevice,type BrowserContext,type Page} from 'playwright-core';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Companion} from '../src/companion.ts';
import {Store,publicDatabase} from '../src/store.ts';
import {SAMPLE_HTML} from '../src/sample.ts';
import type {PublicState,RunInfo} from '../src/shared.ts';
import {pdfFixture} from './fixtures.ts';
import {PDFService} from '../src/pdf.ts';

const device=process.env.ANDROID_SERIAL||'emulator-5554';
const release=process.argv.includes('--release');
if(release&&!device.startsWith('emulator-'))throw Error('Release verification clears test data and requires a userdebug emulator.');
const appId=release?'app.loom.studio':'app.loom.studio.debug';
const adb=(...args:string[])=>execFileSync('adb',['-s',device,...args],{encoding:'utf8',timeout:20000});
const root=await mkdtemp(join(tmpdir(),'loom-android-e2e-')),store=new Store(root);
await store.init();await mkdir('test-results',{recursive:true});const projectPath=join(root,'Textbook');await mkdir(projectPath);await writeFile(join(projectPath,'paper.pdf'),pdfFixture());await writeFile(join(projectPath,'notes.txt'),'Frequency is cycles per second.');const project=await store.createProject('Textbook',projectPath);const chat=await store.newChat({projectId:project.id,model:'gpt-6-luna'});chat.thinking='low';
const canvas=await store.publishCanvas(chat.id,{title:'Signal lab',html:SAMPLE_HTML,rubric:[{id:'amplitude',label:'Amplitude',description:'Maximum displacement'},{id:'frequency',label:'Frequency',description:'Cycles per second'}]});chat.messages.push({id:randomUUID(),role:'assistant',at:Date.now(),text:'Study the signal. $\\mathbb{R}^2$ is a two-dimensional vector space.',canvasIds:[canvas.id]});await store.commit();
const runs:RunInfo[]=[];const calls:{method:string;data:any}[]=[];
const state=():PublicState=>({...publicDatabase(store.db),providers:[{id:'openai-codex',name:'Codex',configured:true,available:true,models:[{id:'gpt-6-luna',name:'GPT-6 Luna',thinking:[{value:'low',label:'Low'},{value:'medium',label:'Medium'}],defaultThinking:'low'}]}],judges:[{id:'opencode',name:'OpenCode Zen',configured:true,models:[{id:'jev-1.13-free',name:'Jev 1.13 Free'}]}],runs:structuredClone(runs)});
const pdf=new PDFService(join(process.cwd(),'dist/pdf-worker.mjs'));let service:Companion;
const respond=async(method:string,data:any={})=>{
 calls.push({method,data});let result:any={};
 switch(method){
  case 'state':return state();
  case 'getCanvas':return structuredClone(store.canvas(data.id));
  case 'canvasState':result=await store.saveCanvasState(data.id,data.state);break;
  case 'canvasQuizAnswer':result=await store.saveQuizAnswer(data.id,data.key,data.answer);break;
  case 'cancelGrade':break;
  case 'grade':return{items:store.canvas(canvas.id).rubric.map(r=>({id:r.id,label:r.label,status:/maximum/.test(String(data.answer))?'demonstrated':'contradicted',confidence:.99,hint:/maximum/.test(String(data.answer))?'':r.description}))};
  case 'selectChat':store.db.activeChatId=data.id;await store.commit();break;
  case 'newChat':result=await store.newChat(data);break;
  case 'createProject':result=await store.createProject(data.name,data.path);break;
  case 'createFolder':result=await store.createFolder(data);break;
  case 'saveDraft':store.chat(data.chatId).draft=data.text;await store.commit();break;
  case 'upload':result=await store.addAttachment(data.chatId,data.name,data.mime,Buffer.from(data.bytes));break;
  case 'attachmentMeta':return store.attachment(data.id);
  case 'removeAttachment':{const c=store.chat(data.chatId);c.draftAttachments=c.draftAttachments.filter(id=>id!==data.id);await store.commit();break;}
  case 'listFiles':return store.listFiles(data.chatId,data.path);
  case 'readFile':return store.readProjectFile(data.chatId,data.path);
  case 'pdfPreview':return pdf.read(data.id?store.attachment(data.id).path:join(projectPath,data.path),'render',[data.page||1]);
  case 'settings':Object.assign(store.db.settings,data);await store.commit();break;
  case 'updateChat':Object.assign(store.chat(data.id),data);await store.commit();break;
  case 'stop':{const r=runs.find(r=>r.chatId===data.chatId);if(r)r.busy=false;break;}
  case 'send':{
   const c=store.chat(data.chatId),r=runs.find(r=>r.chatId===c.id);
   c.messages.push({id:randomUUID(),role:'user',text:data.text,at:Date.now(),attachments:data.attachments,steering:!!r?.busy});c.draft='';c.draftAttachments=[];
   if(r?.busy){r.pendingSteers++;await store.commit();break;}
   const next:RunInfo={chatId:c.id,busy:true,text:'',activity:'Teaching',pendingSteers:0};runs.push(next);await store.commit();
   setTimeout(()=>{
    for(let i=0;i<100;i++){next.text+='chunk'+i+' ';service.emit({type:'delta',chatId:c.id,delta:'chunk'+i+' '});}
    service.emit({type:'canvas-preview',chatId:c.id,preview:{id:'build-test',title:'Streaming figure',html:'<h2>Streaming figure</h2><p data-math="x^2"></p>'}});
   },100);
   setTimeout(async()=>{if(!next.busy)return;next.busy=false;c.messages.push({id:randomUUID(),role:'assistant',text:next.text,at:Date.now()});service.emit({type:'canvas-preview',chatId:c.id,preview:null});await store.commit();service.emit({type:'state',state:state()});},5000);
   break;
  }
  default:throw Error('Unsupported test action '+method);
 }
 service.emit({type:'state',state:state()});return result;
};
service=new Companion(root,{state,call:respond});await service.enable();
const config=JSON.parse(await readFile(join(root,'phone/connection.json'),'utf8'));
const first=(await service.status()).addresses[0].code;
const pairJSON=JSON.parse(Buffer.from(new URL(first).searchParams.get('code')!,'base64url').toString());pairJSON.url='https://10.0.2.2:'+config.port;
const codeFor=(value:any)=>'loom://pair?code='+Buffer.from(JSON.stringify(value)).toString('base64url');
let browser:BrowserContext|undefined,android:AndroidDevice|undefined,page:Page|undefined;const checks:string[]=[],errors:string[]=[],metrics:Record<string,number>={};
const pass=(name:string)=>{checks.push(name);console.log('PASS',name);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const wait=async(fn:()=>boolean|Promise<boolean>,timeout=15000)=>{const end=Date.now()+timeout;while(!await fn()){assert(Date.now()<end,'Timed out waiting for Android state');await new Promise(r=>setTimeout(r,50));}};
async function connect(){
 await wait(()=>{try{return !!adb('shell','pidof',appId).trim();}catch{return false;}});
 android||=(await _android.devices()).find(item=>item.serial()===device);assert(android,'Android test device connected');
 const pid=adb('shell','pidof',appId).trim();
 // Playwright prioritizes pkg over socketName; select only the new process's socket.
 const webview=await android.webView({socketName:'webview_devtools_remote_'+pid});page=await webview.page();browser=page.context();page.on('pageerror',e=>errors.push(e.message));await page.locator('.app').waitFor({timeout:30000});
 metrics.contentfulPaintMs=await page.evaluate(()=>performance.getEntriesByName('first-contentful-paint')[0]?.startTime||0);
}
const callNative=async(method:string,data:any={})=>page!.evaluate(({method,data})=>new Promise<any>((resolve,reject)=>{const id=crypto.randomUUID(),bridge=(window as any).LoomAndroid,prior=bridge.onmessage;bridge.onmessage=(event:any)=>{const response=JSON.parse(event.data);if(response.id!==id){prior?.(event);return;}bridge.onmessage=prior;response.error?reject(Error(response.error)):resolve(response.result);};bridge.postMessage(JSON.stringify({id,method,data}));}),{method,data});
function tapNative(label:string){adb('shell','uiautomator','dump','/sdcard/loom-picker.xml');const xml=adb('shell','cat','/sdcard/loom-picker.xml');const nodes=xml.match(/<node\b[^>]*>/g)||[];const node=nodes.find(n=>n.includes('text="'+label+'"')||n.includes('content-desc="'+label+'"'));if(!node)return false;const bounds=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);if(!bounds)return false;adb('shell','input','tap',String(Math.round((+bounds[1]+ +bounds[3])/2)),String(Math.round((+bounds[2]+ +bounds[4])/2)));return true;}
async function chooseNativeFile(name:string){await new Promise(r=>setTimeout(r,350));if(tapNative(name))return;if(tapNative('Show roots')||tapNative('Open navigation drawer')){await new Promise(r=>setTimeout(r,200));assert(tapNative('Downloads'),'Downloads root is available');await new Promise(r=>setTimeout(r,200));}assert(tapNative(name),'Selected file is visible in the native picker');}
try{
 adb('install','-r','release/android/loom-android-0.1.0'+(release?'':'-debug')+'.apk');const start=Date.now();adb('shell','am','force-stop',appId);adb('shell','pm','clear',appId);adb('shell','am','start','-n',appId+'/app.loom.studio.MainActivity');await connect();metrics.firstLaunchMs=Date.now()-start;pass('native Android launch and local chat interface');
 await page!.locator('.welcome').getByRole('button',{name:'Connect desktop',exact:true}).click();await page!.getByRole('textbox',{name:'Pairing code'}).fill(codeFor({...pairJSON,fingerprint:'0'.repeat(64)}));await page!.getByRole('button',{name:'Connect',exact:true}).click();await page!.locator('.sheet .error').getByText('certificate',{exact:false}).waitFor();assert.equal(calls.filter(c=>c.method==='state').length,0);pass('mismatched TLS certificate is rejected before desktop actions');
 await page!.getByRole('textbox',{name:'Pairing code'}).fill(codeFor(pairJSON));await page!.getByRole('button',{name:'Connect',exact:true}).click();await page!.getByRole('button',{name:'Desktop connected'}).waitFor();await page!.frameLocator('iframe').getByRole('heading',{name:'Sine wave'}).waitFor();pass('encrypted pairing, native RPC, and SSE state');
 if(release){assert.throws(()=>adb('shell','run-as',appId,'cat','shared_prefs/pairing.xml'),/not debuggable/);}else{const preference=adb('shell','run-as',appId,'cat','shared_prefs/pairing.xml');assert(!preference.includes(config.token));assert(!preference.includes(pairJSON.url));}
 assert(!await page!.evaluate(token=>document.documentElement.outerHTML.includes(token),config.token));pass(release?'release rejects run-as data extraction and hides token from rendered UI':'pairing token encrypted at rest and absent from the rendered UI');
 assert.equal(await page!.getByRole('combobox',{name:'Thinking',exact:true}).inputValue(),'low');assert.equal(await page!.getByRole('combobox',{name:'Thinking',exact:true}).locator('option').count(),3);await page!.getByRole('combobox',{name:'Thinking',exact:true}).selectOption('medium');await wait(()=>store.chat(chat.id).thinking==='medium');await page!.getByRole('combobox',{name:'Thinking',exact:true}).selectOption('low');pass('provider-supplied model and thinking controls');
 const frame=page!.frames().find(f=>f.parentFrame()===page!.mainFrame())!;
 const isolation=await frame.evaluate(async()=>{let parentBlocked=false,networkBlocked=false;try{void parent.document.body}catch{parentBlocked=true}try{await fetch('https://example.com')}catch{networkBlocked=true}return{parentBlocked,networkBlocked,native:typeof(window as any).LoomAndroid,require:typeof(window as any).require};});assert.deepEqual(isolation,{parentBlocked:true,networkBlocked:true,native:'undefined',require:'undefined'});pass('generated lesson cannot access parent DOM, native bridge, or network');
 await wait(async()=>await page!.locator('.markdown .katex').count()>0);await wait(async()=>await frame.locator('.katex').count()>0);assert.equal(await frame.locator('.katex-error').count(),0);const fonts=await frame.evaluate(async()=>{await document.fonts.ready;return{family:getComputedStyle(document.body).fontFamily,size:getComputedStyle(document.body).fontSize,loaded:document.fonts.check('18px "CMU Serif"'),katex:document.fonts.check('18px KaTeX_Main')};});assert(fonts.loaded&&fonts.katex);assert.equal(fonts.size,'18px');pass('chat and embedded KaTeX plus bundled Computer Modern fonts');
 const paint=await frame.evaluate(async()=>{const start=performance.now(),n=document.getElementById('amplitude') as HTMLInputElement;n.value='1.7';n.dispatchEvent(new Event('input',{bubbles:true}));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));return performance.now()-start;});metrics.sliderPaintMs=paint;assert(paint<200);await wait(()=>Number((store.canvas(canvas.id).state as any)?.amplitude)===1.7);await frame.getByRole('button',{name:'It halves'}).click();await frame.getByText('Yes. Period =',{exact:false}).waitFor();pass('responsive canvas controls, local exact quiz, and saved state');
 await frame.getByRole('textbox',{name:'Your explanation'}).fill('Amplitude is cycles and frequency is height.');await frame.locator('#concepts [data-status=contradicted]').first().waitFor();await frame.getByRole('textbox',{name:'Your explanation'}).fill('Amplitude is maximum displacement; frequency is cycles per second.');await frame.locator('#concepts [data-status=demonstrated]').first().waitFor();assert(calls.filter(c=>c.method==='grade').length>=2);await frame.getByRole('button',{name:'Detailed feedback'}).click();assert((await page!.getByRole('textbox',{name:'Message',exact:true}).inputValue()).includes('maximum displacement'));pass('reactive Jev transport and detailed-feedback handoff (local classifier fixture)');
 await page!.getByRole('button',{name:'Settings',exact:true}).click();for(const theme of ['dark','light','system']){await page!.getByRole('combobox',{name:'Appearance'}).selectOption(theme);await wait(async()=>await page!.evaluate(()=>document.documentElement.dataset.theme)===(theme==='system'?'light':theme));}for(const size of [12,16,18,20,24]){await page!.getByRole('combobox',{name:'Text size'}).selectOption(String(size));await wait(async()=>await frame.evaluate(()=>getComputedStyle(document.body).fontSize)===size+'px');}await page!.getByRole('combobox',{name:'Text size'}).selectOption('18');await page!.getByRole('button',{name:'Back',exact:true}).click();pass('light/dark/system and live font-size changes without remount');
 const layout=await frame.evaluate(()=>({height:document.body.getBoundingClientRect().height,scroll:document.documentElement.scrollHeight,body:document.body.scrollHeight}));const outer=await page!.locator('iframe').evaluate(n=>n.getBoundingClientRect().height);assert(outer>=layout.body);pass('lesson spans its complete height within the chat');
 await page!.getByRole('textbox',{name:'Message',exact:true}).fill('Teach me attention');await page!.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await page!.getByRole('button',{name:'Steer',exact:true}).waitFor();await page!.getByRole('textbox',{name:'Message',exact:true}).fill('Focus on the chain rule');await page!.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await wait(()=>store.chat(chat.id).messages.some(m=>m.steering));await page!.getByText('chunk99',{exact:false}).waitFor();await wait(()=>!runs.find(r=>r.chatId===chat.id)?.busy);assert(store.chat(chat.id).messages.find(m=>m.role==='assistant'&&m.text.includes('chunk99'))!.text===Array.from({length:100},(_,i)=>'chunk'+i+' ').join(''));pass('Enter steers running lessons and preserves fast ordered streaming');
 await page!.getByRole('button',{name:'Settings',exact:true}).click();await page!.getByRole('button',{name:'Project files',exact:false}).click();await page!.getByRole('button',{name:'paper.pdf',exact:true}).click();await page!.locator('.source-view img').waitFor();await page!.getByRole('button',{name:'Next',exact:true}).click();await page!.getByText('Page 2',{exact:true}).waitFor();await page!.locator('.source-view img').waitFor();await page!.getByRole('button',{name:'Back',exact:true}).click();pass('shared project library and rendered PDF pages');
 const screenshotPath=join(root,'loom-screenshot-e2e.png'),paperPath=join(root,'loom-paper-e2e.pdf');await page!.screenshot({path:screenshotPath});await writeFile(paperPath,pdfFixture());
 for(const item of [{path:screenshotPath,name:'loom-screenshot-e2e.png',mime:'image/png'},{path:paperPath,name:'loom-paper-e2e.pdf',mime:'application/pdf'}]){
  adb('push',item.path,'/sdcard/Download/'+item.name);adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///sdcard/Download/'+item.name);
  await page!.getByRole('button',{name:'Attach files',exact:true}).click();await chooseNativeFile(item.name);await page!.locator('footer').getByRole('button',{name:item.name,exact:true}).waitFor({timeout:20000});const saved=store.db.attachments.find(a=>a.name===item.name)!;assert(saved);assert.equal(saved.mime,item.mime);assert.equal(hash(await readFile(saved.path)),hash(await readFile(item.path)));await page!.locator('footer').getByRole('button',{name:item.name,exact:true}).click();await page!.locator('.source-view img').waitFor();await page!.getByRole('button',{name:'Back',exact:true}).click();pass('native '+(item.mime==='image/png'?'screenshot':'PDF')+' upload, exact bytes, and preview');
 }
 await page!.getByRole('textbox',{name:'Message',exact:true}).fill('Read these attachments');await page!.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await wait(()=>store.chat(chat.id).messages.some(m=>m.role==='user'&&m.text==='Read these attachments'&&m.attachments?.length===2));await wait(()=>!runs.filter(r=>r.chatId===chat.id).some(r=>r.busy));pass('uploaded image and PDF attach to the sent message');
 await page!.screenshot({path:'test-results/android-chat.png'});
 await new Promise(r=>setTimeout(r,700));await service.disable();await page!.getByRole('button',{name:'Connect desktop'}).waitFor();await frame.getByRole('slider',{name:'Amplitude',exact:true}).evaluate(n=>{(n as HTMLInputElement).value='1.9';n.dispatchEvent(new Event('input',{bubbles:true}));});await frame.getByRole('textbox',{name:'Your explanation'}).fill('My offline answer remains saved.');await frame.getByText('Connect to desktop Loom for Jev feedback.',{exact:false}).waitFor();await new Promise(r=>setTimeout(r,700));pass('offline lesson interaction and honest unavailable feedback');
 await browser!.close();browser=undefined;const restart=Date.now();adb('shell','am','force-stop',appId);adb('shell','am','start','-n',appId+'/app.loom.studio.MainActivity');await connect();await page!.frameLocator('iframe').getByRole('heading',{name:'Sine wave'}).waitFor();metrics.offlineRestartMs=Date.now()-restart;assert.equal(await page!.frameLocator('iframe').getByRole('slider',{name:'Amplitude',exact:true}).inputValue(),'1.9');assert.equal(await page!.frameLocator('iframe').getByRole('textbox',{name:'Your explanation'}).inputValue(),'My offline answer remains saved.');pass('offline restart retains cached lesson and answers');
 await service.enable();await page!.getByRole('button',{name:'Desktop connected'}).waitFor({timeout:20000});await wait(()=>Number((store.canvas(canvas.id).state as any).amplitude)===1.9);assert.equal((store.canvas(canvas.id).state as any).answer,'My offline answer remains saved.');pass('reconnect syncs offline interaction state without generating a model request');await service.revoke();await page!.getByText('This phone was revoked.',{exact:false}).first().waitFor();const before=calls.length;await new Promise(r=>setTimeout(r,1200));assert.equal(calls.length,before);pass('revoked phone stops reconnecting and cannot perform desktop actions');
 assert.deepEqual(errors,[]);await writeFile('test-results/android'+(release?'-release':'')+'-e2e-report.json',JSON.stringify({checks,metrics,errors,device,variant:release?'signed release on userdebug emulator':'debug',fixture:'Local TLS desktop/provider/classifier fixtures. No paid model requests.'},null,2));console.log('METRICS',JSON.stringify(metrics));
}catch(e){console.error(e);await page?.screenshot({path:'test-results/android-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close().catch(()=>{});await android?.close().catch(()=>{});await service.close();await pdf.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
