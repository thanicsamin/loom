import {readingSize, type CanvasAppearance} from './canvas-theme.ts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import { Plus, Search, Settings, ChevronRight, ChevronDown, Folder, FolderPlus, Paperclip, ArrowUp, Square, X, Maximize2, Minimize2, Code2, Download, History, Pin, MoreHorizontal, File, ArrowLeft, ExternalLink, Sparkles, PanelLeft, Check, LoaderCircle, Move, Trash2, Pencil, MessageSquare, Monitor, Moon, Sun, Copy } from 'lucide-react';
import { renderMarkdown } from './markdown.ts';
import type { Attachment, Canvas, CanvasPreview, Chat, Project, PublicState, ProviderId, StudioEvent } from './shared.ts';
import 'katex/dist/katex.min.css';
import './ui.css';
import { LOGO_PATH, LOGO_TRANSFORM } from './logo-path.ts';

const api = window.studio;
function LoomMark({ size = 20 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true"><path d={LOGO_PATH} transform={LOGO_TRANSFORM} fill="currentColor" /></svg>; }
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const attachmentURL = (a: Attachment) => `studio://attachment/${a.id}`;
type Action = (method: string, data?: any) => Promise<any>;
type Source = { id?: string; path?: string; page?: number; chatId?: string };
type ModalState = { kind: 'settings' } | { kind: 'project'; project?: Project } | { kind: 'folder'; project: Project; path?: string } | { kind: 'chat'; chat: Chat } | { kind: 'attachment'; item: Attachment } | { kind: 'file'; name: string; text: string } | { kind: 'pdf'; name: string; source: Source } | null;

function IconButton({ title, children, onClick, disabled, className = '' }: { title: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" title={title} aria-label={title} className={`icon-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Modal({ title, children, close, wide }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    root.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const key = (e: KeyboardEvent) => {
      // Escape closes the innermost surface first: an open select, then the dialog.
      if (e.key === 'Escape' && !root.current?.querySelector('select:open')) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const nodes = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')].filter(n => n.offsetParent !== null);
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); prior?.focus(); };
  }, []);
  return <div className="modal-shade" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={root} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`}><div className="modal-heading"><h2>{title}</h2><IconButton title="Close" onClick={close}><X size={18} /></IconButton></div>{children}</div></div>;
}
const Markdown = React.memo(function Markdown({ text, onSource }: { text: string; onSource?: (source: Source) => void }) {
  const html = useMemo(() => renderMarkdown(text, value => DOMPurify.sanitize(value, { FORBID_TAGS: ['style','iframe','form','input','button'], FORBID_ATTR: ['style'], ADD_ATTR: ['data-loom-math'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|studio:\/\/source(?:[/?]|$)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i })), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onClick={e => {
    const anchor = (e.target as HTMLElement).closest('a'); if (anchor) { e.preventDefault(); if (anchor.href.startsWith('studio://source')) { const u=new URL(anchor.href); onSource?.({path:u.searchParams.get('path')||undefined,id:u.searchParams.get('id')||undefined,page:Number(u.searchParams.get('page'))||1}); } else if (/^https?:/.test(anchor.href)) void api.openExternal(anchor.href); }
  }} />;
});
function Attachments({ items, remove, preview }: { items: Attachment[]; remove?: (id: string) => void; preview: (item: Attachment) => void }) {
  return <div className="attachments">{items.map(item => <div className="attachment" key={item.id}><button className="attachment-open" onClick={() => preview(item)}>{item.mime.startsWith('image/') && item.mime !== 'image/svg+xml' ? <img src={attachmentURL(item)} alt={item.name} /> : <span className="file-thumb"><File size={20} /></span>}<span><strong>{item.name}</strong><small>{size(item.size)}</small></span></button>{remove && <IconButton title={`Remove ${item.name}`} onClick={() => remove(item.id)}><X size={14} /></IconButton>}</div>)}</div>;
}
function LiveCanvas({ canvas, action, onAsk, notify, onSource, appearance }: { canvas: Canvas; action: Action; onAsk: (text: string) => void; notify: (text: string) => void; onSource: (source: Source) => void; appearance:CanvasAppearance }) {
  const [full, setFull] = useState(false), [source, setSource] = useState(false), [history, setHistory] = useState(false), [height, setHeight] = useState(160), [error, setError] = useState('');
  const [sourceHTML,setSourceHTML]=useState('');
  useEffect(()=>{if(!source)return;let active=true;setSourceHTML('Loading source…');void api.call('getCanvas',{id:canvas.id}).then(c=>{if(active)setSourceHTML(c.html);}).catch(e=>{if(active)setSourceHTML(err(e));});return()=>{active=false;};},[source,canvas.id,canvas.revision]);
  const frame = useRef<HTMLIFrameElement>(null), latest = useRef(canvas), stateTimer = useRef<ReturnType<typeof setTimeout>>(undefined), saved = useRef<unknown>(canvas.state);
  latest.current = canvas;
  const token = useMemo(() => crypto.randomUUID(), [canvas.id, canvas.revision, full, source]);
  // Saved interactions must not reload a running document. Only source revisions do.
  const documentURL = `studio://canvas/${canvas.id}?token=${token}&revision=${canvas.revision}`;
  const applyAppearance = () => {frame.current?.contentWindow?.postMessage({channel:'studio-canvas',token,type:'appearance',theme:appearance.theme||'system',fontSize:readingSize(appearance.fontSize)},'*');};
  useEffect(applyAppearance,[appearance.theme,appearance.fontSize,token]);
  const expand = async () => { await api.call('canvasState', { id: canvas.id, state: saved.current }).catch(() => {}); setFull(!full); };
  useEffect(() => { setError(''); saved.current=canvas.state; }, [canvas.revision]);
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== frame.current?.contentWindow || d?.channel !== 'studio-canvas' || d.token !== token) return;
      if (d.type === 'resize' && Number.isFinite(d.height)) setHeight(Math.max(80, Math.ceil(d.height)));
      if (d.type === 'state') {
        saved.current = d.state; clearTimeout(stateTimer.current);
        stateTimer.current = setTimeout(() => { void action('canvasState', { id: canvas.id, state: saved.current }).catch(() => {}); }, 220);
      }
      if (d.type === 'error') setError(String(d.message).slice(0, 500));
      if(d.type==='quizAnswer')void api.call('canvasQuizAnswer',{id:canvas.id,key:d.key,answer:d.answer}).catch(e=>setError(err(e)));
      if (d.type === 'grade') {
        try { const result = await api.call('grade', { id: canvas.id, answer: d.answer }); frame.current?.contentWindow?.postMessage({ channel: 'studio-canvas', token, id: d.id, result }, '*'); }
        catch (e) { frame.current?.contentWindow?.postMessage({ channel: 'studio-canvas', token, id: d.id, error: err(e) }, '*'); }
      }
      if (d.type === 'cancelGrade') void api.call('cancelGrade',{id:canvas.id}).catch(()=>{});
      if (d.type === 'source') onSource(d.source);
      if (d.type === 'ask' && typeof d.text === 'string') onAsk(d.text.slice(0, 10000));
      if (d.type === 'link' && typeof d.url === 'string' && /^https?:/.test(d.url)) { if(confirm('Open this source in your browser?\n'+d.url)) void api.openExternal(d.url).catch(e=>notify(err(e))); }
    };
    window.addEventListener('message', listener);
    return () => { window.removeEventListener('message', listener); clearTimeout(stateTimer.current); if (latest.current.revision===canvas.revision && saved.current !== undefined) void api.call('canvasState', { id: canvas.id, state: saved.current }).catch(() => {}); };
  }, [canvas.id, token]);
  const content = <section className={`live-canvas ${full ? 'full' : ''}`} aria-label={canvas.title}>
    <div className="canvas-toolbar"><div className="canvas-title"><span className="live-dot" /><strong>{canvas.title}</strong><small>Interactive · v{canvas.revision}</small></div><div className="canvas-tools">
      <IconButton title={source ? 'Show canvas' : 'View source'} onClick={() => { setSource(!source); setHistory(false); }}><Code2 size={16} /></IconButton>
      <IconButton title="Revision history" onClick={() => setHistory(!history)} disabled={!canvas.versions.length}><History size={16} /></IconButton>
      <IconButton title="Export HTML" onClick={() => { void api.exportCanvas(canvas.id).then(ok => { if (ok) notify('Canvas exported.'); }).catch(e => notify(err(e))); }}><Download size={16} /></IconButton>
      <IconButton title={full ? 'Exit fullscreen' : 'Expand canvas'} onClick={() => { void expand(); }}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
    </div></div>
    {history && <div className="revision-list">{canvas.versions.map((v, i) => <button key={i} onClick={() => { void action('restoreCanvas', { id: canvas.id, version: i }).then(() => setHistory(false)); }}>Restore v{canvas.revision - canvas.versions.length + i} · {new Date(v.at).toLocaleString()}</button>)}</div>}
    {source ? <div className="canvas-source"><button className="small-button copy" onClick={() => { void navigator.clipboard.writeText(sourceHTML).then(() => notify('Source copied.')); }}><Copy size={14} />Copy</button><pre>{sourceHTML}</pre></div> : <iframe ref={frame} onLoad={applyAppearance} title={canvas.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={documentURL} style={{ height: full ? '100%' : height }} />}
    {error && <div className="canvas-error"><span>This canvas reported an error: {error}</span><button onClick={() => onAsk(`Please repair the canvas “${canvas.title}” (${canvas.id}). It reported: ${error}`)}>Ask for a repair</button></div>}
  </section>;
  return full ? <Modal title={canvas.title} wide close={() => setFull(false)}>{content}</Modal> : content;
}

