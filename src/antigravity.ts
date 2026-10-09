import {execFile,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {findCLI,childEnvironment,type NativeOptions,type NativeRun} from './native.ts';
import {thinkingLabel} from './thinking.ts';
import type {ModelInfo} from './shared.ts';

export type AntigravityModel=ModelInfo&{variants:Record<string,string>};
// The official rule loader truncates a single file at 24,000 bytes.
export function antigravityRules(prompt:string):string[]{
 const parts:string[]=[];let part='',bytes=0;
 for(const paragraph of prompt.match(/[^]*?(?:\n\n|$)/g)||[]){const size=Buffer.byteLength(paragraph);if(bytes+size>22000&&part){parts.push(part);part='';bytes=0;}
  if(size<=22000){part+=paragraph;bytes+=size;continue;}
  for(const char of paragraph){const n=Buffer.byteLength(char);if(bytes+n>22000){parts.push(part);part='';bytes=0;}part+=char;bytes+=n;}
 }
 if(part)parts.push(part);return parts;
}
export function antigravityModels(output:string):AntigravityModel[]{
 const models=new Map<string,AntigravityModel>();
 for(const line of output.split('\n')){
  const match=/^\s*([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\t+| {2,})(.+?)\s*$/.exec(line);if(!match)continue;
  const [,slug,label]=match,effort=/\s+\(([^()]+)\)\s*$/.exec(label)?.[1]?.toLowerCase().replaceAll(' ','-');
  const variant=effort&&slug.endsWith('-'+effort)?[slug,slug.slice(0,-effort.length-1),effort]:undefined;
  if(!variant){if(!models.has(slug))models.set(slug,{id:slug,name:label,vision:false,variants:{'':slug}});continue;}
  const [,id,level]=variant;let model=models.get(id);
  if(!model){model={id,name:label.replace(/\s*\([^)]*\)\s*$/,''),vision:false,thinking:[],defaultThinking:level,variants:{}};models.set(id,model);}
  if(!model.variants[level]){model.variants[level]=slug;(model.thinking||=[]).push({value:level,label:thinkingLabel(level)});}
 }
 return [...models.values()];
}
export async function discoverAntigravity(){
 const executable=await findCLI('agy');if(!executable)return undefined;
 const env={...process.env};for(const key of ['GEMINI_API_KEY','GOOGLE_API_KEY','ELECTRON_RUN_AS_NODE'])delete env[key];
 try{const {stdout}=await promisify(execFile)(executable,['models'],{env,timeout:15000,maxBuffer:512000,windowsHide:true});return{executable,models:antigravityModels(stdout)};}
 catch{return{executable,models:[] as AntigravityModel[]};}
}

// The official CLI owns Google subscription credentials. Each chat gets its
// own primary-agent configuration and authenticated Studio MCP connection.
export class AntigravityRun implements NativeRun{
 private child?:ChildProcessWithoutNullStreams;
 private initialized=false;
 private cancelled=false;
 private streamed=false;
 private startupError?:Error;
 private pending?:{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
 private queued:{text:string;images:any[]}[]=[];
 constructor(private options:NativeOptions,private executable:string,private model:AntigravityModel,private initialContext=''){}
 hasContext(){return this.initialized&&!!this.child&&this.child.exitCode===null&&!this.cancelled;}
 private async start(){
  this.startupError=undefined;
  const cwd=join(this.options.directory,'antigravity',this.options.chat.id),agent=join(cwd,'.agents/agents/loom');
  await mkdir(agent,{recursive:true,mode:0o700});
  const config={name:'loom',description:'Interactive learning in Loom',mainAgent:true,subagent:false,tools:['list_dir'],commandExecutionPolicy:'off',mcpServers:[{name:'studio',command:process.execPath,args:[this.options.mcpPath],env:{ELECTRON_RUN_AS_NODE:'1',STUDIO_TOOL_ENDPOINT:this.options.toolEndpoint,STUDIO_TOOL_TOKEN:this.options.toolToken,STUDIO_CHAT_ID:this.options.chat.id}}]};
  await writeFile(join(agent,'agent.md'),'---\n'+Object.entries(config).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')+'\n---\n# System Prompt\n'+this.options.systemPrompt+'\n\nUse the Studio MCP tools for the course library and inline lessons. Do not invoke subagents or native file-editing, shell, browser, messaging, or scheduling tools. The CLI directory contains only private integration configuration; the course directory is the Working directory stated above.\n',{mode:0o600});
  // Workspace rules and MCP registration are required for primary headless
  // agents; frontmatter-only customization is insufficient in some CLI builds.
  const rules=join(cwd,'.agents/rules');await mkdir(rules,{recursive:true,mode:0o700});
  for(const file of await readdir(rules))if(/^loom-\d+\.md$/.test(file))await rm(join(rules,file));
  const parts=antigravityRules(this.options.systemPrompt);
  await writeFile(join(cwd,'AGENTS.md'),parts[0]||'',{mode:0o600});
  for(let i=1;i<parts.length;i++)await writeFile(join(rules,`loom-${String(i).padStart(3,'0')}.md`),'---\ntrigger: always_on\ndescription: Loom teaching instructions continued\n---\n'+parts[i],{mode:0o600});
  await writeFile(join(cwd,'.agents/mcp_config.json'),JSON.stringify({mcpServers:{studio:config.mcpServers[0]}}),{mode:0o600});
  const effort=this.options.chat.thinking||this.model.defaultThinking||'',slug=this.model.variants[effort];if(!slug)throw Error('This Antigravity model or thinking level is no longer available. Refresh Accounts.');
  if(this.cancelled)throw Error('The response was stopped.');
  // Without a new project the CLI can reuse its last desktop workspace and
  // silently ignore the custom primary agent in this chat's directory.
  this.child=spawn(this.executable,['--new-project','--input-format','stream-json','--output-format','stream-json','--disable-slash-commands','--agent','loom','--model',slug],{cwd,env:childEnvironment(this.options),windowsHide:true,stdio:['pipe','pipe','pipe']});
  const fail=(error:Error)=>{this.startupError=error;this.initialized=false;this.finish(error);};
  this.child.on('error',fail);this.child.stdin.on('error',fail);
  this.child.on('exit',code=>{fail(Error('Antigravity CLI stopped before completing the response'+(code?` (exit ${code}).`:'.')));});
  this.child.stderr.on('data',chunk=>{if(/auth|login|sign in/i.test(String(chunk)))this.options.auth('Sign in through Antigravity CLI, then refresh Accounts.');});
  createInterface({input:this.child.stdout}).on('line',line=>{
   let e:any;try{e=JSON.parse(line);}catch{return;}
   if(e.event==='init'){if(e.init?.model!==slug){this.finish(Error('Antigravity selected a different model than requested.'));this.close();return;}this.initialized=true;if(e.conversation_id)this.options.saveSession(e.conversation_id);}
   if(e.event==='step_update'){const s=e.step_update;if(typeof s?.text_delta==='string'&&s.text_delta){this.streamed=true;this.options.delta(s.text_delta);}if(s?.step_type==='tool')this.options.activity(s.state==='DONE'?'':s.tool_info?.parameters?.ToolName||'Working');}
   if(e.event==='result'){if(e.result?.status==='SUCCESS'){if(!this.streamed&&typeof e.result.response==='string')this.options.delta(e.result.response);this.finish();}else{const detail=e.result?.error,error=Error(typeof detail==='string'?detail:typeof detail?.message==='string'?detail.message:'Antigravity did not complete the response. Check its sign-in and quota.');if(detail&&typeof detail==='object')Object.assign(error,{status:detail.status??detail.statusCode});this.finish(error);this.close();}}
  });
 }
 private finish(error?:Error){const p=this.pending;if(!p)return;this.pending=undefined;clearTimeout(p.timer);this.options.activity('');if(error)p.reject(error);else p.resolve();}
 async prompt(text:string,images:any[]=[]){
  if(images.length)throw Error('Antigravity CLI chat input currently accepts text. Use a PDF project source or choose an image-capable chat route.');
  const fresh=!this.hasContext();if(fresh)await this.start();
  if(this.startupError)throw this.startupError;
  let current=(fresh&&this.initialContext?this.initialContext+'\n\nCurrent learner request:\n':'')+text;
  do{
   this.streamed=false;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{this.finish(Error('Antigravity did not finish within ten minutes.'));this.close();},600000);this.pending={resolve,reject,timer};this.child!.stdin.write(JSON.stringify({event:'user',message:{content:current}})+'\n',error=>{if(error)this.finish(error);});});
   const next=this.queued.splice(0);if(!next.length)break;current=next.map(n=>n.text).join('\n\n');
  }while(!this.cancelled);
 }
 async steer(text:string,images:any[]=[]){if(images.length)throw Error('Antigravity CLI steering currently accepts text.');this.queued.push({text,images});}
 async stop(){this.cancelled=true;this.queued=[];this.finish();this.child?.kill('SIGINT');}
 close(){this.cancelled=true;this.queued=[];this.finish(Error('The provider connection closed.'));this.child?.kill('SIGTERM');}
}
