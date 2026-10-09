import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export function registerGoPromos(runtime: ModelRuntime) {
  // The official Go catalog added Step 5 after Pi 1.1.0 was published. Its
  // documented endpoint is the same OpenAI-compatible route as LongCat.
  const base=runtime.getModel('opencode-go','longcat-2.5-preview-free');
  if(!base||runtime.getModel('opencode-go','step-5-preview-free'))return;
  // Keep capabilities conservative until Pi publishes this model's metadata;
  // the shared endpoint does not establish image support.
  runtime.registerProvider('opencode-go',{models:[...runtime.getModels('opencode-go'),{...base,id:'step-5-preview-free',name:'Step 5 Preview Free',input:['text'],contextWindow:128000,maxTokens:8192}]});
}
