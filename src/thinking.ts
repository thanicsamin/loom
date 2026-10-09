import type {Model} from '@earendil-works/pi-ai';
import type {ModelInfo,ThinkingOption} from './shared.ts';

export const thinkingKey=(provider:string,model:string)=>`${provider}/${model}`;
export const thinkingLabel=(value:string)=>({off:'Off',none:'None',xhigh:'Extra high'}[value]||value.charAt(0).toUpperCase()+value.slice(1));

// A reasoning flag alone does not establish which effort levels an endpoint accepts.
// Only show explicit capability metadata; an absent catalog stays on provider default.
export function piThinking(model:Model<any>):ThinkingOption[]{
  if(!model.reasoning||!model.thinkingLevelMap)return [];
  const entries=Object.entries(model.thinkingLevelMap).filter((e):e is [string,string]=>typeof e[1]==='string');
  const seen=new Set<string>();
  return entries.filter(([key,mapped])=>!entries.some(([other])=>other===mapped&&other!==key)).filter(([,mapped])=>{if(seen.has(mapped))return false;seen.add(mapped);return true;}).map(([value])=>({value,label:thinkingLabel(value)}));
}
export function codexModelInfo(model:any):ModelInfo{
  const efforts=model.supportedReasoningEfforts||model.supported_reasoning_efforts||[];
  const thinking:ThinkingOption[]=efforts.flatMap((e:any)=>{const value=typeof e==='string'?e:e.reasoningEffort||e.reasoning_effort;return typeof value==='string'?[{value,label:thinkingLabel(value),description:e.description}]:[];});
  const defaultThinking=model.defaultReasoningEffort||model.default_reasoning_effort;
  return{id:model.model||model.id,name:model.displayName||model.display_name||model.model||model.id,vision:(model.inputModalities||model.input_modalities||['text','image']).includes('image'),speeds:['standard',...(model.serviceTiers||model.service_tiers||[]).map((t:any)=>t.id==='priority'?'fast':t.id)],thinking,defaultThinking:thinking.some(e=>e.value===defaultThinking)?defaultThinking:undefined};
}
export function validateThinking(model:ModelInfo|undefined,value:unknown):string|undefined{
  if(value===undefined||value==='')return undefined;
  if(typeof value!=='string'||!model?.thinking?.some(e=>e.value===value))throw Error('This thinking level is unavailable for the selected model. Choose an available level or Provider default.');
  return value;
}
