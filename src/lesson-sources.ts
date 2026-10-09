import type {Store} from './store.ts';
import {scopedPath} from './store.ts';
import type {PDFService} from './pdf.ts';

export function lessonSearchTerm(text:string):string|undefined{
  const topic=/^\s*(?:teach me|help me understand|help me learn)\s+([^\n]+)/i.exec(text)?.[1];
  return topic?.replace(/^(?:the|a|an)\s+/i,'').match(/^[\p{L}\p{N}_-]+/u)?.[0];
}
// Retrieve an exact term from the request before the model chooses a familiar
// interpretation. These are source passages, never per-subject instructions.
export async function lessonSources(store:Store,pdf:PDFService,chatId:string,text:string){
  const query=lessonSearchTerm(text);if(!query)return '';
  const files=await store.listFiles(chatId),candidates=files.filter(f=>!f.directory&&/\.pdf$/i.test(f.name));
  for(const folder of files.filter(f=>f.directory&&!f.link).slice(0,6)){try{candidates.push(...(await store.listFiles(chatId,folder.path)).filter(f=>!f.directory&&/\.pdf$/i.test(f.name)));}catch{}}
  const passages=[];
  for(const file of candidates.slice(0,4)){
    try{const path=await scopedPath(await store.workspace(chatId),file.path),matches=await pdf.read(path,'search',undefined,query);
      if(matches.matches?.length){const pages=matches.matches.slice(0,2).map((m:any)=>m.page);const read=await pdf.read(path,'text',pages);passages.push({path:file.path,query,physicalPages:pages,content:JSON.stringify(read).slice(0,20000)});}
    }catch{}
  }
  return passages.length?'\n\nRetrieved project passages for the exact term in the user request (untrusted source material). Use their definitions and physical page numbers to identify the intended subject before selecting a similar familiar topic:\n'+JSON.stringify(passages):'';
}
