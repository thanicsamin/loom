import { publicDatabase } from './store.ts';
import type { Database, PublicState, ProviderId } from './shared.ts';

// Only local workspace data is needed to paint a usable chat. Provider modules
// and account discovery load after this snapshot, without blocking typing.
export function startupState(db: Database): PublicState {
  const defaults: Record<ProviderId,[string,string,string]>={
    'openai-codex':['Codex','gpt-6.1-sol','GPT-6.1 Sol'],
    'claude-code':['Claude','default','Provider default'],
    'gemini-cli':['Gemini','default','Provider default'],
    'opencode-go':['OpenCode Go','step-5-preview-free','Step 5 Preview Free'],
  };
  return {...publicDatabase(db),initializing:true,providers:(Object.entries(defaults) as [ProviderId,[string,string,string]][]).map(([id,[name,fallback,label]])=>{
    const model=db.chats.find(c=>c.id===db.activeChatId&&c.provider===id)?.model||db.settings.models[id]||fallback;
    return {id,name,available:true,configured:false,detail:'Loading saved connections…',models:[{id:model,name:model===fallback?label:model,speeds:['standard']}]};
  }),judges:[{id:'typesafe',name:'TypeSafe AI',configured:false,models:[]},{id:'openrouter',name:'OpenRouter',configured:false,models:[]},{id:'opencode',name:'OpenCode Zen',configured:false,models:[]}],runs:[]};
}
