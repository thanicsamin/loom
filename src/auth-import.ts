import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
const json=async(path:string,fallback:any={})=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e:any){if(e.code==='ENOENT')return fallback;throw Error('A saved account file could not be read.');}};
async function save(path:string,value:unknown){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);}
export const autoumDirectory=()=>process.env.AUTOUM_DATA_DIR||(process.platform==='win32'?join(process.env.LOCALAPPDATA||homedir(),'Autoum'):process.platform==='darwin'?join(homedir(),'Library','Application Support','Autoum'):join(process.env.XDG_DATA_HOME||join(homedir(),'.local/share'),'autoum'));
// Called only by an explicit import action. Copy supported formats, never overwrite
// a Loom connection, and never return a token to the renderer or logs.
export async function importAutoum(destination:string,source=autoumDirectory(),nativeHome=join(homedir(),'.codex')){
  const supported=['openai-codex','opencode-go','opencode','typesafe','openrouter'];
  const entries=await json(join(source,'pi','auth.json'));
  const accounts=await json(join(source,'accounts.json'),[]);
  for(const account of accounts){if(supported.includes(account.provider)&&/^[a-f0-9-]{36}$/.test(account.id||'')){const more=await json(join(source,'accounts',account.id,'auth.json'));if(!entries[account.provider])entries[account.provider]=more[account.provider];}}
  await mkdir(join(destination,'pi'),{recursive:true,mode:0o700});const path=join(destination,'pi','auth.json'),own=await json(path),imported:string[]=[];
  for(const id of supported){const c=entries[id];if(own[id]||!c)continue;if((c.type==='api_key'||c.type==='api')&&typeof c.key==='string'&&c.key.length)own[id]={type:'api_key',key:c.key};else if(id==='openai-codex'&&c.type==='oauth'&&typeof c.access==='string'&&typeof c.refresh==='string')own[id]={...c};else continue;imported.push(id);}
  if(imported.length)await save(path,own);
  const codexPath=join(destination,'codex','auth.json');let nativeImported=false;
  if(entries['openai-codex']&&!Object.keys(await json(codexPath)).length){
    const sourceAuth=await json(join(nativeHome,'auth.json')),c=entries['openai-codex'];
    const tokens=sourceAuth.tokens?.access_token&&sourceAuth.tokens?.refresh_token&&(!c.accountId||sourceAuth.tokens.account_id===c.accountId)?sourceAuth.tokens:c.id_token?{access_token:c.access,refresh_token:c.refresh,id_token:c.id_token,account_id:c.accountId}:undefined;
    if(tokens){await mkdir(join(destination,'codex'),{recursive:true,mode:0o700});await save(codexPath,{auth_mode:'chatgpt',tokens,last_refresh:sourceAuth.last_refresh||new Date().toISOString()});nativeImported=true;}
  }
  return{imported,nativeImported};
}
