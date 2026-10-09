import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, delimiter, dirname, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { Chat } from './shared.ts';

export async function findCLI(name: string): Promise<string | undefined> {
  for (const folder of (process.env.PATH || '').split(delimiter)) for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
    const path = join(folder, name + suffix); try { await access(path); return path; } catch {}
  }
}
export interface NativeRun { hasContext?():boolean; prompt(text: string, images?: any[]): Promise<void>; steer(text: string, images?: any[]): Promise<void>; stop(): Promise<void>; close(): void; }
type Options = { cwd: string; chat: Chat; systemPrompt: string; mcpPath: string; toolEndpoint: string; toolToken: string; directory: string; delta: (s: string) => void; activity: (s: string) => void; auth: (message: string, url?: string) => void; saveSession: (id: string) => void; };
const childEnvironment = (options: Options) => {
  const env = { ...process.env, STUDIO_TOOL_ENDPOINT: options.toolEndpoint, STUDIO_TOOL_TOKEN: options.toolToken, STUDIO_CHAT_ID: options.chat.id, ELECTRON_RUN_AS_NODE: '1' };
  // A subscription connection must not silently select a separately billed API key.
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete (env as any)[key];
  return env;
};
export async function cliCommand(path:string,args:string[]){
  if(/\.(?:m?js)$/i.test(path))return{command:process.execPath,args:[path,...args]};
  if(process.platform!=='win32'||!path.toLowerCase().endsWith('.cmd'))return{command:path,args};
  const packages:Record<string,string>={claude:'@anthropic-ai/claude-code',gemini:'@google/gemini-cli',codex:'@openai/codex'};
  const name=basename(path,'.cmd'),pkg=packages[name];if(!pkg)throw Error('Unsupported CLI wrapper.');
  // Resolve the wrapper's real entry from package.json: newer Claude Code npm releases ship a native bin/claude.exe instead of cli.js.
  const root=join(dirname(path),'node_modules',pkg),bin=JSON.parse(await readFile(join(root,'package.json'),'utf8')).bin,entry=typeof bin==='string'?bin:bin?.[name];if(!entry)throw Error('Unsupported CLI wrapper.');
  const target=join(root,entry);await access(target);return /\.exe$/i.test(target)?{command:target,args}:{command:process.execPath,args:[target,...args]};
}
async function launch(path: string, args: string[], options: Options) {
  const resolved=await cliCommand(path,args);
  const child = spawn(resolved.command, resolved.args, { cwd: options.cwd, env: childEnvironment(options), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => { const text = chunk.toString(); const url = /https:\/\/[^\s"<>]+/.exec(text)?.[0]; if (/auth|login|sign in/i.test(text)) options.auth('Complete sign-in through the provider’s official flow.', url); });
  return child;
}
const timed = <T>(promise: Promise<T>, timeout = 60000) => new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(Error('The provider runtime did not respond. Check its installation and sign-in.')), timeout); promise.then(resolve, reject).finally(() => clearTimeout(timer)); });

export class ClaudeRun implements NativeRun {
  private child?: ChildProcessWithoutNullStreams;
  private resolve?: () => void;
  private reject?: (e: Error) => void;
  private finished = false;
  private awaitingResults = 0;
  private queued: {text:string;images:any[]}[] = [];
  constructor(private options: Options) {}
  async start() {
    const executable = await findCLI('claude'); if (!executable) throw Error('Install Claude Code, sign in with your Claude subscription, and refresh Accounts.');
    const configPath = join(this.options.directory, 'claude-mcp-' + this.options.chat.id + '.json');
    await mkdir(this.options.directory, { recursive: true });
    await writeFile(configPath, JSON.stringify({ mcpServers: { studio: { command: process.execPath, args: [this.options.mcpPath], env: { ELECTRON_RUN_AS_NODE: '1', STUDIO_TOOL_ENDPOINT: this.options.toolEndpoint, STUDIO_TOOL_TOKEN: this.options.toolToken, STUDIO_CHAT_ID: this.options.chat.id } } } }), { mode: 0o600 });
    // The prompt (base + memory + PDF passages) can exceed Windows' 32,767-character command line, so pass it as a file.
    const promptPath = join(this.options.directory, 'claude-prompt-' + this.options.chat.id + '.md');
    await writeFile(promptPath, this.options.systemPrompt, { mode: 0o600 });
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--strict-mcp-config', '--mcp-config', configPath, '--allowedTools', 'mcp__studio__*', '--append-system-prompt-file', promptPath];
    if (this.options.chat.model && this.options.chat.model !== 'default') args.push('--model', this.options.chat.model);
    const sessionId = this.options.chat.sessionIds?.['claude-code']; if (sessionId) args.push('--resume', sessionId);
    this.child = await launch(executable, args, this.options);
    this.child.once('error', e => this.reject?.(e));
    this.child.once('exit', code => { if (!this.finished) this.reject?.(Error('Claude Code stopped before completing the response' + (code ? ` (exit ${code}).` : '.'))); });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      let event: any; try { event = JSON.parse(line); } catch { return; }
      if (event.session_id) this.options.saveSession(event.session_id);
      if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') this.options.delta(event.event.delta.text);
      if (event.type === 'stream_event' && event.event?.content_block?.type === 'tool_use') this.options.activity(event.event.content_block.name.replace('mcp__studio__', ''));
      if (event.type === 'result') {
        this.awaitingResults--;
        if (event.is_error) { this.finished = true; this.reject?.(Error(event.result || 'Claude Code returned an error.')); }
        else if (this.awaitingResults <= 0) { this.finished = true; this.child?.stdin.end(); this.resolve?.(); }
      }
    });
  }
  async prompt(text: string, images: any[] = []) {
    const completion = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    void completion.catch(()=>{});
    // Install completion handlers before process creation, including early spawn failures.
    await this.start(); this.write(text, images);
    for (const item of this.queued.splice(0)) this.write(item.text, item.images);
    return completion;
  }
  private write(text: string, images: any[]) {
    this.awaitingResults++;
    this.child!.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }, ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } }))] } }) + '\n');
  }
  async steer(text: string, images: any[] = []) { if (this.finished) throw Error('Wait for the response to finish before sending.'); if (!this.child) this.queued.push({text,images}); else this.write(text, images); }
  async stop() { this.finished = true; this.child?.kill('SIGTERM'); this.resolve?.(); }
  close() { this.child?.kill('SIGTERM'); }
}

