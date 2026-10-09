import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request,Agent} from 'node:https';
import {Companion,privateAddress} from '../src/companion.ts';
import {Store} from '../src/store.ts';
import {startupState} from '../src/startup.ts';

test('phone connections accept local/VPN addresses and reject public or malformed peers',()=>{
 for(const address of ['127.0.0.1','10.2.3.4','192.168.1.2','172.16.3.4','172.31.3.4','100.64.0.2','::ffff:192.168.1.2','::1','fd00::1','fe80::1'])assert(privateAddress(address),address);
 for(const address of ['8.8.8.8','172.15.0.1','172.32.0.1','100.128.0.1','2001:4860:4860::8888','192.168.999.1','local.example',''])assert(!privateAddress(address),address);
});
test('real TLS phone API authenticates, streams public state, excludes account actions, and revokes access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-phone-api-')),store=new Store(root);await store.init();await store.newChat();const state=startupState(store.db),calls:any[]=[];
 const service=new Companion(root,{state:()=>state,call:async(method,data)=>{calls.push({method,data});return{method,bytes:data.bytes?.length};}});
 let agent:Agent|undefined;
 try{
  assert.equal((await service.status()).enabled,false);const status=await service.enable();assert(status.enabled);assert(status.addresses[0].code.startsWith('loom://pair?code='));assert(status.addresses[0].qr.startsWith('data:image/png;'));
  const config=JSON.parse(await readFile(join(root,'phone/connection.json'),'utf8'));if(process.platform!=='win32')assert.equal((await stat(join(root,'phone/connection.json'))).mode&0o777,0o600);
  agent=new Agent({ca:config.cert,checkServerIdentity:()=>undefined,keepAlive:true});const url=`https://127.0.0.1:${config.port}`;
  const rpc=(method:string,data:any={},token=config.token,origin?:string)=>new Promise<{status:number;body:any}>((resolve,reject)=>{const headers:any={'Content-Type':'application/json',authorization:'Bearer '+token};if(origin)headers.origin=origin;const req=request(url+'/rpc',{method:'POST',headers,agent},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(body)}));});req.on('error',reject);req.end(JSON.stringify({method,data}));});
  assert.equal((await rpc('state',{},'wrong')).status,401);assert.equal(calls.length,0);assert.equal((await rpc('state',{},config.token,'https://evil.example')).status,403);
  for(const method of ['connect','disconnect','importAutoum','authReply','phoneStatus','phoneRevoke','openPath','importAttachment']){const result=await rpc(method);assert.equal(result.status,400);assert.match(result.body.error,/requires desktop/);}
  const valid=await rpc('state');assert.equal(valid.status,200);assert.equal(valid.body.result.method,'state');
  const upload=await rpc('mobileUpload',{chatId:store.db.chats[0].id,name:'notes.txt',mime:'text/plain',bytes:Buffer.from('Study notes').toString('base64')});assert.equal(upload.body.result.bytes,11);assert.equal(calls.at(-1).method,'upload');assert(calls.at(-1).data.bytes instanceof Uint8Array);
  const stream=await new Promise<{request:any;response:any;first:string}>((resolve,reject)=>{const req=request(url+'/events',{headers:{authorization:'Bearer '+config.token},agent},response=>response.once('data',data=>resolve({request:req,response,first:String(data)})));req.on('error',reject);req.end();});assert.match(stream.first,/"type":"state"/);assert(!stream.first.includes(config.token));assert.equal((await service.status()).connections,1);
  let received='';stream.response.on('data',(chunk:any)=>received+=chunk);service.emit({type:'auth',provider:'openai-codex',message:'Sign in privately.',url:'https://private-auth.example/'});service.emit({type:'delta',chatId:store.db.chats[0].id,delta:'streamed text'});await new Promise(r=>setTimeout(r,30));assert.match(received,/streamed text/);assert(!received.includes('private-auth'));
  await service.revoke();assert.equal((await rpc('state')).status,401);assert.equal((await service.status()).connections,0);await service.disable();assert.equal((await service.status()).enabled,false);await service.restore();assert.equal((await service.status()).enabled,false);
 }finally{agent?.destroy();await service.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