const BuildingCanvas=React.memo(function BuildingCanvas({preview,appearance}:{preview:CanvasPreview;appearance:CanvasAppearance}){
  const frame=useRef<HTMLIFrameElement>(null),[height,setHeight]=useState(80);
  const token=useMemo(()=>crypto.randomUUID(),[preview.id]);
  const update=()=>{const target=frame.current?.contentWindow;target?.postMessage({channel:'loom-preview',token,type:'appearance',theme:appearance.theme||'system',fontSize:readingSize(appearance.fontSize)},'*');target?.postMessage({channel:'loom-preview',token,type:'html',html:preview.html},'*');};
  useEffect(update,[preview.html,appearance.theme,appearance.fontSize,token]);
  useEffect(()=>{const listener=(event:MessageEvent)=>{const d=event.data;if(event.source===frame.current?.contentWindow&&d?.channel==='loom-preview'&&d.token===token&&d.type==='resize'&&Number.isFinite(d.height))setHeight(Math.max(80,Math.ceil(d.height)));};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[token]);
  return <section className="live-canvas building-canvas" aria-label={preview.title+' · building'} aria-busy="true"><div className="canvas-toolbar"><div className="canvas-title"><LoaderCircle size={13} className="spin"/><strong>{preview.title}</strong><small>Building · interactions available when ready</small></div></div><iframe ref={frame} title={preview.title+' preview'} src={'studio://preview/document?token='+token} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{height}} onLoad={update}/></section>;
});

