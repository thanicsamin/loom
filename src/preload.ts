import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio',{
  call:(method:string,data:any)=>ipcRenderer.invoke('studio:call',method,data),
  onEvent:(callback:any)=>{const listener=(_event:any,data:any)=>callback(data);ipcRenderer.on('studio:event',listener);return()=>ipcRenderer.removeListener('studio:event',listener);},
  chooseProject:()=>ipcRenderer.invoke('studio:chooseProject'),
  pickFiles:(chatId:string)=>ipcRenderer.invoke('studio:pickFiles',chatId),
  upload:(chatId:string,name:string,mime:string,bytes:ArrayBuffer)=>ipcRenderer.invoke('studio:upload',{chatId,name,mime,bytes}),
  openExternal:(url:string)=>ipcRenderer.invoke('studio:external',url),
  openPath:(path:string)=>ipcRenderer.invoke('studio:openPath',path),
  exportCanvas:(id:string)=>ipcRenderer.invoke('studio:exportCanvas',id),
});
