import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { findCLI, cliCommand, type NativeRun } from './native.ts';
import type { Chat } from './shared.ts';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
export async function findCodex(home:string){const runtime=join(dirname(home),'runtime'),own=join(runtime,'node_modules','@openai','codex','bin','codex.js');try{await access(join(runtime,'.ready'));await access(own);return own;}catch{return findCLI('codex');}}

export class CodexClient {
  private child?:ChildProcessWithoutNullStreams;
  private opening?:Promise<void>;
  private generation=0;
  private sequence=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  onEvent:(method:string,params:any)=>void=()=>{};
  onTool?:(name:string,args:any)=>Promise<any>;
  private listeners=new Set<(method:string,params:any)=>void>();
  private threadTools=new Map<string,(name:string,args:any)=>Promise<any>>();
  listen(listener:(method:string,params:any)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  bindTools(threadId:string,execute:(name:string,args:any)=>Promise<any>){this.threadTools.set(threadId,execute);return()=>this.threadTools.delete(threadId);}
  private event(method:string,params:any){this.onEvent(method,params);for(const listener of this.listeners)listener(method,params);}
  constructor(private home:string){}
  async start(){if(this.opening)return this.opening;if(this.child)return;const generation=++this.generation;const opening=this.open(generation);this.opening=opening;try{await opening;}finally{if(this.opening===opening)this.opening=undefined;}}
  private async open(generation:number){const executable=await findCodex(this.home);if(!executable)throw Error('Install Codex CLI to use GPT-6.1 Sol and subscription speed modes.');const resolved=await cliCommand(executable,['app-server']);if(generation!==this.generation)throw Error('Codex connection closed.');const env={...process.env,CODEX_HOME:this.home,ELECTRON_RUN_AS_NODE:'1'};delete (env as any).OPENAI_API_KEY;const child=this.child=spawn(resolved.command,resolved.args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true});child.stderr.resume();
    const fail=(error:Error)=>{if(this.child!==child)return;this.child=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.event('runtime/error',{message:error.message});};
    child.on('error',fail);child.stdin.on('error',fail);child.on('exit',()=>fail(Error('The Codex runtime stopped.')));
    createInterface({input:child.stdout}).on('line',line=>{if(this.child!==child)return;let packet:any;try{packet=JSON.parse(line);}catch{return;}if(packet.method&&packet.id!==undefined){void this.serverRequest(packet,child);return;}if(packet.id!==undefined){const p=this.pending.get(packet.id);if(p){clearTimeout(p.timer);this.pending.delete(packet.id);packet.error?p.reject(Error(packet.error.message||'Codex rejected this request.')):p.resolve(packet.result);}}else if(packet.method)this.event(packet.method,packet.params);});
    try{await this.request('initialize',{clientInfo:{name:'loom',version:'0.1.0'},capabilities:{experimentalApi:true}});if(this.child!==child)throw Error('Codex connection closed.');child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');}catch(error){if(this.child===child)this.close();throw error;}
  }
  async request(method:string,params:any={},timeout=60000){if(!this.child)throw Error('Codex has not started.');const id=++this.sequence;return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex did not respond.'));},timeout);this.pending.set(id,{resolve,reject,timer});this.child!.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  private async serverRequest(packet:any,child:ChildProcessWithoutNullStreams){let result:any;try{const execute=this.threadTools.get(packet.params?.threadId)||this.onTool;if(packet.method==='item/tool/call'&&execute){const output=await execute(packet.params.tool,packet.params.arguments);result={success:!output.isError,contentItems:output.content.map((c:any)=>c.type==='image'?{type:'inputImage',imageUrl:`data:${c.mimeType};base64,${c.data}`}:{type:'inputText',text:c.text})};}else if(packet.method.includes('requestApproval'))result={decision:'decline'};else {if(this.child===child)child.stdin.write(JSON.stringify({id:packet.id,error:{code:-32601,message:'This request is not supported by Loom.'}})+'\n');return;}}catch(e){result={success:false,contentItems:[{type:'inputText',text:e instanceof Error?e.message:'Tool failed.'}]};}if(this.child===child)child.stdin.write(JSON.stringify({id:packet.id,result})+'\n');}
  close(){++this.generation;this.opening=undefined;const child=this.child;this.child=undefined;child?.kill('SIGTERM');for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex connection closed.'));}this.pending.clear();}
}
type RunOptions={client?:CodexClient;home:string;cwd:string;chat:Chat;systemPrompt:string;tools:any[];execute:(name:string,args:any)=>Promise<any>;delta:(text:string)=>void;activity:(text:string)=>void;needsCompletion?:()=>boolean};
const inputs=(text:string,images:any[])=>[{type:'text',text},...images.map(i=>({type:'image',url:`data:${i.mimeType};base64,${i.data}`}))];
export class CodexRun implements NativeRun {
  private client:CodexClient;
  private threadId='';private turnId='';private cancelled=false;
  private queued:{text:string;images:any[]}[]=[];
  private finish?:()=>void;private fail?:(e:Error)=>void;
  private unlisten:()=>void;private unbind?:()=>void;
  hasContext(){return !!this.threadId;}
  constructor(private options:RunOptions){
    this.client=options.client||new CodexClient(options.home);if(!options.client)this.client.onTool=options.execute;
    this.unlisten=this.client.listen((method,p)=>{
      if(method==='runtime/error'){this.unbind?.();this.unbind=undefined;this.threadId='';this.turnId='';if(!this.cancelled)this.fail?.(Error(p.message));return;}
      if(options.client&&p.threadId!==this.threadId)return;
      if(method==='item/agentMessage/delta')options.delta(p.delta);
      if(method==='item/started'&&p.item?.type==='dynamicToolCall')options.activity(p.item.tool);
      if(method==='turn/started')this.turnId=p.turn.id;
      if(method==='turn/completed'){if(p.turn.status==='failed')this.fail?.(Error(p.turn.error?.message||'Codex could not complete this turn.'));else this.finish?.();}
    });
  }
  async prompt(text:string,images:any[]=[]){this.cancelled=false;this.turnId='';const completion=new Promise<void>((resolve,reject)=>{this.finish=resolve;this.fail=reject;});void completion.catch(()=>{});try{await this.client.start();if(this.cancelled)return;
    if(!this.threadId){const created=await this.client.request('thread/start',{cwd:this.options.cwd,model:this.options.chat.model||'gpt-6.1-sol',serviceTier:this.options.chat.speed==='ultrafast'?'ultrafast':this.options.chat.speed==='fast'?'fast':'default',approvalPolicy:'never',sandbox:'read-only',baseInstructions:this.options.systemPrompt,ephemeral:true,dynamicTools:this.options.tools.map(t=>({type:'function',name:t.name,description:t.description,inputSchema:t.parameters})),config:{'features.shell_tool':false,'features.shell_snapshot':false,web_search:'live','features.multi_agent':false,'features.apply_patch_freeform':false,mcp_servers:{}}});this.threadId=created.thread.id;this.unbind=this.client.bindTools(this.threadId,this.options.execute);}
    const queued=this.queued.splice(0);text+=queued.length?'\n\nLatest user steering:\n'+queued.map(q=>q.text).join('\n\n'):'';images.push(...queued.flatMap(q=>q.images));
    if(this.cancelled)return;const result=await this.client.request('turn/start',{threadId:this.threadId,input:inputs(text,images),...(this.options.chat.thinking?{effort:this.options.chat.thinking}:{})});this.turnId=result.turn.id;
    for(const item of this.queued.splice(0))await this.steer(item.text,item.images);await completion;
    // A bounded recovery stays in the same thread, preserving source reads and tool errors.
    // It never changes the user's model, effort, or lesson subject.
    for(let attempt=0;attempt<2&&!this.cancelled&&this.options.needsCompletion?.();attempt++){
      this.options.activity('Completing the lesson');
      const next=new Promise<void>((resolve,reject)=>{this.finish=resolve;this.fail=reject;});void next.catch(()=>{});
      const continued=await this.client.request('turn/start',{threadId:this.threadId,input:inputs('Complete the original learning request now. A starter sentence or an announcement is not the lesson. Read relevant sources and publish the working lesson with publish_canvas. If publication failed, repair the reported code error and try again. Use the existing source context and do not invent an unfamiliar term. If the task truly needs clarification or a service is blocked, state the specific issue instead.',[]),...(this.options.chat.thinking?{effort:this.options.chat.thinking}:{})});this.turnId=continued.turn.id;await next;
    }
    }catch(error){if(!this.cancelled)throw error;}
  }
  async steer(text:string,images:any[]=[]){if(!this.threadId||!this.turnId){this.queued.push({text,images});return;}await this.client.request('turn/steer',{threadId:this.threadId,expectedTurnId:this.turnId,input:inputs(text,images)});}
  async stop(){this.cancelled=true;this.queued=[];if(this.threadId&&this.turnId)await this.client.request('turn/interrupt',{threadId:this.threadId,turnId:this.turnId},5000).catch(()=>{});this.finish?.();if(!this.options.client)this.client.close();}
  close(){this.unlisten();this.unbind?.();if(this.options.client&&this.threadId)void this.client.request('thread/unsubscribe',{threadId:this.threadId},5000).catch(()=>{});else this.client.close();}
}