function App() {
  const [state, setState] = useState<PublicState>(), [error, setError] = useState(''), [toast, setToast] = useState(''), [modal, setModal] = useState<ModalState>(null), [search, setSearch] = useState(''), [sidebar, setSidebar] = useState(true), [expanded, setExpanded] = useState<Record<string, boolean>>({}), [filesProject, setFilesProject] = useState<string>(), [filesPath, setFilesPath] = useState(''), [files, setFiles] = useState<any[]>([]), [draft, setDraft] = useState(''), [uploading, setUploading] = useState(false), [sending, setSending] = useState(false), [unseen, setUnseen] = useState(false), [auth, setAuth] = useState<any>();
  const [messageLimit, setMessageLimit] = useState(60);
  const [navigating, setNavigating] = useState(false);
  const [previews,setPreviews]=useState<Record<string,CanvasPreview>>({});
  const drafts = useRef(new Map<string, string>()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()), snapshot = useRef(state), textarea = useRef<HTMLTextAreaElement>(null), scroller = useRef<HTMLDivElement>(null), nearBottom = useRef(true), fileInput = useRef<HTMLInputElement>(null), toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  snapshot.current = state;
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5500); }, []);
  const refresh = useCallback(async () => { const next = await api.call<PublicState>('state'); setState(next); return next; }, []);
  const action: Action = useCallback(async (method, data) => { try { const result = await api.call(method, data); await refresh(); return result; } catch (e) { setError(err(e)); throw e; } }, [refresh]);
  const quiet: Action = (method, data) => action(method, data).catch(() => undefined);
  useEffect(() => {
    void refresh().catch(e => setError(err(e)));
    const deltas=new Map<string,string>();let frame=0;
    const unsubscribe=api.onEvent((event: StudioEvent) => {
      if (event.type === 'state') {cancelAnimationFrame(frame);frame=0;deltas.clear();setState(event.state);}
      if (event.type === 'delta') {
        deltas.set(event.chatId,(deltas.get(event.chatId)||'')+event.delta);
        if(!frame)frame=requestAnimationFrame(()=>{frame=0;const pending=new Map(deltas);deltas.clear();setState(current=>current?{...current,runs:current.runs.map(r=>pending.has(r.chatId)?{...r,text:r.text+pending.get(r.chatId)}:r)}:current);});
      }
      if (event.type === 'auth') setAuth(event);
      if(event.type==='canvas-preview')setPreviews(current=>{const next={...current};if(event.preview)next[event.chatId]=event.preview;else delete next[event.chatId];return next;});
      if ((event as any).type === 'fatal') setError((event as any).message);
    });
    return()=>{cancelAnimationFrame(frame);unsubscribe();};
  }, []);
  const chat = state?.chats.find(c => c.id === state.activeChatId), run = state?.runs.find(r => r.chatId === chat?.id), provider = state?.providers.find(p => p.id === chat?.provider), project = state?.projects.find(p => p.id === chat?.projectId);
  const selectedModel=chat?.model?provider?.models.find(m=>m.id===chat.model):provider?.models[0];
  useEffect(()=>{if(chat&&run?.preview&&!previews[chat.id])void api.call<CanvasPreview|null>('getPreview',{chatId:chat.id}).then(preview=>{if(preview)setPreviews(current=>({...current,[chat.id]:preview}));}).catch(()=>{});},[chat?.id,run?.preview?.id]);
  useEffect(() => { if(chat?.projectId)setExpanded(current=>({...current,[chat.projectId!]:true})); },[chat?.id,chat?.projectId]);
  useEffect(() => {
    if (!chat) { setDraft(''); return; }
    setDraft(drafts.current.get(chat.id) ?? chat.draft); setMessageLimit(60); nearBottom.current = true; setUnseen(false); setError('');
    requestAnimationFrame(() => { textarea.current?.focus(); scroller.current?.scrollTo(0, scroller.current.scrollHeight); });
  }, [chat?.id]);
  useEffect(() => {
    if (nearBottom.current) requestAnimationFrame(() => scroller.current?.scrollTo(0, scroller.current.scrollHeight)); else setUnseen(true);
  }, [chat?.messages.length, run?.text, state?.canvases.map(c => `${c.id}:${c.revision}`).join(',')]);
  useEffect(() => { const n = textarea.current; if (n) { n.style.height = 'auto'; n.style.height = Math.min(180, n.scrollHeight) + 'px'; } }, [draft]);
  useEffect(() => { document.documentElement.dataset.theme = state?.settings.theme || 'system'; }, [state?.settings.theme]);
  useEffect(() => {document.documentElement.style.setProperty('--reading-size',readingSize(state?.settings.fontSize)+'px');},[state?.settings.fontSize]);
  const newChat = async (projectId?: string) => { setNavigating(true); try { await quiet('newChat', { projectId }); setModal(null); } finally { setNavigating(false); } };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); void newChat(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSidebar(true); document.querySelector<HTMLInputElement>('#chat-search')?.focus(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  const setChatDraft = (value: string, id = chat?.id) => {
    if (!id) return;
    drafts.current.set(id, value); if (id === snapshot.current?.activeChatId) setDraft(value);
    clearTimeout(timers.current.get(id)); timers.current.set(id, setTimeout(() => { void api.call('saveDraft', { chatId: id, text: drafts.current.get(id) || '' }).catch(e => setError(err(e))); timers.current.delete(id); }, 200));
  };
  const openSource = useCallback((source: Source, owner=chat?.id) => { if(!source||(!source.id&&!source.path))return; setModal({kind:'pdf',name:source.id?snapshot.current?.attachments.find(a=>a.id===source.id)?.name||'Source PDF':source.path!.split('/').at(-1)||'Source PDF',source:{...source,chatId:owner}}); },[chat?.id]);
  const ask = (text: string) => { setChatDraft(text); textarea.current?.focus(); notify('Question added to the composer. Press Enter to send or steer.'); };
  const send = async () => {
    if (!chat || sending || uploading || (!draft.trim() && !chat.draftAttachments.length)) return;
    const id = chat.id, text = draft; setSending(true); setError(''); clearTimeout(timers.current.get(id)); timers.current.delete(id);
    try {
      await api.call('saveDraft', { chatId: id, text });
      await api.call('send', { chatId: id, text, attachments: chat.draftAttachments });
      if (drafts.current.get(id) === text || !drafts.current.has(id)) { drafts.current.set(id, ''); if (snapshot.current?.activeChatId === id) setDraft(''); }
      await refresh(); nearBottom.current = true;
    } catch (e) { setError(err(e)); } finally { setSending(false); textarea.current?.focus(); }
  };
  const upload = async (selected: globalThis.File[]) => {
    if (!chat || uploading) return;
    setUploading(true); setError('');
    try { for (const item of selected) await api.upload(chat.id, item.name, item.type, await item.arrayBuffer()); }
    catch (e) { setError(err(e)); } finally { setUploading(false); await refresh(); }
  };
  const pickFiles = async () => { if (!chat) return; setUploading(true); try { await api.pickFiles(chat.id); } catch (e) { setError(err(e)); } finally { setUploading(false); await refresh(); } };
  const selectChat = (id: string) => { setNavigating(true); void quiet('selectChat', { id }).finally(() => setNavigating(false)); };
  const visible = (c: Chat) => !search || `${c.title} ${c.messages.map(m => m.text).join(' ')}`.toLowerCase().includes(search.toLowerCase());
  const chats = (state?.chats || []).filter(visible).sort((a, b) => b.updatedAt - a.updatedAt);
  const row = (c: Chat) => <div key={c.id} className={`chat-row ${c.id === chat?.id ? 'selected' : ''}`}><button onClick={() => selectChat(c.id)}>{state?.runs.find(r => r.chatId === c.id)?.busy ? <LoaderCircle size={14} className="spin" /> : c.pinned ? <Pin size={13} /> : <MessageSquare size={13} />}<span>{c.title}</span></button><IconButton title={`Manage ${c.title}`} onClick={() => setModal({ kind: 'chat', chat: c })}><MoreHorizontal size={16} /></IconButton></div>;
  const browseFiles = async (p: Project, path = '') => {
    setFilesProject(p.id); setFilesPath(path); let c = state?.chats.find(c => c.projectId === p.id);
    if (!c) c = await quiet('newChat', { projectId: p.id });
    if (!c) return;
    try { const listing = await action('listFiles', { chatId: c.id, path }); setFiles(listing); } catch { setFiles([]); }
  };
  if (!state) return <div className="loading"><div className="brand-mark"><LoomMark /></div><h2>Loom</h2><p>{error || 'Opening your workspace…'}</p></div>;
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length && chat) { e.preventDefault(); void upload([...e.dataTransfer.files]); } }}>
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><LoomMark size={26} /></span><span>Loom</span><IconButton title="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeft size={17} /></IconButton></div>
      <button aria-label="New chat" className="new-chat" onClick={() => { void newChat(); }}><Plus size={17} />New chat<kbd aria-hidden="true">{navigator.platform.includes('Mac') ? '⌘ N' : 'Ctrl N'}</kbd></button>
      <label className="search"><Search size={15} /><input id="chat-search" aria-label="Search chats" placeholder="Search chats" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</label>
      <div className="sidebar-scroll">
        {chats.some(c => c.pinned) && <><div className="section-label">Pinned</div>{chats.filter(c => c.pinned).map(row)}</>}
        <div className="section-label">Projects<IconButton title="Add project" onClick={() => setModal({ kind: 'project' })}><Plus size={15} /></IconButton></div>
        {!state.projects.length && <button className="empty-project" onClick={() => setModal({ kind: 'project' })}><FolderPlus size={16} />Attach a folder</button>}
        {state.projects.map(p => <div className="project-block" data-project-id={p.id} key={p.id}><div className="project-row"><button aria-expanded={!!(expanded[p.id] || search)} onClick={() => setExpanded(e => ({ ...e, [p.id]: !e[p.id] }))}>{expanded[p.id] || search ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={16} /><strong>{p.name}</strong></button><IconButton title={`New chat in ${p.name}`} onClick={() => { setExpanded(e => ({ ...e, [p.id]: true })); void newChat(p.id); }}><Plus size={15} /></IconButton><IconButton title={`Files in ${p.name}`} onClick={() => {setExpanded(e=>({...e,[p.id]:true}));if(filesProject===p.id)setFilesProject(undefined);else void browseFiles(p);}}><File size={14} /></IconButton><IconButton title={`${p.name} settings`} onClick={() => setModal({kind:'project',project:p})}><MoreHorizontal size={15} /></IconButton></div>{(expanded[p.id] || search) && <><div className="project-chats">{chats.filter(c => c.projectId === p.id).map(row)}{!chats.some(c => c.projectId === p.id) && <small className="muted">No chats yet.</small>}</div>{filesProject === p.id && <div className="files-browser"><div className="file-path"><button aria-label="Parent folder" onClick={() => { void browseFiles(p, filesPath.includes('/') ? filesPath.slice(0, filesPath.lastIndexOf('/')) : ''); }} disabled={!filesPath}><ArrowLeft size={13} /></button><span>{filesPath || p.name}</span><IconButton title="Create disk folder" onClick={() => setModal({ kind: 'folder', project: p, path: filesPath })}><FolderPlus size={14} /></IconButton></div>{files.map(f => <button key={f.path} className="file-row" onClick={() => {
          if (f.directory) { void browseFiles(p, f.path); return; }
          const c = state.chats.find(c => c.projectId === p.id); if(c && /\.pdf$/i.test(f.path)){openSource({path:f.path,page:1},c.id);return;} if (c) void action('readFile', { chatId: c.id, path: f.path }).then(text => setModal({ kind: 'file', name: f.name, text })).catch(() => {});
        }}>{f.directory ? <Folder size={14} /> : <File size={14} />}<span>{f.name}</span></button>)}{!files.length && <small className="muted">This folder is empty.</small>}<button className="open-folder" onClick={() => { void api.openPath(p.path).catch(e => setError(err(e))); }}><ExternalLink size={12} />Open on disk</button></div>}</>}</div>)}
        <div className="section-label">Chats</div>{chats.filter(c => !c.projectId && !c.pinned).map(row)}{!chats.length && <small className="muted">{search ? 'No chats match your search.' : 'Your chats will appear here.'}</small>}
      </div><button className="sidebar-settings" onClick={() => setModal({ kind: 'settings' })}><Settings size={17} /><span>Settings & connections</span><span className="tiny-dot" /></button>
    </aside>
    <main className="main"><header className="chat-header"><div className="header-leading">{!sidebar && <IconButton title="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={19} /></IconButton>}<span className="breadcrumb">{project ? <><Folder size={14} />{project.name}<ChevronRight size={12} /></> : <MessageSquare size={14} />}<strong>{chat?.title || 'Loom'}</strong></span></div>{chat && <div className="model-controls"><select title={run?.busy ? 'Stop or finish the response to change provider' : 'Chat provider'} aria-label="Chat provider" value={chat.provider} disabled={run?.busy} onChange={e => { void quiet('updateChat', { id: chat.id, provider: e.target.value, speed:'standard' }); }}>{state.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select title={run?.busy ? 'Stop or finish the response to change model' : 'Chat model'} aria-label="Chat model" value={chat.model || provider?.models[0]?.id || ''} disabled={run?.busy} onChange={e => { void quiet('updateChat', { id: chat.id, model: e.target.value, speed:'standard' }); }}>{provider?.models.map(m => <option key={m.id} value={m.id}>{m.name}{m.vision ? ' ◉' : ''}</option>)}</select><select aria-label="Thinking level" title={run?.busy?'Stop or finish the response to change thinking':selectedModel?.thinking?.length?'Thinking level · choices from the provider catalog':'This provider does not expose thinking levels'} value={chat.thinking||''} disabled={run?.busy||(!selectedModel?.thinking?.length&&!chat.thinking)} onChange={e=>{void quiet('updateChat',{id:chat.id,thinking:e.target.value});}}><option value="">{selectedModel?.defaultThinking?'Default · '+(selectedModel.thinking?.find(t=>t.value===selectedModel.defaultThinking)?.label||selectedModel.defaultThinking):'Provider default'}</option>{chat.thinking&&!selectedModel?.thinking?.some(t=>t.value===chat.thinking)&&<option value={chat.thinking} disabled>{chat.thinking} · unavailable</option>}{selectedModel?.thinking?.map(t=><option key={t.value} value={t.value} title={t.description}>{t.label}</option>)}</select>{chat.provider==='openai-codex' && <select title={run?.busy ? 'Stop or finish the response to change speed' : 'Response speed'} aria-label="Response speed" value={chat.speed||'standard'} disabled={run?.busy} onChange={e=>{void quiet('updateChat',{id:chat.id,speed:e.target.value});}}>{['standard','fast','ultrafast'].map(v=><option key={v} value={v} title={v!=='standard'&&!provider?.models.find(m=>m.id===(chat.model||provider.models[0]?.id))?.speeds?.includes(v) ? 'Unavailable for this model and account' : undefined} disabled={v!=='standard'&&!provider?.models.find(m=>m.id===(chat.model||provider.models[0]?.id))?.speeds?.includes(v)}>{v==='standard'?'Standard':v==='fast'?'Fast':'Sol Ultrafast'}</option>)}</select>}<button className={`connection-dot ${provider?.configured ? 'connected' : ''}`} title={`Account settings · ${provider?.detail || 'Not connected'}`} aria-label="Account connection" onClick={() => setModal({ kind: 'settings' })}><span aria-hidden="true" /></button></div>}</header>
      <div ref={scroller} className="conversation" onScroll={e => { const n = e.currentTarget; nearBottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 100; if (nearBottom.current) setUnseen(false); }}>
        {!chat || !chat.messages.length ? <div className="welcome"><h1>New chat</h1><p>Attach files, select a project, or send a message.</p><button className="sample-link" onClick={() => { void quiet('sample'); }}><Code2 size={15} />Open sample</button><button className="sample-link" onClick={()=>setModal({kind:'project'})}><FolderPlus size={15} />Add a project folder</button></div> : <div className="messages">{chat.messages.length > messageLimit && <button className="load-earlier" onClick={() => { nearBottom.current = false; setMessageLimit(n => n + 60); }}>Load earlier messages ({chat.messages.length - messageLimit})</button>}{chat.messages.slice(-messageLimit).map(m => <article className={`message ${m.role}`} key={m.id}><div className="message-label">{m.role === 'assistant' ? <><span className="assistant-glyph"><LoomMark size={19} /></span>Loom</> : <>You{m.steering && <span className="steer-badge">Steering</span>}</>}<time>{new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>{m.text && <Markdown text={m.text} onSource={openSource} />}{m.attachments?.length ? <Attachments items={state.attachments.filter(a => m.attachments!.includes(a.id))} preview={item => setModal({ kind: 'attachment', item })} /> : null}{m.canvasIds?.map(id => { const c = state.canvases.find(c => c.id === id); return c && <LiveCanvas appearance={state.settings} key={id} canvas={c} action={action} onAsk={ask} notify={notify} onSource={openSource} />; })}{m.interrupted && <small className="muted">Response stopped</small>}</article>)}{run?.busy && <article className="message assistant"><div className="message-label"><span className="assistant-glyph"><LoomMark size={19} /></span>Loom<LoaderCircle size={13} className="spin" /></div>{run.text ? <Markdown text={run.text} /> : <div className="working"><span /><span /><span /><small>{run.activity || 'Thinking…'}</small></div>}{run.activity && run.text && <small className="muted">{run.activity}</small>}{previews[chat.id]&&<BuildingCanvas preview={previews[chat.id]} appearance={state.settings}/>}</article>}</div>}
      </div>
      {unseen && <button className="new-output" onClick={() => { nearBottom.current = true; setUnseen(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }}>New output ↓</button>}
      <div className="composer-area">{(error || run?.error) && <div className="error-banner" role="alert"><span>{error || run?.error}</span>{run?.canRetry && <button className="retry-button" onClick={() => { setError(''); void quiet('retry', { chatId: run.chatId }); }}>Retry</button>}<IconButton title="Dismiss error" onClick={() => { setError(''); if (run) setState(s => s && ({ ...s, runs: s.runs.map(r => r.chatId === run.chatId ? { ...r, error: undefined } : r) })); }}><X size={14} /></IconButton></div>}
        {chat ? <div className={`composer ${run?.busy ? 'steering' : ''}`}><Attachments items={state.attachments.filter(a => chat.draftAttachments.includes(a.id))} remove={id => { void quiet('removeAttachment', { chatId: chat.id, id }); }} preview={item => setModal({ kind: 'attachment', item })} /><textarea disabled={navigating} ref={textarea} aria-label="Message" rows={1} placeholder={run?.busy ? 'Steer the current response…' : 'Message Loom…'} value={draft} onChange={e => setChatDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} onPaste={e => { const items = [...e.clipboardData.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is globalThis.File => !!f); if (items.length) { e.preventDefault(); void upload(items); } }} /><div className="composer-bottom"><IconButton title="Attach files" onClick={() => { void pickFiles(); }} disabled={uploading}><Paperclip size={19} /></IconButton><span className="composer-hint">{uploading ? <><LoaderCircle size={13} className="spin" />Adding files…</> : run?.busy ? <><span className="live-dot" />Enter to steer</> : <>Enter to send · Shift Enter for a new line</>}</span><div className="send-controls">{run?.busy && <button className="stop-button" onClick={() => { void quiet('stop', { chatId: chat.id }); }}><Square size={11} fill="currentColor" />Stop</button>}<button className="send-button" aria-label={run?.busy ? 'Steer' : 'Send'} title={uploading ? 'Wait for files to finish uploading' : sending ? 'Sending…' : !draft.trim() && !chat.draftAttachments.length ? 'Add a message or attachment to send' : run?.busy ? 'Steer the current run' : 'Send message'} onClick={() => { void send(); }} disabled={sending || uploading || (!draft.trim() && !chat.draftAttachments.length)}>{sending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}{run?.busy && <span>Steer</span>}</button></div></div></div> : <button className="start-button" onClick={() => { void newChat(); }}><Plus size={17} />Start a chat</button>}<div className="composer-footnote">{run?.busy ? 'New messages steer the active response.' : ''}</div>
      </div>
    </main>
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {modal && <Modal title={modal.kind === 'settings' ? 'Settings & connections' : modal.kind === 'project' ? modal.project ? 'Project settings' : 'Add a project' : modal.kind === 'folder' ? 'Create a disk folder' : modal.kind === 'chat' ? 'Chat settings' : modal.kind === 'attachment' ? modal.item.name : modal.name} close={() => setModal(null)} wide={modal.kind === 'settings' || modal.kind === 'attachment' || modal.kind === 'file' || modal.kind==='pdf'}>
      {modal.kind === 'settings' && <SettingsPanel state={state} action={action} notify={notify} />}
      {modal.kind === 'project' && <ProjectForm project={modal.project} action={action} close={() => setModal(null)} />}
      {modal.kind === 'folder' && <FolderForm modal={modal} action={action} chat={state.chats.find(c => c.projectId === modal.project.id)} close={() => { setModal(null); void browseFiles(modal.project, modal.path); }} />}
      {modal.kind === 'chat' && <ChatForm chat={modal.chat} state={state} action={action} close={() => setModal(null)} />}
      {modal.kind === 'pdf' && <PDFPreview source={modal.source} onAsk={ask} close={()=>setModal(null)} />}
      {modal.kind === 'file' && <pre className="file-preview">{modal.text}</pre>}
      {modal.kind === 'attachment' && (/\.pdf$/i.test(modal.item.name)||modal.item.mime==='application/pdf' ? <PDFPreview source={{id:modal.item.id,chatId:modal.item.chatId}} onAsk={ask} close={()=>setModal(null)} /> : <AttachmentPreview item={modal.item} />)}
    </Modal>}
    {auth && <Modal title="Connect your account" close={() => setAuth(undefined)}><p>{auth.message}</p>{auth.url && <button className="primary" onClick={() => { void api.openExternal(auth.url).catch(e => setError(err(e))); }}><ExternalLink size={15} />Continue in browser</button>}{auth.id && <AuthReply id={auth.id} action={action} close={() => setAuth(undefined)} />}</Modal>}
    <input ref={fileInput} type="file" multiple hidden onChange={e => { void upload([...e.target.files || []]); e.target.value = ''; }} />
  </div>;
}

function ProjectForm({ project, action, close }: { project?: Project; action: Action; close: () => void }) {
  const [name, setName] = useState(project?.name || ''), [path, setPath] = useState(project?.path || ''), [instructions, setInstructions] = useState(project?.instructions || ''), [error, setError] = useState('');
  return <form onSubmit={async e => { e.preventDefault(); try { const p = project || await action('createProject', { name: name || path.split(/[\\/]/).at(-1), path }); await action('updateProject', { id: p.id, name: name || p.name, instructions }); close(); } catch (e) { setError(err(e)); } }}><p className="form-intro">Keep related chats together and give the assistant access to a real folder.</p><label>Project name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Learning lab" required /></label><label>Folder on this device<div className="path-picker"><input value={path} readOnly placeholder="Choose a folder" /><button type="button" disabled={!!project} onClick={async () => { const chosen = await api.chooseProject(); if (chosen) { setPath(chosen); if (!name) setName(chosen.split(/[\\/]/).at(-1) || 'Project'); } }}>Browse</button></div></label><label>Project instructions <small>optional</small><textarea rows={4} placeholder="Context to use in every chat in this project…" value={instructions} onChange={e => setInstructions(e.target.value)} /></label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={!path}>{project ? 'Save project' : 'Add project'}</button></div></form>;
}
function FolderForm({ modal, chat, action, close }: { modal: Extract<ModalState, { kind: 'folder' }>; chat?: Chat; action: Action; close: () => void }) {
  const [name, setName] = useState(''), [error, setError] = useState('');
  return <form onSubmit={async e => { e.preventDefault(); try { let c = chat; if (!c) c = await action('newChat', { projectId: modal.project.id }); await action('createFolder', { projectId: modal.project.id, chatId: c?.id, kind: 'disk', name, parent: modal.path }); close(); } catch (e) { setError(err(e)); } }}><p className="form-intro">{`Create a real folder in ${modal.project.name}${modal.path ? '/' + modal.path : ''}.`}</p><label>Folder name<input value={name} onChange={e => setName(e.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Create folder</button></div></form>;
}
function ChatForm({ chat, state, action, close }: { chat: Chat; state: PublicState; action: Action; close: () => void }) {
  const [title, setTitle] = useState(chat.title), [projectId, setProjectId] = useState(chat.projectId || ''), [error, setError] = useState('');
  const busy = state.runs.some(r => r.chatId === chat.id && r.busy);
  return <form onSubmit={async e => { e.preventDefault(); try { await action('updateChat', { id: chat.id, title, ...(busy ? {} : { projectId }) }); close(); } catch (e) { setError(err(e)); } }}><label>Chat name<input value={title} onChange={e => setTitle(e.target.value)} required /></label><label>Project<select value={projectId} disabled={busy} onChange={e => { setProjectId(e.target.value); }}><option value="">Free chat</option>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{busy && <small className="muted">Stop or finish the response to move this chat.</small>}<div className="chat-actions"><button type="button" onClick={() => { void action('updateChat', { id: chat.id, pinned: !chat.pinned }).then(close).catch(() => {}); }}><Pin size={15} />{chat.pinned ? 'Unpin' : 'Pin chat'}</button><button className="danger" type="button" onClick={() => { if (confirm('Delete this chat, its canvases, and saved attachment references?')) void action('deleteChat', { id: chat.id }).then(close).catch(() => {}); }}><Trash2 size={15} />Delete chat</button></div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Save</button></div></form>;
}
function PDFPreview({ source, onAsk, close }: { source: Source; onAsk: (text:string)=>void; close:()=>void }) {
  const [page,setPage]=useState(source.page||1),[total,setTotal]=useState<number>(),[mode,setMode]=useState<'render'|'text'|'tables'>('render'),[result,setResult]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;void api.call('pdfPreview',{...source,mode:'info'}).then(r=>{if(active)setTotal(r.total);}).catch(()=>{});return()=>{active=false;};},[source.id,source.path]);
  useEffect(()=>{let active=true;setBusy(true);setError('');setResult(undefined);void api.call('pdfPreview',{...source,page,mode}).then(r=>{if(active){setResult(r);setTotal(r.total);}}).catch(e=>{if(active)setError(err(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[source.id,source.path,page,mode]);
  return <div className="pdf-preview"><div className="pdf-controls"><button aria-label="Previous PDF page" title={busy ? 'Reading this page…' : page<=1 ? 'You are on the first page' : 'Previous page'} disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>←</button><label>PDF page <input aria-label="PDF page" type="number" min="1" max={total} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>0&&(!total||n<=total))setPage(n);}} /></label><span>of {total||'…'}</span><button aria-label="Next PDF page" title={busy ? 'Reading this page…' : total && page>=total ? 'You are on the last page' : 'Next page'} disabled={busy||!!total&&page>=total} onClick={()=>setPage(p=>p+1)}>→</button><select aria-label="PDF view" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="render">Page image</option><option value="text">Extracted text</option><option value="tables">Tables</option></select></div><div className="pdf-page">{busy?<p><LoaderCircle size={16} className="spin" /> Reading this page…</p>:error?<p role="alert">{error}</p>:mode==='render'?result?.pages[0]?<img src={result.pages[0].dataUrl} alt={`PDF page ${page}`} />:<p>Page not found.</p>:mode==='text'?<pre>{result?.pages[0]?.text||'No extractable text on this page. Use the page image to inspect a scan.'}</pre>:<pre>{JSON.stringify(result?.pages,null,2)}</pre>}</div><button className="small-button" onClick={()=>{onAsk(`Teach me the ideas on physical PDF page ${page} of ${source.path||'attachment '+source.id}.`);close();}}><Sparkles size={14} />Explain this page</button></div>;
}
function AttachmentPreview({ item }: { item: Attachment }) {
  const [text, setText] = useState<string>();
  useEffect(() => { if (item.mime.startsWith('text/') && item.size < 256000) void fetch(attachmentURL(item)).then(r => r.text()).then(setText).catch(() => {}); }, [item.id]);
  return <div className="attachment-preview">{item.mime.startsWith('image/') && item.mime !== 'image/svg+xml' ? <img src={attachmentURL(item)} alt={item.name} /> : text !== undefined ? <pre>{text}</pre> : <div className="binary-preview"><File size={50} /><p>{item.name}</p><small>{item.mime} · {size(item.size)}</small></div>}<button className="small-button" onClick={() => { void api.openPath(item.path); }}><ExternalLink size={14} />Open file</button></div>;
}
function SettingsPanel({ state, action, notify }: { state: PublicState; action: Action; notify: (s: string) => void }) {
  const [tab, setTab] = useState('accounts'), [keys, setKeys] = useState<Record<string, string>>({}), [busy, setBusy] = useState<string>(), [error, setError] = useState(''), [prompt, setPrompt] = useState(''), [custom, setCustom] = useState(state.settings.customPrompt);
  useEffect(() => { void api.call<string>('systemPrompt').then(setPrompt); }, []);
  const connect = async (id: string, existing = false) => { setBusy(id); setError(''); try { await action('connect', { provider: id, existing, key: keys[id] }); setKeys(k => ({ ...k, [id]: '' })); notify('Connection saved.'); } catch (e) { setError(err(e)); } finally { setBusy(undefined); } };
  return <div className="settings-panel"><div className="settings-tabs">{[['accounts','Accounts'],['judge','Quiz feedback'],['behavior','Assistant'],['appearance','Appearance']].map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'accounts' && <><p className="form-intro">Use your subscription through Pi or the provider’s official runtime.</p><button className="small-button" disabled={!!busy} onClick={async()=>{setBusy('import');try{const r=await action('importAutoum');notify(r.imported.length?'Imported Autoum connections: '+r.imported.join(', '):'Compatible connections are already saved, or none were found.');}catch(e){setError(err(e));}finally{setBusy(undefined);}}}>{busy === 'import' ? 'Importing…' : 'Import connections from Autoum'}</button>{state.providers.map(p => <div className="account-card" key={p.id}><div className="account-heading"><strong>{p.name}</strong><span className={`account-status ${p.configured ? 'on' : ''}`}>{['claude-code','gemini-cli'].includes(p.id) ? p.available ? 'Runtime found' : 'Setup needed' : p.configured ? 'Connected' : 'Not connected'}</span></div><small>{p.detail}</small>{p.id === 'openai-codex' ? <div className="account-actions"><button disabled={!!busy} onClick={() => { void connect(p.id, true); }}>Use existing Codex sign-in</button><button disabled={!!busy} onClick={() => { void connect(p.id); }}>{busy === p.id ? 'Connecting…' : 'Sign in with ChatGPT'}</button>{p.configured && <button onClick={() => { void action('disconnect', { provider: p.id }).catch(() => {}); }}>Disconnect</button>}</div> : p.id === 'opencode-go' ? <><label className="key-field"><input type="password" autoComplete="off" placeholder="OpenCode Go key" value={keys[p.id] || ''} onChange={e => setKeys(k => ({ ...k, [p.id]: e.target.value }))} /><button title={busy ? 'Wait for the current connection action' : !keys[p.id] ? 'Enter your OpenCode Go key to connect' : 'Connect OpenCode Go'} disabled={!!busy || !keys[p.id]} onClick={() => { void connect(p.id); }}>{busy === p.id ? 'Saving…' : 'Connect'}</button></label>{p.configured && <button className="text-button" onClick={() => { void action('disconnect', { provider: p.id }).catch(() => {}); }}>Disconnect</button>}</> : <div className="account-actions"><button onClick={() => { void api.openExternal(p.id === 'claude-code' ? 'https://code.claude.com/docs/en/setup' : 'https://geminicli.com/docs/get-started/authentication/'); }}>Setup & sign-in guide<ExternalLink size={12} /></button><button onClick={() => { void action('refreshAccounts'); }}>Refresh</button></div>}</div>)}</>}
    {tab === 'judge' && <><p className="form-intro">Jev checks the meaning of an explanation against the canvas rubric. Exact answers and interactive quizzes are checked directly in the canvas.</p><label>Feedback provider<select value={state.settings.judge} onChange={e => { void action('settings', { judge: e.target.value, judgeModel: '' }); }}>{state.judges.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>{state.judges.filter(j => j.id === state.settings.judge).map(j => <div className="account-card" key={j.id}><div className="account-heading"><strong>{j.name}</strong><span className={`account-status ${j.configured ? 'on' : ''}`}>{j.configured ? 'Connected' : 'Not connected'}</span></div><label className="key-field"><input type="password" autoComplete="off" value={keys[j.id] || ''} placeholder={`${j.name} API key`} onChange={e => setKeys(k => ({ ...k, [j.id]: e.target.value }))} /><button title={busy ? 'Wait for the current connection action' : !keys[j.id] ? 'Enter an API key to connect' : 'Connect feedback provider'} disabled={!!busy || !keys[j.id]} onClick={() => { void connect(j.id); }}>Connect</button></label><label>Jev model<select value={state.settings.judgeModel || 'jev-1.13-free'} onChange={e => { void action('settings', { judgeModel: e.target.value }); }}>{!j.models.some(m=>m.id===(state.settings.judgeModel||'jev-1.13-free'))&&<option value={state.settings.judgeModel||'jev-1.13-free'}>{state.settings.judgeModel||'Jev 1.13 Free'} · unavailable</option>}{j.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{j.configured && <button className="text-button" onClick={() => { void action('disconnect', { provider: j.id }); }}>Disconnect</button>}</div>)}<small className="muted">Default: Jev 1.13 Free through OpenCode Zen. Zen uses a separate key from Go. Other model choices can use API credits.</small></>}
    {tab === 'behavior' && <><p className="form-intro">The assistant has full creative freedom within the HTML canvas. Its prompt favors useful interaction, clear explanations, and diagrams with a clear purpose.</p><label>Additional instructions<textarea rows={4} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Add your preferences…" /></label><button className="primary" onClick={() => { void action('settings', { customPrompt: custom }).then(() => notify('Instructions saved.')).catch(() => {}); }}>Save instructions</button><details className="system-prompt"><summary>Read the full system prompt</summary><pre>{prompt}</pre></details></>}
    {tab === 'appearance' && <><p className="form-intro">Choose the appearance of your workspace.</p><div className="theme-options">{[['light',Sun,'Light'],['dark',Moon,'Dark'],['system',Monitor,'System']].map(([id,Icon,label]) => <button key={id as string} className={state.settings.theme === id ? 'active' : ''} aria-pressed={state.settings.theme === id} onClick={() => { void action('settings', { theme: id }); }}>{React.createElement(Icon as typeof Sun, { size: 22 })}{label as string}{state.settings.theme === id && <Check size={13} />}</button>)}</div><label>Text size<select aria-label="Text size" value={readingSize(state.settings.fontSize)} onChange={e=>{void action('settings',{fontSize:Number(e.target.value)});}}>{Array.from({length:13},(_,i)=>i+12).map(size=><option key={size} value={size}>{size} px{size===18?' · default':''}</option>)}</select><small>Chat and lessons use the same font and size.</small></label><p className="reading-preview">A short reading sample at your selected text size.</p></>}
    {error && <p className="form-error">{error}</p>}
  </div>;
}
function AuthReply({ id, action, close }: { id: string; action: Action; close: () => void }) {
  const [value, setValue] = useState('');
  return <form onSubmit={e => { e.preventDefault(); void action('authReply', { id, value }).then(close).catch(() => {}); }}><label>Code or redirect URL<input value={value} onChange={e => setValue(e.target.value)} autoComplete="off" /></label><button className="primary">Continue</button></form>;
}
createRoot(document.getElementById('root')!).render(<App />);
