import {createServer,type Server} from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {networkInterfaces} from 'node:os';
import {isIP} from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual,X509Certificate} from 'node:crypto';
import {generate} from 'selfsigned';
import QRCode from 'qrcode';
import type {PublicState,StudioEvent} from './shared.ts';

const methods=new Set(['state','newChat','selectChat','send','retry','stop','saveDraft','removeAttachment','updateChat','deleteChat','updateProject','createFolder','renameFolder','deleteFolder','listFiles','readFile','canvasState','canvasQuizAnswer','restoreCanvas','getCanvas','getPreview','grade','settings','refreshAccounts','sample','pdfPreview','memoryView','cancelGrade']);
const uuid=/^[a-f0-9-]{36}$/;
type Config={version:1;enabled:boolean;port:number;token:string;cert:string;key:string};
type Hooks={call:(method:string,data?:any)=>Promise<any>;state:()=>PublicState|undefined};
export type PhoneStatus={enabled:boolean;connections:number;addresses:{url:string;code:string;qr:string}[]};
export function privateAddress(input:string){
 const address=input.replace(/^::ffff:/,'');if(isIP(address)===6)return address==='::1'||/^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(address);
 const p=address.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(p[0]===127||p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===169&&p[1]===254||p[0]===100&&p[1]>=64&&p[1]<=127);
}
export class Companion {
 private config?:Config;
 private server?:Server;
 private streams=new Set<ServerResponse>();
 private requests=0;
 private rate=new Map<string,{at:number;count:number}>();
 private changes:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private hooks:Hooks){}
 private get path(){return join(this.directory,'phone','connection.json');}
 private async load(){if(this.config)return;try{const c=JSON.parse(await readFile(this.path,'utf8'));if(c.version!==1||typeof c.token!=='string'||c.token.length!==43||typeof c.cert!=='string'||typeof c.key!=='string')throw Error('The saved phone connection is invalid.');this.config=c;}catch(e:any){if(e.code!=='ENOENT')throw e;}}
 private async save(){await mkdir(join(this.directory,'phone'),{recursive:true,mode:0o700});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(this.config),{mode:0o600});await rename(temp,this.path);}
 private serialize<T>(operation:()=>Promise<T>):Promise<T>{const job=this.changes.catch(()=>{}).then(operation);this.changes=job;return job;}
 async restore(){await this.load();if(this.config?.enabled)await this.enable();}
 async enable(){return this.serialize(async()=>{
  await this.load();if(this.server)return this.status();
  if(!this.config){const notAfterDate=new Date();notAfterDate.setFullYear(notAfterDate.getFullYear()+5);const pem=await generate([{name:'commonName',value:'Loom desktop'}],{keyType:'ec',curve:'P-256',algorithm:'sha256',notAfterDate});this.config={version:1,enabled:false,port:0,token:randomBytes(32).toString('base64url'),cert:pem.cert,key:pem.private};}
  const server=createServer({cert:this.config.cert,key:this.config.key,minVersion:'TLSv1.2'},(request,response)=>void this.request(request,response));server.keepAliveTimeout=65000;server.headersTimeout=15000;server.requestTimeout=120000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.config!.port,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
  this.server=server;this.config.port=(server.address()as any).port;this.config.enabled=true;
  try{await this.save();}catch(e){await this.close();throw e;}return this.status();
 });}
 async disable(){return this.serialize(async()=>{await this.load();if(this.config){this.config.enabled=false;await this.save();}await this.close();return this.status();});}
 async revoke(){return this.serialize(async()=>{await this.load();if(this.config){this.config.token=randomBytes(32).toString('base64url');await this.save();}for(const stream of this.streams)stream.destroy();this.streams.clear();return this.status();});}
 async status():Promise<PhoneStatus>{
  await this.load();if(!this.server||!this.config)return{enabled:false,connections:0,addresses:[]};
  const fingerprint=new X509Certificate(this.config.cert).fingerprint256.replaceAll(':','').toLowerCase();
  const addresses=[...new Set(Object.values(networkInterfaces()).flat().filter(a=>a&&!a.internal&&a.family==='IPv4'&&privateAddress(a.address)).map(a=>a!.address))];
  if(!addresses.length)addresses.push('127.0.0.1');
  const codes=await Promise.all(addresses.slice(0,6).map(async address=>{const url=`https://${address}:${this.config!.port}`,data={version:1,url,fingerprint,token:this.config!.token},code='loom://pair?code='+Buffer.from(JSON.stringify(data)).toString('base64url');return{url,code,qr:await QRCode.toDataURL(code,{width:260,margin:2,errorCorrectionLevel:'M'})};}));
  return{enabled:true,connections:this.streams.size,addresses:codes};
 }
 emit(event:StudioEvent){if(event.type==='auth')return;const data='data: '+JSON.stringify(event)+'\n\n';for(const response of this.streams){if(response.writableLength>2*1024*1024){response.destroy();this.streams.delete(response);}else response.write(data);}}
 private reply(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));}
 private limited(key:string,maximum:number){const now=Date.now();let r=this.rate.get(key);if(!r||now-r.at>=1000){r={at:now,count:0};this.rate.set(key,r);}return ++r.count>maximum;}
 private async request(request:IncomingMessage,response:ServerResponse){
  if(!privateAddress(request.socket.remoteAddress||'')){this.reply(response,403,{error:'Phone connections require the same local network or a private VPN.'});return;}
  const supplied=Buffer.from(request.headers.authorization||''),expected=Buffer.from('Bearer '+this.config!.token);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){this.reply(response,401,{error:'This phone connection was revoked or is invalid. Pair again from desktop Settings.'});return;}
  // This API is for the pinned native client. Browser-origin requests are never accepted.
  if(request.headers.origin){this.reply(response,403,{error:'Browser requests are not allowed.'});return;}
  const pathname=request.url?.split('?')[0];
  if(request.method==='GET'&&pathname==='/events'){
   if(this.streams.size>=4){this.reply(response,429,{error:'Too many phone connections.'});return;}
   response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.flushHeaders();this.streams.add(response);
   const state=this.hooks.state();if(state)response.write('data: '+JSON.stringify({type:'state',state})+'\n\n');
   const heartbeat=setInterval(()=>response.write(': keep-alive\n\n'),15000);
   response.on('close',()=>{clearInterval(heartbeat);this.streams.delete(response);});return;
  }
  if(request.method!=='POST'||pathname!=='/rpc'){this.reply(response,404,{error:'Unknown phone action.'});return;}
  if(this.requests>=16||this.limited(request.socket.remoteAddress||'',40)){this.reply(response,429,{error:'Too many requests. Wait before trying again.'});return;}
  this.requests++;
  try{
   let bytes=0;const chunks:Buffer[]=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>30*1024*1024)throw Error('The request is too large. Attach files of at most 20 MB.');chunks.push(chunk);}
   const {method,data={}}=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof method!=='string'||!data||typeof data!=='object')throw Error('Invalid phone request.');
   let result:any;
   if(method==='mobileCreateProject'){
    if(typeof data.name!=='string'||!data.name.trim()||data.name.length>80||/[\\/\0]/.test(data.name))throw Error('Choose a project name of 1–80 characters.');
    const path=join(this.directory,'phone-projects',randomUUID());await mkdir(path,{recursive:true,mode:0o700});result=await this.hooks.call('createProject',{path,name:data.name.trim()});
   }else if(method==='mobileAttachment'){
    if(typeof data.id!=='string'||!uuid.test(data.id))throw Error('Invalid attachment.');const item=await this.hooks.call('attachmentMeta',{id:data.id});if(item.size>20*1024*1024)throw Error('This attachment is too large.');result={name:item.name,mime:item.mime,bytes:(await readFile(item.path)).toString('base64')};
   }else if(method==='mobileUpload'){
    if(typeof data.bytes!=='string'||data.bytes.length>28*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.bytes))throw Error('Invalid upload.');const bytes=Buffer.from(data.bytes,'base64');if(bytes.length>20*1024*1024)throw Error('Attach files of at most 20 MB.');result=await this.hooks.call('upload',{chatId:data.chatId,name:data.name,mime:data.mime,bytes:new Uint8Array(bytes)});
   }else{
    if(!methods.has(method))throw Error('This action requires desktop Loom.');
    if(method==='grade'&&this.limited('grade',5)){this.reply(response,429,{error:'Wait before checking again. Your answer is saved.'});return;}
    result=await this.hooks.call(method,data);
   }
   this.reply(response,200,{result});
  }catch(e){this.reply(response,400,{error:e instanceof Error?e.message.slice(0,1500):'The action failed.'});}
  finally{this.requests--;}
 }
 async close(){const server=this.server;this.server=undefined;for(const response of this.streams)response.destroy();this.streams.clear();this.rate.clear();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}}
}
