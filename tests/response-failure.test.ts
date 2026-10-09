import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter,resolve} from 'node:path';
import {Engine} from '../src/engine.ts';
import {ResponseWatchdog,responseFailure} from '../src/response-watchdog.ts';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean,ms=4000){const end=Date.now()+ms;while(!fn()){assert(Date.now()<end,'The failed request must stop');await sleep(10);}}
test('progress postpones silence timeout but never postpones the total deadline',async()=>{
 let waits=0;const w=new ResponseWatchdog({waitingMs:15,idleMs:90,maximumMs:160},()=>waits++,()=>{});
 const pulse=setInterval(()=>w.pulse(),30);
 try{await assert.rejects(w.failure,/took too long/);assert(waits>0);}finally{clearInterval(pulse);w.close();}
});
test('silent and stalled native requests preserve attempts, retry cleanly, and reject empty success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-response-test-')),bin=join(root,'bin'),log=join(root,'attempts.jsonl');await mkdir(bin);
 const pathBefore=process.env.PATH;process.env.PATH=bin+delimiter+dirname(process.execPath);
 // A real child process deliberately ignores SIGTERM long enough to emit stale
 // text after timeout. This exercises transport cleanup and retry isolation.
 await writeFile(join(bin,'claude'),`#!${process.execPath}\nconst fs=require('node:fs'),rl=require('node:readline');process.on('SIGTERM',()=>{});const lines=rl.createInterface({input:process.stdin});lines.on('line',line=>{const e=JSON.parse(line);const text=e.message.content.filter(c=>c.type==='text').map(c=>c.text).join('');const request=text.split('Current request:\\n').at(-1);let prior='';try{prior=fs.readFileSync(${JSON.stringify(log)},'utf8')}catch{};fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({text})+'\\n');const send=s=>console.log(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:s}}}));const done=()=>{console.log(JSON.stringify({type:'result',is_error:false}));};if(request.includes('silent request')&&!prior.includes('silent request')){setTimeout(()=>{send('STALE SILENT REPLY');done();},1600);return;}if(request.includes('stall request')){send('A saved partial reply.');setTimeout(()=>{send('STALE STALLED REPLY');done();},1600);return;}if(request.includes('empty request')){done();return;}const failures={'service down request':'503: service unavailable','quota request':'429: rate limit reached','expired sign-in request':'401: expired credentials','missing model request':'404: Model not found','network request':'ECONNRESET'};for(const [trigger,error]of Object.entries(failures))if(request.includes(trigger)){console.log(JSON.stringify({type:'result',is_error:true,result:error}));return;}if(request.includes('crash request'))process.exit(17);send('The retried response completed.');done();});setTimeout(()=>process.exit(),3000);`,{mode:0o700});
 const events:any[]=[];const engine=new Engine(join(root,'data'),e=>events.push(e),resolve('dist/mcp.cjs'),undefined,{waitingMs:60,idleMs:1000,maximumMs:5000});
 try{
  await engine.init();await engine.handle('refreshAccounts');const chat=await engine.store.newChat({provider:'claude-code'});
  const attachment=await engine.store.addAttachment(chat.id,'notes.txt','text/plain',Buffer.from('Notes to preserve'));
  await engine.send(chat.id,'silent request',[attachment.id]);await until(()=>!engine.runs.get(chat.id)!.busy);
  let run=engine.snapshot().runs.find(r=>r.chatId===chat.id)!;assert.match(run.error!,/stopped responding/);assert(run.canRetry);assert(events.some(e=>e.type==='state'&&e.state.runs.some((r:any)=>r.activity==='Waiting for a response…')));
  assert.deepEqual(engine.store.chat(chat.id).messages[0].attachments,[attachment.id]);assert.equal(await readFile(engine.store.attachment(attachment.id).path,'utf8'),'Notes to preserve');
  await engine.retry(chat.id);await until(()=>!engine.runs.get(chat.id)!.busy);await sleep(1700);
  run=engine.snapshot().runs.find(r=>r.chatId===chat.id)!;assert.equal(run.error,undefined);assert(!run.canRetry);assert.equal(engine.store.chat(chat.id).messages.at(-1)!.text,'The retried response completed.');assert(!JSON.stringify(engine.store.chat(chat.id).messages).includes('STALE'));
  const attempts=(await readFile(log,'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(attempts.length,2);assert(attempts.every(a=>a.text.includes('Notes to preserve')));
  await engine.send(chat.id,'stall request');await until(()=>!engine.runs.get(chat.id)!.busy);assert.match(engine.snapshot().runs.find(r=>r.chatId===chat.id)!.error!,/stopped responding/);assert.equal(engine.store.chat(chat.id).messages.at(-1)!.text,'A saved partial reply.');assert(engine.store.chat(chat.id).messages.at(-1)!.interrupted);
  await engine.send(chat.id,'empty request');await until(()=>!engine.runs.get(chat.id)!.busy);assert.match(engine.snapshot().runs.find(r=>r.chatId===chat.id)!.error!,/without an answer/);await sleep(1700);assert(!JSON.stringify(engine.store.chat(chat.id).messages).includes('STALE'));
  for(const [request,expected]of [['service down request',/provider is unavailable/],['quota request',/quota or rate limit/],['expired sign-in request',/rejected the sign-in/],['missing model request',/model is unavailable/],['network request',/connection stopped/],['crash request',/connection stopped/]] as const){
   const before=(await readFile(log,'utf8')).trim().split('\n').length;
   await engine.send(chat.id,request,[attachment.id]);await until(()=>!engine.runs.get(chat.id)!.busy);
   const failed=engine.snapshot().runs.find(r=>r.chatId===chat.id)!;assert.match(failed.error!,expected);assert(failed.canRetry);assert.match(failed.error!,/message and attachments are saved/);assert.deepEqual(engine.store.chat(chat.id).messages.at(-1)!.attachments,[attachment.id]);
   await sleep(80);assert.equal((await readFile(log,'utf8')).trim().split('\n').length,before+1,'Failure must not trigger another provider request');
  }
 }finally{await engine.close();process.env.PATH=pathBefore;await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('failure messages handle structured outage and quota errors without duplicating recovery text',()=>{
 assert.match(responseFailure(Object.assign(Error('Upstream unavailable'),{status:503})),/provider is unavailable/);
 assert.match(responseFailure(Object.assign(Error('Too many requests'),{response:{status:429}})),/Wait before retrying/);
 assert.match(responseFailure(Object.assign(Error('Denied'),{statusCode:401})),/Check the account in Settings/);
 const saved=responseFailure(Error('The response timed out. Your message and attachments are saved.'));
 assert.equal(saved.match(/Your message and attachments are saved/g)?.length,1);
});
