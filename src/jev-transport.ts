import {Agent,fetch as fetchWithAgent,type Agent as AgentType} from 'undici';

// One pool for the judge. HTTP/2 keeps an edited/cancelled answer from closing
// the connection needed by its replacement. HTTP/1 providers negotiate normally.
export class JevTransport {
  private agent:AgentType;
  private warmed=new Set<string>();
  constructor(options:Agent.Options={}){this.agent=new Agent({allowH2:true,connections:2,maxConcurrentStreams:16,keepAliveTimeout:60000,keepAliveMaxTimeout:60000,connect:{timeout:4000},...options});}
  fetch:typeof globalThis.fetch=(input,init)=>fetchWithAgent(input as any,{...init,dispatcher:this.agent} as any) as any;
  warm(endpoint:string){
    const url=new URL(endpoint);if(url.protocol!=='https:'||this.warmed.has(url.origin))return;this.warmed.add(url.origin);
    // HEAD only opens the provider's public origin; no credentials or model work.
    void this.agent.request({origin:url.origin,path:'/',method:'HEAD',headersTimeout:4000,bodyTimeout:4000}).then(result=>result.body.dump()).catch(()=>{this.warmed.delete(url.origin);});
  }
  async close(){await this.agent.destroy();}
}
