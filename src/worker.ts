import { parentPort, workerData } from 'node:worker_threads';
import { Store } from './store.ts';
import { startupState } from './startup.ts';
import type { Engine } from './engine.ts';
import type { StudioEvent } from './shared.ts';
const store=new Store(workerData.directory);
let engine: Engine | undefined;
let warm:()=>void=()=>{};
const warmRequested=new Promise<void>(resolve=>{warm=resolve;});
const localReady=(async()=>{await store.init();if(!store.db.chats.length)await store.newChat();parentPort!.postMessage({event:{type:'state',state:startupState(store.db)}});setTimeout(warm,100);})();
const ready=localReady.then(async()=>{
  await warmRequested;
  // A separate build keeps the SDK's static imports off the first paint path.
  const {Engine}=await import(new URL('./engine.mjs',import.meta.url).href);
  engine=new Engine(workerData.directory,(event:StudioEvent)=>parentPort!.postMessage({event}),workerData.mcpPath,store);
  await engine!.init();
});
parentPort!.on('message', async packet=>{
  if(packet.warm){warm();return;}
  try {await localReady;let result;if(packet.method==='getCanvas')result=store.canvas(packet.data.id);else if(packet.method==='state'&&!engine)result=startupState(store.db);else{warm();await ready;result=packet.method==='close'?await engine!.close():packet.method==='attachmentMeta'?store.attachment(packet.data.id):await engine!.handle(packet.method,packet.data);}parentPort!.postMessage({id:packet.id,result});}
  catch(error){parentPort!.postMessage({id:packet.id,error:error instanceof Error?error.message:'Workspace action failed.'});}
});
ready.then(()=>parentPort!.postMessage({ready:true})).catch(error=>parentPort!.postMessage({fatal:error.message}));
