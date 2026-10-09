import DOMPurify from 'dompurify';
import {CANVAS_THEME_CSS,readingSize} from './canvas-theme.ts';
const token=(window as any).__loomPreviewToken;
let pending:string|undefined,frame=0;
function update(){
  frame=0;if(pending===undefined)return;const html=pending;pending=undefined;
  const parsed=DOMPurify.sanitize(html,{RETURN_DOM_FRAGMENT:true,FORCE_BODY:true,ADD_TAGS:['style'],ADD_ATTR:['data-math','data-display'],FORBID_TAGS:['script','iframe','object','embed','link','meta','base','form','audio','video'],FORBID_ATTR:['autofocus'],ALLOW_DATA_ATTR:true});
  const root=document.getElementById('loom-preview-content')!;
  // Retain unchanged blocks rather than reloading the iframe for every chunk.
  const next=[...parsed.childNodes],old=[...root.childNodes];
  for(let i=0;i<next.length;i++){if(old[i]?.isEqualNode(next[i]))continue;if(old[i])old[i].replaceWith(next[i]);else root.append(next[i]);}
  for(let i=next.length;i<old.length;i++)old[i].remove();
  (window as any).Studio?.renderMath?.();(window as any).Studio?.resize?.();
}
addEventListener('message',event=>{const d=event.data;if(event.source!==parent||d?.channel!=='loom-preview'||d.token!==token)return;
  if(d.type==='appearance'){document.documentElement.dataset.theme=d.theme;document.documentElement.style.setProperty('--loom-font-size',readingSize(d.fontSize)+'px');return;}
  if(d.type==='html'&&typeof d.html==='string'&&d.html.length<=2_000_000){pending=d.html;if(!frame)frame=requestAnimationFrame(update);}
});
addEventListener('DOMContentLoaded',()=>{const tail=document.createElement('style');tail.textContent=CANVAS_THEME_CSS+'#loom-preview-content{pointer-events:none}#loom-preview-content *{animation:none!important;transition:none!important}';document.body.append(tail);new ResizeObserver(()=>(window as any).Studio?.resize?.()).observe(document.body);});
