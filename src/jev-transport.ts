import {Agent,fetch as fetchWithAgent,type Agent as AgentType} from 'undici';

// One pool for the judge. HTTP/2 keeps an edited/cancelled answer from closing
// the connection needed by its replacement. HTTP/1 providers negotiate normally.
export class JevTransport {
  private agent:AgentType;
  private warmed=new Set<string>();
  private cooldowns=new Map<string,number>();
  constructor(options:Agent.Options={}){this.agent=new Agent({allowH2:true,connections:2,maxConcurrentStreams:16,keepAliveTimeout:60000,keepAliveMaxTimeout:60000,connect:{timeout:4000},...options});}
  fetch:typeof globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),until=this.cooldowns.get(url.origin)||0;
    init?.signal?.throwIfAborted();
    if(until>Date.now())throw Error(`Feedback is rate limited. Wait ${Math.ceil((until-Date.now())/1000)} seconds before checking again. Your answer is saved.`);
    const response=await fetchWithAgent(input as any,{...init,dispatcher:this.agent} as any);
    if(response.status===429){const after=response.headers.get('retry-after'),seconds=after!==null&&/^\d+(?:\.\d+)?$/.test(after)?Number(after):NaN,date=after?Date.parse(after):NaN;
      const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():60000;
      this.cooldowns.set(url.origin,Date.now()+Math.max(1000,delay));await response.body?.cancel();
      throw Error('Feedback is rate limited. '+(after?'Wait for the provider’s retry period':'Wait one minute')+' before checking again. Your answer is saved.');
    }
    return response as any;
  };
  warm(endpoint:string){
    const url=new URL(endpoint);if(url.protocol!=='https:'||this.warmed.has(url.origin))return;this.warmed.add(url.origin);
    // HEAD only opens the provider's public origin; no credentials or model work.
    void this.agent.request({origin:url.origin,path:'/',method:'HEAD',headersTimeout:4000,bodyTimeout:4000}).then(result=>result.body.dump()).catch(()=>{this.warmed.delete(url.origin);});
  }
  async close(){await this.agent.destroy();}
}
