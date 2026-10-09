export type ProviderId = 'openai-codex' | 'claude-code' | 'gemini-cli' | 'opencode-go';
export type JudgeId = 'typesafe' | 'openrouter' | 'opencode';
export const DEFAULT_JUDGE_MODEL='jev-1.13-free';
export type Attachment = { id: string; chatId: string; name: string; mime: string; size: number; path: string };
export type Criterion = { id: string; label: string; description: string; hint?: string; misconceptionHint?: string };
export type Canvas = { id: string; chatId: string; title: string; html: string; revision: number; versions: { html: string; title: string; at: number; rubric: Criterion[] }[]; state: unknown; quizAnswers?:Record<string,string>; rubric: Criterion[]; updatedAt: number };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; at: number; attachments?: string[]; canvasIds?: string[]; interrupted?: boolean; steering?: boolean };
export type Chat = { id: string; title: string; projectId?: string; folderId?: string; provider: ProviderId; model: string; thinking?: string; speed?: 'standard'|'fast'|'ultrafast'; messages: Message[]; draft: string; draftAttachments: string[]; updatedAt: number; pinned?: boolean; sessionIds?: Record<string, string> };
export type Project = { id: string; name: string; path: string; instructions: string; createdAt: number };
export type ChatFolder = { id: string; projectId: string; parentId?: string; name: string };
export type Settings = { provider: ProviderId; models: Partial<Record<ProviderId, string>>; thinking?:Record<string,string>; judge: JudgeId; judgeModel: string; theme: 'light' | 'dark' | 'system'; fontSize?:number; customPrompt: string };
export type Database = { version: 1; chats: Chat[]; projects: Project[]; folders: ChatFolder[]; canvases: Canvas[]; attachments: Attachment[]; settings: Settings; activeChatId?: string };
export type ThinkingOption={value:string;label:string;description?:string};
export type ModelInfo={id:string;name:string;vision?:boolean;speeds?:string[];thinking?:ThinkingOption[];defaultThinking?:string};
export type ProviderInfo = { id: ProviderId; name: string; configured: boolean; available: boolean; models: ModelInfo[]; detail?: string };
export type CanvasPreview={id:string;title:string;html:string};
export type RunInfo = { chatId: string; busy: boolean; text: string; activity: string; error?: string; pendingSteers: number; preview?:{id:string;title:string}; canRetry?:boolean };
export type PublicState = Database & { initializing?: boolean; providers: ProviderInfo[]; judges: { id: JudgeId; name: string; configured: boolean; models: { id: string; name: string }[] }[]; runs: RunInfo[] };
export type Grade = { items: { id: string; label: string; status: 'missing' | 'partial' | 'demonstrated' | 'contradicted' | 'uncertain'; hint?: string; confidence: number }[] };
export type StudioEvent = { type: 'state'; state: PublicState } | { type: 'delta'; chatId: string; delta: string } | {type:'canvas-preview';chatId:string;preview:CanvasPreview|null} | { type: 'auth'; provider: string; message: string; url?: string };
export interface StudioAPI {
  call<T = any>(method: string, data?: any): Promise<T>;
  onEvent(callback: (event: StudioEvent) => void): () => void;
  chooseProject(): Promise<string | undefined>;
  pickFiles(chatId: string): Promise<Attachment[]>;
  upload(chatId: string, name: string, mime: string, bytes: ArrayBuffer): Promise<Attachment>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  exportCanvas(id: string): Promise<boolean>;
}
declare global { interface Window { studio: StudioAPI; } }
