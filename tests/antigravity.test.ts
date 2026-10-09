import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AntigravityRun,antigravityModels,antigravityRules} from '../src/antigravity.ts';
import type {Chat} from '../src/shared.ts';

test('Antigravity catalogs derive model groups and thinking levels only from advertised variants',()=>{
 const models=antigravityModels('Fetching models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngemini-9-new-max\tGemini 9 New (Max)\nclaude-opus-high\tClaude\ngemini-custom\tCustom Gemini\n');
 assert.equal(models.length,3);assert.equal(models[0].id,'gemini-3.8-flash');assert.deepEqual(models[0].thinking?.map(t=>t.value),['high','low']);assert.equal(models[0].variants.low,'gemini-3.8-flash-low');assert.equal(models[1].thinking?.[0].value,'max');assert.equal(models[2].thinking,undefined);assert.equal(models[2].variants[''],'gemini-custom');
});
test('Antigravity subscription transport pins the real slug, streams, reuses context, queues steering, and reports errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-agy-test-')),cli=join(root,'agy'),log=join(root,'wire.jsonl');
 const fixture=`#!/usr/bin/env node\nconst fs=require('node:fs'),rl=require('node:readline');const args=process.argv.slice(2),slug=args[args.indexOf('--model')+1];fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,apiKey:!!process.env.GEMINI_API_KEY,googleKey:!!process.env.GOOGLE_API_KEY})+'\\n');console.log(JSON.stringify({event:'init',conversation_id:'real-session',init:{model:slug}}));rl.createInterface({input:process.stdin}).on('line',line=>{const e=JSON.parse(line),text=e.message.content;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(e)+'\\n');setTimeout(()=>{if(text==='fail'){console.log(JSON.stringify({event:'result',result:{status:'ERROR',error:'Quota unavailable'}}));return;}console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',text_delta:text}}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS'}}));},35);});`;
 await writeFile(cli,fixture,{mode:0o700});const chat:Chat={id:crypto.randomUUID(),title:'Test',provider:'gemini-cli',model:'gemini-3.8-flash',thinking:'low',draft:'',draftAttachments:[],messages:[],updatedAt:0};let text='',session='';
 const run=new AntigravityRun({cwd:root,chat,systemPrompt:'Teach clearly.',mcpPath:join(root,'mcp.cjs'),toolEndpoint:'http://127.0.0.1:1/tools',toolToken:'private-fixture-token',directory:root,delta:s=>text+=s,activity:()=>{},auth:()=>{},saveSession:s=>session=s},cli,antigravityModels('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)')[0]);
 const before={gemini:process.env.GEMINI_API_KEY,google:process.env.GOOGLE_API_KEY};process.env.GEMINI_API_KEY='must-not-be-used';process.env.GOOGLE_API_KEY='must-not-be-used';
 try{
  const pending=run.prompt('first');await run.steer('steering');await pending;assert.equal(text,'firststeering');assert.equal(session,'real-session');assert(run.hasContext());await run.prompt('followup');assert.equal(text,'firststeeringfollowup');
  const rows=(await readFile(log,'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(rows.filter(r=>r.args).length,1);assert(rows[0].args.includes('gemini-3.8-flash-low'));assert(rows[0].args.includes('--new-project'));assert.equal(await readFile(join(root,'antigravity',chat.id,'AGENTS.md'),'utf8'),'Teach clearly.');assert(JSON.parse(await readFile(join(root,'antigravity',chat.id,'.agents/mcp_config.json'),'utf8')).mcpServers.studio.command);assert(!rows[0].apiKey&&!rows[0].googleKey);const agent=await readFile(join(root,'antigravity',chat.id,'.agents/agents/loom/agent.md'),'utf8');assert(agent.includes('subagent: false'));assert(agent.includes('commandExecutionPolicy: "off"'));assert(agent.includes('tools: ["list_dir"]'));assert(agent.includes('STUDIO_CHAT_ID'));assert(!agent.includes('must-not-be-used'));
  await assert.rejects(run.prompt('with image',[{data:'image'}]),/accepts text/);await assert.rejects(run.prompt('fail'),/Quota unavailable/);assert(!run.hasContext());
 }finally{run.close();for(const [key,value]of [['GEMINI_API_KEY',before.gemini],['GOOGLE_API_KEY',before.google]]as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('Antigravity rules preserve all instructions without per-file truncation, including Unicode',()=>{const prompt=('A teaching paragraph. '+'𝒜'.repeat(4000)+'\n\n').repeat(4)+'End of instructions.';const parts=antigravityRules(prompt);assert(parts.length>1);assert.equal(parts.join(''),prompt);assert(parts.every(p=>Buffer.byteLength(p)<=22000));});

test('Antigravity rejects missing executables and immediate CLI exits without waiting for a response deadline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-agy-failure-')),cli=join(root,'agy');
 const chat:Chat={id:crypto.randomUUID(),title:'Test',provider:'gemini-cli',model:'gemini-3.8-flash',thinking:'low',draft:'',draftAttachments:[],messages:[],updatedAt:0};
 const options={cwd:root,chat,systemPrompt:'Teach clearly.',mcpPath:join(root,'mcp.cjs'),toolEndpoint:'http://127.0.0.1:1/tools',toolToken:'private-fixture-token',directory:root,delta:()=>{},activity:()=>{},auth:()=>{},saveSession:()=>{}};
 const model=antigravityModels('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)')[0];
 const failed:AntigravityRun[]=[];
 try{
  for(const exists of [false,true]){
   if(exists)await writeFile(cli,`#!${process.execPath}\nprocess.exit(17);`,{mode:0o700});
   const run=new AntigravityRun(options,cli,model);failed.push(run);
   await assert.rejects(Promise.race([run.prompt('hello'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture response deadline exceeded')),2500))]),exists?/exit 17|EPIPE|ECONNRESET/:/ENOENT/);
   assert(!run.hasContext());
  }
 }finally{failed.forEach(run=>run.close());await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
