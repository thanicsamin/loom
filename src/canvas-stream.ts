import {randomUUID} from 'node:crypto';
import type {CanvasPreview,Criterion} from './shared.ts';
export type StreamInput={id?:string;title?:string;html:string;complete?:boolean;replace?:boolean;rubric?:Criterion[];resetState?:boolean};
export type CanvasDraft=CanvasPreview & {targetId?:string;rubric?:Criterion[];resetState?:boolean};
export function appendCanvas(draft:CanvasDraft|undefined,input:StreamInput,targetId?:string):CanvasDraft{
  if(typeof input.html!=='string'||input.html.length>2_000_000)throw Error('Keep canvas HTML below 2 MB.');
  if(draft&&input.id!==draft.id)throw Error('Use the id returned by stream_canvas to continue this draft.');
  if(!draft&&!input.title?.trim())throw Error('Give the first canvas chunk a title.');
  const html=(input.replace?'':draft?.html||'')+input.html;if(html.length>2_000_000)throw Error('Keep the full canvas below 2 MB.');
  return{id:draft?.id||randomUUID(),title:(input.title||draft!.title).slice(0,120),html,targetId:draft?.targetId||targetId,rubric:input.rubric||draft?.rubric,resetState:input.resetState??draft?.resetState};
}
