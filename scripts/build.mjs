import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);const dist=join(root,'dist');await mkdir(dist,{recursive:true});
await Promise.all([
  build({entryPoints:['src/main.ts'],outfile:'dist/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node24',sourcemap:true}),
  build({entryPoints:['src/preload.ts'],outfile:'dist/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node24'}),
  build({entryPoints:['src/worker.ts'],outfile:'dist/worker.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24',sourcemap:true}),
  build({entryPoints:['src/engine.ts'],outfile:'dist/engine.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24',sourcemap:true}),
  build({entryPoints:['src/companion.ts'],outfile:'dist/companion.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'}),
  build({entryPoints:['src/pdf-worker.ts'],outfile:'dist/pdf-worker.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'}),
  build({entryPoints:['src/mcp.ts'],outfile:'dist/mcp.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',target:'node24'}),
  build({entryPoints:['src/ui.tsx'],outfile:'dist/ui.js',bundle:true,platform:'browser',format:'iife',target:'chrome140',minify:true,jsx:'automatic',loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'fonts/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'},sourcemap:true}),
  build({entryPoints:['src/canvas-preview.ts'],outfile:'dist/canvas-preview.js',bundle:true,platform:'browser',format:'iife',target:'chrome140',minify:true}),
  build({entryPoints:['src/canvas-toolkit.ts'],outfile:'dist/canvas-toolkit.js',bundle:true,platform:'browser',format:'iife',target:'chrome140',minify:true}),
]);
const readingCSS=await readFile(join(root,'src/reading-font.css'),'utf8');
await writeFile(join(dist,'reading-font.css'),readingCSS);
await writeFile(join(dist,'canvas-toolkit.css'),await readFile(join(root,'node_modules/katex/dist/katex.min.css'),'utf8')+'\n'+readingCSS);await cp(join(root,'node_modules/katex/dist/fonts'),join(dist,'fonts'),{recursive:true});
for(const name of ['cmu-serif-500-roman','cmu-serif-500-italic','cmu-serif-700-roman','cmu-serif-700-italic'])await cp(join(root,'node_modules/computer-modern/fonts',name+'.woff2'),join(dist,'fonts',name+'.woff2'));
await cp(join(root,'node_modules/computer-modern/OFL.txt'),join(dist,'Computer-Modern-OFL.txt'));
await cp(join(root,'assets/logo.svg'),join(dist,'logo.svg'));
await cp(join(root,'assets/logo.png'),join(dist,'logo.png'));
await writeFile(join(dist,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loom</title><link rel="preload" href="fonts/cmu-serif-500-roman.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="reading-font.css"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
console.log('Loom built.');
