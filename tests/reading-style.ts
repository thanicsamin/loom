import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.ts';
const data=await mkdtemp(join(tmpdir(),'loom-reading-'));await mkdir('test-results',{recursive:true});
const store=new Store(data);await store.init();const chat=await store.newChat();chat.messages.push({id:crypto.randomUUID(),role:'assistant',at:Date.now(),text:'A lesson continues in the figures below. The formula is $x^2$.'});
const html=(color:string,size:number)=>`<html><head><style>body{background:${color};color:red;font:${size}px serif}section{background:${color}}.layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}</style></head><body><div class="layout"><section><p id="reading">A shared reading style.</p><p>Inline math: \\(\\frac{1}{2}x^2\\). Display math: \\[\\sum_{k=0}^3 k=6.\\]</p><p id="overescaped">${String.raw`$\\mathbb{R}^2$ and $\\begin{bmatrix}1&amp;2\\\\3&amp;4\\end{bmatrix}$`}</p><div id="feedback"></div><span id="dynamic" data-math="x=1"></span><button id="change">Change x</button><input id="value" aria-label="Saved value" value="1"></section><section><p>The same colors and type.</p></section></div><details><summary>More explanation</summary>${'<p>Additional lesson content. It uses the conversation scrollbar.</p>'.repeat(45)}</details><script>let n=Studio.state?.n||1;document.querySelector('#value').value=n;document.querySelector('#change').onclick=()=>{n++;document.querySelector('#value').value=n;document.querySelector('#dynamic').dataset.math='x='+n;Studio.saveState({n})};</script></body></html>`;
const canvases:{id:string;title:string;revision:number}[]=[];for(const [color,size]of [['#ffee00',22],['#0000ff',11]] as const)canvases.push(await store.publishCanvas(chat.id,{title:'Style '+color,html:html(color,size)}));
chat.messages[0].canvasIds=canvases.map(c=>c.id);await store.commit();
let app:ElectronApplication|undefined,page!:Page;const errors:string[]=[],checks:string[]=[],metrics:any[]=[];
const wait=async(test:()=>Promise<boolean>)=>{const end=Date.now()+15000;while(!await test()){assert(Date.now()<end,'Reading style update timed out');await new Promise(r=>setTimeout(r,50));}};
async function launch(){const env=Object.fromEntries(Object.entries({...process.env,STUDIO_DATA_DIR:data}).filter((x):x is [string,string]=>typeof x[1]==='string'&&x[0]!=='ELECTRON_RUN_AS_NODE'));app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['.','--no-sandbox','--ozone-platform=x11'],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('iframe').first().waitFor();}
try{
  await launch();
  assert.equal(await page.locator('.markdown').first().evaluate(el=>getComputedStyle(el).fontSize),'18px');checks.push('New profiles default to readable 18 px text');
  const frame=(id:string)=>page.frames().find(f=>f.url().startsWith('studio://canvas/'+id+'?'))!;
  await wait(async()=>frame(canvases[0].id)&&await frame(canvases[0].id).locator('.katex').count()>=3);
  await wait(async()=>frame(canvases[0].id).evaluate(()=>document.fonts.check('16px "CMU Serif"')));assert.match(await frame(canvases[0].id).evaluate(()=>getComputedStyle(document.body).fontFamily),/CMU Serif/);checks.push('Bundled Computer Modern Unicode loads locally for the chat and canvas');
  await frame(canvases[0].id).getByRole('button',{name:'Change x'}).click();await wait(async()=>await frame(canvases[0].id).locator('#dynamic .katex').count()===1&&/2/.test(await frame(canvases[0].id).locator('#dynamic').innerText()));
  await wait(async()=>await frame(canvases[0].id).locator('#overescaped .katex').count()===2);assert.equal(await frame(canvases[0].id).locator('#overescaped .katex-error').count(),0);assert.match((await frame(canvases[0].id).locator('#overescaped annotation').first().textContent())||'',/\\mathbb/);
  await frame(canvases[0].id).evaluate(()=>{(window as any).Studio.feedback('#feedback',{items:[{id:'idea',label:'The mechanism',status:'partial',hint:'Consider what changes along this edge.'}]})});
  await frame(canvases[0].id).getByLabel('The mechanism: Add more detail. Show hint').click();assert(await frame(canvases[0].id).getByText('Consider what changes along this edge.').isVisible());await frame(canvases[0].id).getByLabel('The mechanism: Add more detail. Show hint').press('Escape');assert(!await frame(canvases[0].id).getByText('Consider what changes along this edge.').isVisible());checks.push('Overescaped real-space and matrix formulas normalize; feedback hints work with mouse and keyboard');
  checks.push('Automatic inline, display, and changing declarative LaTeX render without author setup');
  await page.getByRole('button',{name:'Settings & connections',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  for(const theme of ['Light','Dark','System']){
    for(const scheme of theme==='System'?['light','dark'] as const:['light'] as const){
      await page.emulateMedia({colorScheme:scheme});await page.getByRole('button',{name:theme,exact:true}).click();
      for(const size of [12,16,18,20,24]){
        await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption(String(size));
        await wait(async()=>(await frame(canvases[0].id).evaluate(()=>getComputedStyle(document.body).fontSize))===size+'px');
        const host=await page.evaluate(()=>({size:getComputedStyle(document.querySelector('.markdown')!).fontSize,font:getComputedStyle(document.querySelector('.markdown')!).fontFamily,bg:getComputedStyle(document.body).backgroundColor}));
        for(const c of canvases){const f=frame(c.id),style=await f.evaluate(()=>({size:getComputedStyle(document.querySelector('p')!).fontSize,font:getComputedStyle(document.body).fontFamily,bg:getComputedStyle(document.body).backgroundColor,ink:getComputedStyle(document.querySelector('p')!).color,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,mathErrors:document.querySelectorAll('.katex-error').length}));assert.equal(style.size,size+'px');assert.equal(host.size,style.size);assert.equal(host.font,style.font);assert.equal(host.bg,style.bg);assert(!style.overflow);assert.equal(style.mathErrors,0);metrics.push({theme,scheme,canvas:c.id,...style});}
        assert.equal(await frame(canvases[0].id).locator('#value').inputValue(),'2','Appearance must not reload a lesson or reset the learner');
      }
    }
  }
  checks.push('Two conflicting authored styles share the chat palette and font at 12, 16, 18, 20, and 24 px in all appearances');
  await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption('20');await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  const f=frame(canvases[0].id);await f.getByText('More explanation',{exact:true}).click();
  await wait(async()=>f.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
  const dimensions=await f.evaluate(()=>({height:innerHeight,content:document.body.scrollHeight}));assert(dimensions.height>2000);checks.push('Long and expanded lessons grow past 720 px and have no vertical frame scroll');
  await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(740,900));await wait(async()=>!(await f.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
  await page.screenshot({path:'test-results/reading-narrow.png'});checks.push('Large type reflows at the minimum app width');
  await app!.close();app=undefined;await launch();await wait(async()=>!!frame(canvases[0].id)&&await frame(canvases[0].id).evaluate(()=>!!document.body&&getComputedStyle(document.body).fontSize==='20px'));assert.equal(await frame(canvases[0].id).locator('#value').inputValue(),'2');checks.push('Text size and learner state survive restart');
  assert.deepEqual(errors,[]);await writeFile('test-results/reading-report.json',JSON.stringify({checks,metrics,dimensions,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await app?.close();await rm(data,{recursive:true,force:true});}
