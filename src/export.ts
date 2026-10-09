import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Canvas } from './shared.ts';
import {canvasContent} from './canvas-content.ts';
import {canvasTheme,type CanvasAppearance} from './canvas-theme.ts';

export async function exportStandalone(canvas: Canvas, destination: string, assets: string,appearance:CanvasAppearance={}) {
  const [js,rawCSS] = await Promise.all([readFile(join(assets,'canvas-toolkit.js'),'utf8'),readFile(join(assets,'canvas-toolkit.css'),'utf8')]);
  const fonts = [...new Set([...rawCSS.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m=>m[1]))];
  let css = rawCSS;
  for (const font of fonts) { const bytes=await readFile(join(assets,font));const mime=font.endsWith('.woff2')?'font/woff2':font.endsWith('.woff')?'font/woff':'font/ttf';css=css.replaceAll(font,`data:${mime};base64,${bytes.toString('base64')}`); }
  const state=JSON.stringify(canvas.state??null).replaceAll('<','\\u003c');
  const bootstrap=`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}</style><script>window.Studio={state:${state},quizAnswers:${JSON.stringify(canvas.quizAnswers||{}).replaceAll('<','\\u003c')},saveQuizAnswer(key,answer){this.quizAnswers={...this.quizAnswers,[key]:answer};try{localStorage.setItem('loom-quiz-${canvas.id}',JSON.stringify(this.quizAnswers))}catch{}},rubric:${JSON.stringify(canvas.rubric).replaceAll('<','\\u003c')},saveState(value){this.state=JSON.parse(JSON.stringify(value));try{localStorage.setItem('loom-${canvas.id}',JSON.stringify(value))}catch{}},ask(text){alert(text+'\\n\\nOpen Loom to continue the conversation.')},openSource(){alert('Open this canvas in Loom to view its source PDF.')},cancelCheck(){},check(){return Promise.reject(Error('Open this canvas in Loom to use Jev feedback.'))},resize(){}};try{const saved=localStorage.getItem('loom-${canvas.id}');if(saved)Studio.state=JSON.parse(saved);const quiz=localStorage.getItem('loom-quiz-${canvas.id}');if(quiz)Studio.quizAnswers=JSON.parse(quiz)}catch{}</script><script>${js.replace(/<\/script/gi,'<\\/script')}</script>`;
  // Authors can read the shared palette and call Studio.renderMath while parsing.
  // Initialize Studio before the toolkit, just as the embedded canvas does.
  const content=canvasContent(canvas.html);
  await writeFile(destination,'<!doctype html><html><head>'+canvasTheme(appearance)+bootstrap+'</head><body>'+content+canvasTheme(appearance)+'</body></html>');
}
