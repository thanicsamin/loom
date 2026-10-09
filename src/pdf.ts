import {Worker} from 'node:worker_threads';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';import {fileURLToPath} from 'node:url';
export class PDFService {
  private active=0;private waiting:{resolve:()=>void;reject:(error:Error)=>void}[]=[];private closed=false;
  private cache=new Map<string,{result:any;size:number}>();private cacheBytes=0;private flights=new Map<string,Promise<any>>();private workers=new Set<Worker>();
  private starts=0;private hits=0;
  get metrics(){return {workerStarts:this.starts,cacheHits:this.hits,queued:this.waiting.length};}
  constructor(private workerPath=join(fileURLToPath(new URL('.',import.meta.url)),'pdf-worker.mjs')){}
  private remember(key:string,result:any){const size=JSON.stringify(result).length*2;if(size>4*1024*1024)return;const old=this.cache.get(key);if(old)this.cacheBytes-=old.size;this.cache.delete(key);this.cache.set(key,{result:structuredClone(result),size});this.cacheBytes+=size;while(this.cacheBytes>16*1024*1024||this.cache.size>96){const first=this.cache.keys().next().value!;this.cacheBytes-=this.cache.get(first)!.size;this.cache.delete(first);}}
  private cached(key:string){const entry=this.cache.get(key);if(!entry)return;this.cache.delete(key);this.cache.set(key,entry);this.hits++;return structuredClone(entry.result);}
  private async acquire(){if(this.closed)throw Error('The PDF reader is closing.');if(this.active<2){this.active++;return;}if(this.waiting.length>=16)throw Error('The PDF reader is busy. Try again shortly.');await new Promise<void>((resolve,reject)=>this.waiting.push({resolve,reject}));}
  private release(){const next=this.waiting.shift();if(next)next.resolve();else this.active--;}
  async read(path:string,mode:'text'|'info'|'tables'|'render'|'search'='text',pages?:number[],query?:string){
    if(!['text','info','tables','render','search'].includes(mode))throw Error('Choose text, info, tables, render, or search.');
    if(mode==='search'&&(typeof query!=='string'||!query.trim()||query.length>200))throw Error('Search for a phrase of 1–200 characters.');
    if(pages&&(!Array.isArray(pages)||!pages.length||pages.length>(mode==='render'?1:10)||pages.some(p=>!Number.isInteger(p)||p<1||p>100000)))throw Error('Choose up to ten valid pages, or one page to render.');
    if(mode==='render'&&!pages)pages=[1];const info=await stat(path);if(!info.isFile()||info.size>100*1024*1024)throw Error('Read a PDF of at most 100 MB.');
    const fingerprint=JSON.stringify([path,info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs]),key=fingerprint+JSON.stringify([mode,pages,query?.trim().toLowerCase()]);const cached=this.cached(key);if(cached)return cached;
    if(mode==='text'&&pages){const known=pages.map(p=>this.cached(fingerprint+':page:'+p));if(known.every(Boolean))return {total:known[0].total,pages:known.map(p=>p.page),needsVisualReading:known.every(p=>!p.page.text.trim())};}
    const existing=this.flights.get(key);if(existing)return structuredClone(await existing);
    const operation=this.parse(path,{mode,pages,query:query?.trim()}).then(result=>{const textPages=result._textPages;delete result._textPages;for(const page of textPages||[])this.remember(fingerprint+':page:'+page.page,{total:result.total,page});if(mode==='text')for(const page of result.pages)this.remember(fingerprint+':page:'+page.page,{total:result.total,page});this.remember(key,result);return result;});this.flights.set(key,operation);
    try{return structuredClone(await operation);}finally{this.flights.delete(key);}
  }
  private async parse(path:string,request:any){await this.acquire();try{
    const bytes=await readFile(path);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('This file does not contain a PDF document.');if(this.closed)throw Error('The PDF reader is closing.');this.starts++;
    return await new Promise<any>((resolve,reject)=>{
      const worker=new Worker(this.workerPath,{execArgv:[],workerData:{bytes,...request},resourceLimits:{maxOldGenerationSizeMb:256}});this.workers.add(worker);let settled=false;
      const finish=(error?:Error,result?:any)=>{if(settled)return;settled=true;clearTimeout(timer);this.workers.delete(worker);void worker.terminate();error?reject(error):resolve(result);};
      const timer=setTimeout(()=>finish(Error('This PDF took too long to read. Try fewer pages.')),20000);
      worker.once('message',packet=>finish(packet.error?Error(packet.error):undefined,packet.result));worker.once('error',e=>finish(e));worker.once('exit',()=>finish(Error('The PDF reader stopped. Try a smaller page range.')));
    });
  }finally{this.release();}}
  close(){this.closed=true;for(const waiter of this.waiting.splice(0))waiter.reject(Error('The PDF reader is closing.'));for(const worker of this.workers)void worker.terminate();this.cache.clear();this.cacheBytes=0;}
}
