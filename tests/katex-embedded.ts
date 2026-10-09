import {_electron as electron,type ElectronApplication} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.ts';
import {exportStandalone} from '../src/export.ts';
const data=await mkdtemp(join(tmpdir(),'loom-katex-'));
const store=new Store(data);await store.init();const chat=await store.newChat();
const html=await readFile('tests/fixtures/projective-covers.html','utf8');
const canvas=await store.publishCanvas(chat.id,{title:'Projective covers',html});
chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:'Projective covers in the principal block.',canvasIds:[canvas.id],at:Date.now()});store.db.settings.theme='light';await store.commit();
await mkdir('test-results',{recursive:true});let app:ElectronApplication|undefined;
const checks:string[]=[],errors:string[]=[],failures:string[]=[];
const wait=async(f:()=>Promise<boolean>)=>{const end=Date.now()+15000;while(!await f()){assert(Date.now()<end,'Math rendering timed out');await new Promise(r=>setTimeout(r,40));}};
try{
const env=Object.fromEntries(Object.entries({...process.env,STUDIO_DATA_DIR:data}).filter((x):x is [string,string]=>typeof x[1]==='string'&&x[0]!=='ELECTRON_RUN_AS_NODE'));
app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['.','--no-sandbox','--ozone-platform=x11'],env});
const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});page.on('requestfailed',r=>failures.push(r.url()+' '+r.failure()?.errorText));
await page.locator('iframe').waitFor();await wait(async()=>page.frames().some(f=>f.url().startsWith('studio://canvas/')));const f=page.frames().find(f=>f.url().startsWith('studio://canvas/'))!;
await wait(async()=>await f.locator('#content .katex').count()>5);
const initial=await f.locator('.katex').count();assert(initial>40);checks.push('Original lesson formulas and category headings use actual KaTeX');
await f.getByRole('button',{name:/Thick/}).click();await wait(async()=>await f.locator('#heading .katex').count()===1&&await f.locator('#content .katex').count()>5);
assert.equal(await f.locator('.katex-error').count(),0);checks.push('Changing categories typesets dynamically inserted formulas');
await f.locator('#cover').selectOption('-2');await wait(async()=>await f.locator('#diagram foreignObject .katex').count()===3);
await wait(async()=>await f.locator('#example .katex').count()>=2);checks.push('Changing Loewy layers and exact sequences typesets diagram labels and results');
await f.locator('#no').click();await wait(async()=>await f.locator('#result .katex').count()===3);
for(const name of ['How to compute','Two meanings','Exact central'])await f.locator('summary').filter({hasText:name}).click();
await f.evaluate(()=>document.fonts.ready);
const font=await f.locator('.katex .mord.mathnormal').first().evaluate(el=>getComputedStyle(el).fontFamily);
assert(/KaTeX_Math/.test(font),'KaTeX math fonts must be used, not the reading font');
assert.equal(await f.locator('.katex-error').count(),0);
assert.deepEqual(failures,[]);checks.push('Bundled KaTeX CSS and fonts load locally; all revealed formulas parse');
await page.getByRole('button',{name:'Settings & connections',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();
for(const theme of ['Light','Dark'])for(const size of [12,16,20,24]){
 await page.getByRole('button',{name:theme,exact:true}).click();await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption(String(size));
 await wait(async()=>await f.evaluate(()=>getComputedStyle(document.body).fontSize)===size+'px');
 assert.equal(await f.locator('.katex-error').count(),0);assert.equal(await f.locator('#cover').inputValue(),'-2');
 await wait(async()=>await f.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
}
checks.push('Math respects 12, 16, 20, and 24 px in light and dark; lesson state survives');
await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption('16');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
await page.screenshot({path:'test-results/katex-projective-covers.png',fullPage:true});
const exported=resolve('test-results/katex-export.html');await exportStandalone(store.canvas(canvas.id),exported,resolve('dist'),{theme:'light',fontSize:16});
const exportedWindow=app.waitForEvent('window');await app.evaluate(async({BrowserWindow},path)=>{const w=new BrowserWindow({width:1100,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await w.loadFile(path)},exported);const browserPage=await exportedWindow;browserPage.on('pageerror',e=>errors.push(e.message));await wait(async()=>await browserPage.locator('.katex').count()>40);
await browserPage.getByRole('button',{name:/Finite-dimensional modules/}).click();await wait(async()=>await browserPage.locator('#content .katex').count()>5);assert.equal(await browserPage.locator('.katex-error').count(),0);checks.push('Offline export uses the same automatic math renderer');
assert.deepEqual(errors,[]);await writeFile('test-results/katex-report.json',JSON.stringify({checks,initial,font,errors,failures},null,2));console.log(JSON.stringify({checks,initial,font,errors}));
}finally{await app?.close();await rm(data,{recursive:true,force:true});}
