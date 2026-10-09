import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter} from 'node:path';
import {ClaudeRun,cliCommand} from '../src/native.ts';
import type {Chat} from '../src/shared.ts';

test('Windows npm wrappers resolve advertised native and JavaScript bins, including uppercase CMD names',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-windows-cli-')),args=['--flag','a space'];
 try{
  for(const [name,pkg,entry,stringBin]of [['claude','@anthropic-ai/claude-code','bin/claude.exe',false],['claude','@anthropic-ai/claude-code','cli.js',true],['gemini','@google/gemini-cli','dist/index.js',false],['codex','@openai/codex','bin/codex.js',false]] as const){
   const folder=join(root,'node_modules',pkg),target=join(folder,entry);await mkdir(dirname(target),{recursive:true});await writeFile(target,'fixture');await writeFile(join(folder,'package.json'),JSON.stringify({bin:stringBin?entry:{[name]:entry}}));
   assert.deepEqual(await cliCommand(join(root,name+'.CMD'),args,'win32'),entry.endsWith('.exe')?{command:target,args}:{command:process.execPath,args:[target,...args]});
  }
  await assert.rejects(cliCommand(join(root,'unknown.cmd'),args,'win32'),/Unsupported CLI wrapper/);
  const direct=join(root,'native.exe');assert.deepEqual(await cliCommand(direct,args,'win32'),{command:direct,args});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Claude passes long Unicode system prompts through a private file instead of command arguments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loom-claude-prompt-')),bin=join(root,'bin'),log=join(root,'wire.json'),prompt='Read this source. αβγ\n'.repeat(4000);
 await mkdir(bin);const fixture=`#!${process.execPath}\nconst fs=require('node:fs'),rl=require('node:readline');const args=process.argv.slice(2),path=args[args.indexOf('--append-system-prompt-file')+1];fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,path,prompt:fs.readFileSync(path,'utf8')}));rl.createInterface({input:process.stdin}).on('line',()=>{console.log(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:'Prompt received.'}}}));console.log(JSON.stringify({type:'result',is_error:false}));});`;
 if(process.platform==='win32'){
  const pkg=join(bin,'node_modules/@anthropic-ai/claude-code');await mkdir(pkg,{recursive:true});await writeFile(join(pkg,'fixture.js'),fixture);await writeFile(join(pkg,'package.json'),JSON.stringify({bin:{claude:'fixture.js'}}));await writeFile(join(bin,'claude.cmd'),'fixture wrapper');
 }else await writeFile(join(bin,'claude'),fixture,{mode:0o700});
 const before=process.env.PATH;process.env.PATH=bin+delimiter+dirname(process.execPath);
 const chat:Chat={id:crypto.randomUUID(),title:'Test',provider:'claude-code',model:'default',draft:'',draftAttachments:[],messages:[],updatedAt:0};let text='';
 const run=new ClaudeRun({cwd:root,chat,systemPrompt:prompt,mcpPath:join(root,'mcp.cjs'),toolEndpoint:'http://127.0.0.1:1/tools',toolToken:'private-fixture-token',directory:root,delta:s=>text+=s,activity:()=>{},auth:()=>{},saveSession:()=>{}});
 try{
  await run.prompt('Teach me.');const wire=JSON.parse(await readFile(log,'utf8'));assert.equal(text,'Prompt received.');assert.equal(wire.prompt,prompt);assert(prompt.length>32767);assert(wire.args.join(' ').length<4096);assert(!wire.args.includes('--append-system-prompt'));assert(!wire.args.includes(prompt));if(process.platform!=='win32')assert.equal((await stat(wire.path)).mode&0o777,0o600);
 }finally{run.close();if(before===undefined)delete process.env.PATH;else process.env.PATH=before;await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
