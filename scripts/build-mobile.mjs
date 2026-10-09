import {build} from 'esbuild';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const out='mobile/www';await mkdir(out,{recursive:true});
await Promise.all([
 build({entryPoints:['mobile/src/app.tsx'],outfile:out+'/app.js',bundle:true,platform:'browser',format:'iife',target:'chrome110',minify:true,jsx:'automatic',external:['fonts/*'],loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'fonts/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'}}),
 build({entryPoints:['src/canvas-toolkit.ts'],outfile:out+'/canvas-toolkit.js',bundle:true,platform:'browser',format:'iife',target:'chrome110',minify:true}),
 build({entryPoints:['src/canvas-preview.ts'],outfile:out+'/canvas-preview.js',bundle:true,platform:'browser',format:'iife',target:'chrome110',minify:true})
]);
await cp('node_modules/katex/dist/fonts',out+'/fonts',{recursive:true});
for(const name of ['cmu-serif-500-roman','cmu-serif-500-italic','cmu-serif-700-roman','cmu-serif-700-italic'])await cp('node_modules/computer-modern/fonts/'+name+'.woff2',out+'/fonts/'+name+'.woff2');
const reading=await readFile('src/reading-font.css','utf8');await writeFile(out+'/canvas-toolkit.css',(await readFile('node_modules/katex/dist/katex.min.css','utf8'))+'\n'+reading);
await cp('assets/logo.svg',out+'/logo.svg');await cp('node_modules/computer-modern/OFL.txt',out+'/Computer-Modern-OFL.txt');
const notices=['LICENSE','THIRD_PARTY_NOTICES.md','node_modules/react/LICENSE','node_modules/react-dom/LICENSE','node_modules/katex/LICENSE','node_modules/marked/LICENSE','node_modules/dompurify/LICENSE','node_modules/dompurify/LICENSE-MPL','node_modules/chart.js/LICENSE.md','node_modules/lucide-react/LICENSE','mobile/Apache-2.0.txt'];
await writeFile(out+'/Third-Party-Notices.txt',(await Promise.all(notices.map(async path=>'\n--- '+path+' ---\n'+await readFile(path,'utf8')))).join('\n'));
await writeFile(out+'/index.html',`<!doctype html><html data-theme="system"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-src https://lessons.loom.local; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Loom</title><link rel="preload" href="fonts/cmu-serif-500-roman.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
console.log('Loom Android assets built.');
