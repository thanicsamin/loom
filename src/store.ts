import { mkdir, readFile, writeFile, rename, readdir, stat, realpath, copyFile, chmod } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {validateCanvasScripts} from './canvas-validate.ts';
import type { Attachment, Canvas, Chat, Criterion, Database, ProviderId } from './shared.ts';
import {DEFAULT_JUDGE_MODEL} from './shared.ts';
import {thinkingKey} from './thinking.ts';

export function publicDatabase(db: Database): Database {
  return structuredClone({...db,canvases:db.canvases.map(c=>({...c,html:'',versions:c.versions.map(v=>({...v,html:''}))}))});
}

export const providers: ProviderId[] = ['openai-codex', 'claude-code', 'gemini-cli', 'opencode-go'];
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
export function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw Error('Enter a name of 1–120 characters.');
  return value.trim();
}
export function diskName(value: unknown): string {
  const name = cleanName(value);
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw Error('Use a folder name without path separators or reserved characters.');
  return name;
}
export function boundedJSON(value: unknown, limit = 65536): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length > limit) throw Error('This interaction state is too large to save.');
  return JSON.parse(json);
}
export function migrateQuizState(canvas:Canvas):boolean{
  const state=canvas.state;if(!state||typeof state!=='object'||Array.isArray(state))return false;
  const old=(state as any).quizAnswers;if(!old||typeof old!=='object'||Array.isArray(old))return false;
  const entries=Object.entries(old).filter(([k,v])=>k.length>0&&k.length<=200&&typeof v==='string'&&v.length<=32000);
  let changed=false;if(!canvas.quizAnswers&&entries.length){canvas.quizAnswers=boundedJSON(Object.fromEntries(entries)) as Record<string,string>;changed=true;}
  // The old quiz helper spread authored strings into numeric character keys.
  // Recover that original string only when all keys form an exact character sequence.
  const keys=Object.keys(state).filter(k=>k!=='quizAnswers').sort((a,b)=>Number(a)-Number(b));
  if(keys.length&&keys.every((k,i)=>k===String(i)&&typeof (state as any)[k]==='string'&&(state as any)[k].length===1)){
    const original=keys.map(k=>(state as any)[k]).join('');try{JSON.parse(original);canvas.state=original;changed=true;}catch{}
  }
  return changed;
}
export async function scopedPath(root: string, input: string, create = false): Promise<string> {
  if (typeof input !== 'string' || input.length > 2048 || input.includes('\0')) throw Error('Invalid file path.');
  const base = await realpath(root), candidate = resolve(base, input || '.');
  const inside = (path: string) => { const rel = relative(base, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')); };
  if (!inside(candidate)) throw Error('Choose a path inside this project.');
  let parent = candidate;
  while (true) {
    try { if (!inside(await realpath(parent))) throw Error('This link points outside the project.'); break; }
    catch (error: any) { if (error.code !== 'ENOENT' || !create || parent === base) throw error; parent = dirname(parent); }
  }
  return candidate;
}
const mimeFor = (name: string) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.html': 'text/html', '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain', '.tex': 'text/plain', '.csv': 'text/plain' }[extname(name).toLowerCase()] || 'application/octet-stream');
function sniffImage(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString() === 'GIF89a' || bytes.subarray(0, 6).toString() === 'GIF87a') return 'image/gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
}
export class Store {
  db: Database = { version: 1, chats: [], projects: [], folders: [], canvases: [], attachments: [], settings: { provider: 'openai-codex', models: {}, judge: 'opencode', judgeModel: DEFAULT_JUDGE_MODEL, theme: 'system', customPrompt: '' } };
  private writes: Promise<void> = Promise.resolve();
  private attaching = new Map<string, number>();
  constructor(public directory: string, private changed: () => void = () => {}) {}
  onChange(changed: () => void) { this.changed=changed; }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let original='';
    try { original=await readFile(join(this.directory, 'workspace.json'), 'utf8');const saved = JSON.parse(original); if (saved.version !== 1 || !Array.isArray(saved.chats) || !Array.isArray(saved.projects)) throw Error('Workspace data has an unsupported format.'); this.db = saved; }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    if(this.db.canvases.map(migrateQuizState).some(Boolean)){if(original)try{await writeFile(join(this.directory,'workspace-before-quiz-state.json'),original,{mode:0o600,flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;}await this.commit();}
    if(!this.db.settings.judgeModel){this.db.settings.judge='opencode';this.db.settings.judgeModel=DEFAULT_JUDGE_MODEL;await this.commit();}
  }
  chat(id: string) { const chat = this.db.chats.find(c => c.id === id); if (!chat) throw Error('Chat not found.'); return chat; }
  project(id: string) { const project = this.db.projects.find(p => p.id === id); if (!project) throw Error('Project not found.'); return project; }
  canvas(id: string) { const canvas = this.db.canvases.find(c => c.id === id); if (!canvas) throw Error('Canvas not found.'); return canvas; }
  attachment(id: string) { const item = this.db.attachments.find(a => a.id === id); if (!item) throw Error('Attachment not found.'); return item; }
  async commit() {
    const snapshot = JSON.stringify(this.db);
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temporary = join(this.directory, 'workspace.json.tmp');
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, join(this.directory, 'workspace.json'));
    });
    await this.writes; this.changed();
  }
  async newChat(input: { projectId?: string; folderId?: string; provider?: ProviderId; model?: string } = {}) {
    if (input.projectId) this.project(input.projectId);
    if (input.folderId && !this.db.folders.some(f => f.id === input.folderId && f.projectId === input.projectId)) throw Error('Choose a folder in this project.');
    const provider = input.provider || this.db.settings.provider;
    if (!providers.includes(provider)) throw Error('Unknown chat provider.');
    const chat: Chat = { id: randomUUID(), title: 'New chat', projectId: input.projectId, folderId: input.folderId, provider, model: input.model || this.db.settings.models[provider] || '', thinking:this.db.settings.thinking?.[thinkingKey(provider,input.model||this.db.settings.models[provider]||'')], messages: [], draft: '', draftAttachments: [], updatedAt: Date.now() };
    this.db.chats.unshift(chat); this.db.activeChatId = chat.id; await this.commit(); return chat;
  }
  async workspace(chatId: string) {
    const chat = this.chat(chatId);
    if (chat.projectId) return this.project(chat.projectId).path;
    const directory = join(this.directory, 'workspaces', chat.id); await mkdir(directory, { recursive: true }); return directory;
  }
  async createProject(name: string, path: string) {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw Error('Choose a project directory.');
    const duplicate = this.db.projects.find(p => p.path === canonical); if (duplicate) return duplicate;
    const project = { id: randomUUID(), name: cleanName(name), path: canonical, instructions: '', createdAt: Date.now() };
    this.db.projects.push(project); await this.commit(); return project;
  }
  async createFolder(input: { kind: 'chat' | 'disk'; projectId?: string; chatId?: string; name: string; parent?: string }) {
    if (input.kind === 'chat') {
      if (!input.projectId) throw Error('Chat folders belong to a project.'); this.project(input.projectId);
      if (input.parent && !this.db.folders.some(f => f.id === input.parent && f.projectId === input.projectId)) throw Error('Parent folder not found.');
      const name = cleanName(input.name);
      if (this.db.folders.some(f => f.name === name && f.projectId === input.projectId && f.parentId === input.parent)) throw Error('A chat folder with this name already exists here.');
      const folder = { id: randomUUID(), projectId: input.projectId, name, parentId: input.parent }; this.db.folders.push(folder); await this.commit(); return folder;
    }
    if (input.kind !== 'disk') throw Error('Choose chat or disk folder.');
    const root = input.projectId ? this.project(input.projectId).path : await this.workspace(input.chatId!);
    const path = await scopedPath(root, join(input.parent || '', diskName(input.name)), true);
    await mkdir(path); this.changed(); return { name: basename(path), path: relative(root, path) };
  }
  async listFiles(chatId: string, path = '') {
    const root = await this.workspace(chatId), target = await scopedPath(root, path);
    const entries = await readdir(target, { withFileTypes: true });
    return entries.filter(e => !e.name.startsWith('.')).slice(0, 500).map(e => ({ name: e.name, path: relative(root, join(target, e.name)).replaceAll('\\','/'), directory: e.isDirectory(), link: e.isSymbolicLink() })).sort((a,b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async readProjectFile(chatId: string, path: string) {
    const target = await scopedPath(await this.workspace(chatId), path), info = await stat(target);
    if (!info.isFile() || info.size > 256000) throw Error('Preview a text file smaller than 256 KB. Attach larger files to a message.');
    const bytes = await readFile(target); if (bytes.includes(0)) throw Error('This is a binary file. Open it with its usual application.'); return bytes.toString('utf8');
  }
  async writeProjectFile(chatId: string, path: string, content: string) {
    if (typeof content !== 'string' || content.length > 2_000_000) throw Error('Keep project files below 2 MB.');
    const target = await scopedPath(await this.workspace(chatId), path, true);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); this.changed(); return { path };
  }
  async addAttachment(chatId: string, name: string, mime: string, bytes: Buffer) {
    const chat = this.chat(chatId);
    if (chat.draftAttachments.length + (this.attaching.get(chatId) || 0) >= 10) throw Error('Attach up to ten files per message.');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('Choose a nonempty file of at most 20 MB.');
    const id = randomUUID(), safe = basename(name.replaceAll('\\', '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,160) || 'attachment';
    const detected = sniffImage(bytes);
    if (mime.startsWith('image/') && mime !== 'image/svg+xml' && !detected) throw Error('Use a PNG, JPEG, GIF, or WebP image.');
    this.attaching.set(chatId, (this.attaching.get(chatId) || 0) + 1);
    try {
    const folder = join(this.directory, 'attachments', chatId); await mkdir(folder, { recursive: true, mode: 0o700 });
    const item: Attachment = { id, chatId, name: safe, mime: detected || mimeFor(safe), size: bytes.length, path: join(folder, id + '-' + safe) };
    await writeFile(item.path, bytes, { mode: 0o600 }); this.db.attachments.push(item); chat.draftAttachments.push(id); await this.commit(); return item;
    } finally { this.attaching.set(chatId, (this.attaching.get(chatId) || 1) - 1); }
  }
  async importAttachment(chatId: string, path: string) { const info = await stat(path); if (!info.isFile() || info.size > 20 * 1024 * 1024) throw Error('Choose a file of at most 20 MB.'); return this.addAttachment(chatId, basename(path), mimeFor(path), await readFile(path)); }
  async attachmentContext(chatId: string, ids: string[]) {
    const images: { type: 'image'; data: string; mimeType: string }[] = [], text: string[] = [];
    for (const id of ids) {
      const item = this.attachment(id); if (item.chatId !== chatId) throw Error('This attachment belongs to another chat.');
      if (['image/png','image/jpeg','image/webp','image/gif'].includes(item.mime)) {
        if (item.size > 5 * 1024 * 1024) throw Error('Keep model image inputs below 5 MB.');
        images.push({ type: 'image', data: (await readFile(item.path)).toString('base64'), mimeType: item.mime });
      } else {
        let preview = '';
        if (item.size <= 100000 && /\.(txt|md|tex|json|csv|tsv|log|py|js|ts|html|css|svg)$/i.test(item.name)) preview = '\nUntrusted file content:\n' + await readFile(item.path, 'utf8');
        text.push(`User attachment ${item.id}: ${item.name} (${item.mime}, ${item.size} bytes). Read with read_attachment.${preview}`);
      }
    }
    return { text: text.join('\n\n'), images };
  }
  async publishCanvas(chatId: string, input: { id?: string; title: string; html: string; rubric?: Criterion[]; resetState?: boolean }) {
    if (typeof input.html !== 'string' || !input.html.trim() || input.html.length > 2_000_000) throw Error('Publish a nonempty HTML document below 2 MB.');
    validateCanvasScripts(input.html);
    const title = cleanName(input.title), rubric = input.rubric ?? (input.id ? this.canvas(input.id).rubric : []);
    if (!Array.isArray(rubric) || rubric.length > 12 || rubric.some(r => !r.id || !r.label || !r.description || r.description.length > 3000) || new Set(rubric.map(r => r.id)).size !== rubric.length) throw Error('Use up to twelve uniquely identified rubric criteria.');
    let canvas: Canvas;
    if (input.id) {
      canvas = this.canvas(input.id); if (canvas.chatId !== chatId) throw Error('This canvas belongs to another chat.');
      canvas.versions.push({ html: canvas.html, title: canvas.title, at: canvas.updatedAt, rubric: canvas.rubric });
      if (canvas.versions.length > 30) canvas.versions.shift();
      Object.assign(canvas, { html: input.html, title, rubric, revision: canvas.revision + 1, updatedAt: Date.now(), ...(input.resetState ? { state: null,quizAnswers:{} } : {}) });
    } else {
      this.chat(chatId);
      canvas = { id: randomUUID(), chatId, title, html: input.html, rubric, versions: [], state: null, revision: 1, updatedAt: Date.now() };
      this.db.canvases.push(canvas);
    }
    await this.commit(); return { id: canvas.id, title, revision: canvas.revision };
  }
  async saveCanvasState(id: string, state: unknown) { this.canvas(id).state = boundedJSON(state); await this.commit(); }
  async saveQuizAnswer(id:string,key:string,answer:string){
    if(typeof key!=='string'||!key||key.length>200||typeof answer!=='string'||answer.length>32000)throw Error('Invalid saved quiz answer.');
    const canvas=this.canvas(id);canvas.quizAnswers=boundedJSON({...canvas.quizAnswers,[key]:answer}) as Record<string,string>;await this.commit();
  }
  async restoreCanvas(id: string, version: number) {
    const canvas = this.canvas(id), previous = canvas.versions[version]; if (!previous) throw Error('Revision not found.');
    return this.publishCanvas(canvas.chatId, { id, title: previous.title, html: previous.html, rubric: previous.rubric });
  }
  async exportCanvas(id: string, destination: string) { await writeFile(destination, this.canvas(id).html); }
  async flush() { await this.writes; }
}