export class GeminiRun implements NativeRun {
  private child?: ChildProcessWithoutNullStreams;
  private connection?: ClientSideConnection;
  private sessionId = '';
  private cancelled = false;
  private next: { text: string; images: any[] }[] = [];
  constructor(private options: Options) {}
  async start() {
    const executable = await findCLI('gemini'); if (!executable) throw Error('Install Gemini CLI, sign in with your Google subscription, and refresh Accounts.');
    this.child = await launch(executable, ['--acp','--allowed-mcp-server-names','studio','--allowed-tools','mcp_studio_*'], this.options);
    this.child.on('error', () => this.options.auth('Gemini CLI could not start. Check its installation.'));
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: async ({ update }: any) => {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') this.options.delta(update.content.text);
        if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') this.options.activity(update.title || 'Working');
      },
      // Studio exposes scoped tools through MCP; direct native tool mutations are declined.
      requestPermission: async (request: any) => {
        const option = request.options.find((o: any) => o.kind === 'reject_once');
        return { outcome: option ? { outcome: 'selected' as const, optionId: option.optionId } : { outcome: 'cancelled' as const } };
      },
    }), ndJsonStream(Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>));
    await timed(this.connection.initialize({ protocolVersion: 1, clientInfo: { name: 'loom-studio', version: '0.1.0' }, clientCapabilities: {} }));
    const mcpServers = [{ name: 'studio', command: process.execPath, args: [this.options.mcpPath], env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }, { name: 'STUDIO_TOOL_ENDPOINT', value: this.options.toolEndpoint }, { name: 'STUDIO_TOOL_TOKEN', value: this.options.toolToken }, { name: 'STUDIO_CHAT_ID', value: this.options.chat.id }] }];
    const created = await timed(this.connection.newSession({ cwd: this.options.cwd, mcpServers }));
    this.sessionId = created.sessionId; this.options.saveSession(this.sessionId);
  }
  async prompt(text: string, images: any[] = []) {
    await this.start();
    let current = { text: this.options.systemPrompt + '\n\n' + text, images };
    do {
      await this.connection!.prompt({ sessionId: this.sessionId, prompt: [{ type: 'text', text: current.text }, ...current.images.map(i => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))] });
      const next = this.next.splice(0); if (!next.length) break;
      current = { text: next.map(n => n.text).join('\n\n'), images: next.flatMap(n => n.images) };
    } while (!this.cancelled);
  }
  async steer(text: string, images: any[] = []) { this.next.push({ text, images }); if (this.connection && this.sessionId) await this.connection.cancel({ sessionId: this.sessionId }); }
  async stop() { this.cancelled = true; this.next = []; await this.connection?.cancel({ sessionId: this.sessionId }).catch(() => {}); this.child?.kill('SIGTERM'); }
  close() { this.child?.kill('SIGTERM'); }
}
