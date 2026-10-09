import {canvasPreviewDocument} from './canvas-preview-document.ts';
import { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session } from 'electron';
import { Worker } from 'node:worker_threads';
import { join, resolve, relative, extname, dirname, isAbsolute } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { PublicState } from './shared.ts';
import { canvasDocument } from './canvas-document.ts';
import { exportStandalone } from './export.ts';

protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,corsEnabled:true,supportFetchAPI:true,stream:true}}]);
app.setName('Loom');
if(process.env.STUDIO_DATA_DIR)app.setPath('userData',resolve(process.env.STUDIO_DATA_DIR));
const dist=__dirname;
let window:BrowserWindow,worker:Worker,sequence=0,state:PublicState|undefined,closing=false,engineReady=false;
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let readyResolve:()=>void,readyReject:(e:Error)=>void;
const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
let localResolve:()=>void,localReject:(e:Error)=>void;
const localReady=new Promise<void>((resolve,reject)=>{localResolve=resolve;localReject=reject;});
void ready.catch(()=>{});void localReady.catch(()=>{});
async function call(method:string,data:any={}){
  if(method==='state'&&!engineReady){await localReady;return state;}
  if(method!=='getCanvas'){worker.postMessage({warm:true});await ready;}const id=++sequence;
  return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('The workspace did not respond. Try again.'));},method==='connect'?660000:90000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,method,data});});
}
function verify(event:Electron.IpcMainInvokeEvent){if(event.sender!==window.webContents||event.senderFrame?.url!=='studio://app/index.html')throw Error('This action is available only to the workspace interface.');}
async function external(url:string){let parsed:URL;try{parsed=new URL(url);}catch{throw Error('Invalid link.');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('Only web links can be opened.');await shell.openExternal(parsed.href);}
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  protocol.handle('studio',async request=>{
    try{
      const url=new URL(request.url);
      if(url.hostname==='preview'){const token=url.searchParams.get('token');if(!token||!/^[a-f0-9-]{36}$/.test(token))return new Response('',{status:404});return new Response(canvasPreviewDocument(token,state?.settings),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
      if(url.hostname==='canvas'){
        const id=url.pathname.slice(1),token=url.searchParams.get('token');
        if(!/^[a-f0-9-]{36}$/.test(id)||!token||!/^[a-f0-9-]{36}$/.test(token))return new Response('',{status:404});
        const canvas=await call('getCanvas',{id});
        return new Response(canvasDocument(canvas.html,canvas.state,token,state?.settings,canvas.rubric),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' studio:; style-src 'unsafe-inline' studio:; img-src data: blob: studio:; font-src data: studio:; media-src data: blob: studio:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",'Cache-Control':'no-store'}});
      }
      if(url.hostname==='attachment'){
        const id=url.pathname.slice(1);if(!/^[a-f0-9-]{36}$/.test(id))return new Response('',{status:404});
        const item=await call('attachmentMeta',{id});const bytes=await readFile(item.path);
        const safeType=['text/html','image/svg+xml','application/javascript'].includes(item.mime)?'text/plain':item.mime;
        return new Response(bytes,{headers:{'Content-Type':safeType,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
      }
      if(url.hostname!=='app')return new Response('',{status:404});
      const target=resolve(dist,'.'+decodeURIComponent(url.pathname));const rel=relative(dist,target);
      if(rel.startsWith('..')||!['.html','.js','.css','.woff','.woff2','.ttf','.svg','.png'].includes(extname(target)))return new Response('',{status:404});
      const response=await net.fetch(pathToFileURL(target).href);
      const headers=new Headers(response.headers);
      if(extname(target)==='.html')headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src studio: data: blob:; font-src 'self'; connect-src studio:; frame-src studio:; object-src 'none'; base-uri 'none'; form-action 'none'");
      headers.set('Access-Control-Allow-Origin','*');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});
    }catch{return new Response('File unavailable',{status:404});}
  });
  window=new BrowserWindow({width:1380,height:930,minWidth:740,minHeight:600,backgroundColor:'#f8f9f7',title:'Loom',icon:join(dist,'logo.png'),autoHideMenuBar:true,webPreferences:{preload:join(dist,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(({url})=>{void external(url).catch(()=>{});return{action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(url!=='studio://app/index.html'){event.preventDefault();void external(url).catch(()=>{});}});
  worker=new Worker(join(dist,'worker.mjs'),{workerData:{directory:app.getPath('userData'),mcpPath:join(dist,'mcp.cjs')}});
  window.webContents.once('did-finish-load',()=>{setTimeout(()=>worker.postMessage({warm:true}),40);});
  worker.on('message',packet=>{
    if(packet.ready){engineReady=true;readyResolve();}
    if(packet.fatal){localReject(Error(packet.fatal));readyReject(Error(packet.fatal));if(!window.isDestroyed())window.webContents.send('studio:event',{type:'fatal',message:packet.fatal});}
    if(packet.event){if(packet.event.type==='state'){state=packet.event.state;localResolve();}if(!window.isDestroyed())window.webContents.send('studio:event',packet.event);}
    if(packet.id){const p=pending.get(packet.id);if(p){clearTimeout(p.timer);pending.delete(packet.id);packet.error?p.reject(Error(packet.error)):p.resolve(packet.result);}}
  });
  worker.on('error',error=>{localReject(error);readyReject(error);for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();});
  ipcMain.handle('studio:call',(event,method,data)=>{verify(event);if(!['state','newChat','selectChat','send','stop','saveDraft','removeAttachment','createProject','updateProject','createFolder','renameFolder','deleteFolder','updateChat','deleteChat','listFiles','readFile','canvasState','restoreCanvas','getCanvas','getPreview','grade','settings','connect','disconnect','authReply','refreshAccounts','systemPrompt','sample','pdfPreview','memoryView','cancelGrade','importAutoum'].includes(method))throw Error('Unknown interface action.');return call(method,data);});
  ipcMain.handle('studio:chooseProject',async event=>{verify(event);const result=await dialog.showOpenDialog(window,{title:'Choose a project folder',properties:['openDirectory','createDirectory']});return result.canceled?undefined:result.filePaths[0];});
  ipcMain.handle('studio:pickFiles',async(event,chatId)=>{verify(event);const result=await dialog.showOpenDialog(window,{title:'Attach files',properties:['openFile','multiSelections']});if(result.canceled)return[];const files=[];for(const path of result.filePaths)files.push(await call('importAttachment',{chatId,path}));return files;});
  ipcMain.handle('studio:upload',(event,data)=>{verify(event);if(!(data.bytes instanceof ArrayBuffer)||data.bytes.byteLength>20*1024*1024)throw Error('Attach files of at most 20 MB.');return call('upload',{...data,bytes:new Uint8Array(data.bytes)});});
  ipcMain.handle('studio:external',async(event,url)=>{verify(event);await external(url);});
  ipcMain.handle('studio:openPath',async(event,path)=>{
    verify(event);if(typeof path!=='string')throw Error('Invalid path.');
    const canonical=await realpath(path),snapshot=state||await call('state');
    if(!snapshot.projects.some((p:any)=>{const r=relative(p.path,canonical);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/')));})&&!snapshot.attachments.some((a:any)=>a.path===canonical))throw Error('Choose a file from a project or this chat.');
    const error=await shell.openPath(canonical);if(error)throw Error(error);
  });
  ipcMain.handle('studio:exportCanvas',async(event,id)=>{verify(event);const canvas=await call('getCanvas',{id});const result=await dialog.showSaveDialog(window,{title:'Export canvas',defaultPath:canvas.title.replace(/[<>:"/\\|?*]/g,'_')+'.html',filters:[{name:'HTML document',extensions:['html']}]});if(result.canceled||!result.filePath)return false;await exportStandalone(canvas,result.filePath,dist,state?.settings);return true;});
  await window.loadURL('studio://app/index.html');
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(closing||!worker)return;event.preventDefault();closing=true;void call('close').catch(()=>{}).finally(async()=>{await worker.terminate();app.quit();});});
