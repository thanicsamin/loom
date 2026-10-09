type Reply={id:string;result?:any;error?:string};
declare global {interface Window {LoomAndroid:{postMessage:(text:string)=>void;onmessage:((event:{data:string})=>void)|null};}}
const pending=new Map<string,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
if(window.LoomAndroid)window.LoomAndroid.onmessage=event=>{let value:Reply;try{value=JSON.parse(event.data);}catch{return;}const request=pending.get(value.id);if(!request)return;pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(value.error)):request.resolve(value.result);};
export function native<T=any>(method:string,data:unknown={}):Promise<T>{
 return new Promise((resolve,reject)=>{if(!window.LoomAndroid){reject(Error('Open Loom in the Android app.'));return;}const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('No response. Check the desktop connection before trying again.'));},method==='pickFiles'||method==='scanPair'?300000:130000);pending.set(id,{resolve,reject,timer});window.LoomAndroid.postMessage(JSON.stringify({id,method,data}));});
}
export const rpc=<T=any>(method:string,data:unknown={})=>native<T>('rpc',{method,data});
export const onNative=(callback:(event:any)=>void)=>{const listener=(event:Event)=>callback((event as CustomEvent).detail);window.addEventListener('loom-native-event',listener);return()=>window.removeEventListener('loom-native-event',listener);};
