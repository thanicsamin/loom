import { _electron as electron, type Page, type Locator } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { pdfFixture } from './fixtures.ts';

// Measure the actual rendered colors, including ancestor backgrounds, alpha,
// disabled controls, placeholders, selection, and open picker options.
async function audit(page: Page, context: string) {
  const failures = await page.evaluate<string[]>(`(() => {
    const failures = [];
    const canvas = document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const cache=new Map();
    function rgba(color) {
      if(!cache.has(color)){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);cache.set(color,[...ctx.getImageData(0,0,1,1).data].map(v=>v/255));}
      return cache.get(color);
    }
    function over(front,back){return front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3])).concat(1);}
    function background(el) {
      const layers=[];
      for(let node=el;node;node=node.parentElement){const c=rgba(getComputedStyle(node).backgroundColor);layers.unshift(c);if(c[3]===1)break;}
      return layers.reduce((back,front)=>over(front,back),[1,1,1,1]);
    }
    function luminance(color) {const c=color.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
    function check(el,label,pseudo) {
      const style=getComputedStyle(el,pseudo);
      let opacity=Number(style.opacity);
      if(!pseudo)for(let parent=el.parentElement;parent;parent=parent.parentElement)opacity*=Number(getComputedStyle(parent).opacity);
      const bg=pseudo?over(rgba(style.backgroundColor),background(el)):background(el);
      const fg=rgba(style.color).slice();fg[3]*=opacity;
      const a=luminance(over(fg,bg)),b=luminance(bg);
      const contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      if(contrast<4.5)failures.push(label+': '+contrast.toFixed(2)+':1 ('+style.color+' on '+style.backgroundColor+')');
    }
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let text;
    while((text=walker.nextNode())){
      const el=text.parentElement;if(!el||!text.textContent?.trim()||el.closest('script,style,svg,option'))continue;
      const range=document.createRange();range.selectNodeContents(text);
      const rect=range.getBoundingClientRect(),style=getComputedStyle(el);
      if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight||style.visibility==='hidden')continue;
      check(el,el.tagName.toLowerCase()+': '+text.textContent.trim().slice(0,55));
    }
    for(const el of document.querySelectorAll('input,textarea,select')){
      if(!el.getBoundingClientRect().width)continue;
      check(el,el.tagName.toLowerCase()+': '+(el.getAttribute('aria-label')||''));
      if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){if(el.placeholder)check(el,'placeholder: '+el.placeholder,'::placeholder');}
      if(el instanceof HTMLSelectElement)for(const option of el.options)check(option,'option: '+option.text);
    }
    check(document.querySelector('.markdown')||document.body,'selected text','::selection');
    return failures;
  })()`);
  assert.deepEqual(failures,[],context+' contrast');
}

let interactionChecks=0;
async function appearance(control:Locator) {
  return control.evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,color:s.color,border:s.borderColor,cursor:s.cursor};});
}
async function feedback(page:Page,control:Locator,context:string) {
  await page.mouse.move(1,1);await page.waitForTimeout(150);
  const rest=await appearance(control),box=await control.boundingBox();
  await control.hover();await page.waitForTimeout(150);const hover=await appearance(control);
  if(await control.isDisabled()) {
    assert.deepEqual(hover,rest,context+' disabled appearance stays stable');
    assert.equal(hover.cursor,'not-allowed',context+' disabled cursor');
  } else {
    assert.notEqual(hover.background,rest.background,context+' visible hover');
    assert.equal(hover.cursor,'pointer',context+' action cursor');await audit(page,context+' hover');
    await page.mouse.down();
    try {assert.notEqual((await appearance(control)).background,hover.background,context+' visible press');await audit(page,context+' pressed');}
    finally {await page.mouse.move(1,1);await page.mouse.up();}
    // Pressing the pointer then releasing away must not execute the action.
    assert.deepEqual(await control.boundingBox(),box,context+' no layout movement');
    await page.keyboard.press('Tab');
    for(let i=0;i<80&&!await control.evaluate(el=>el===document.activeElement);i++)await page.keyboard.press('Tab');
    const focus=await control.evaluate(el=>({visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle,pixels:parseFloat(getComputedStyle(el).outlineWidth)*devicePixelRatio}));
    assert(focus.visible&&focus.outline==='solid'&&focus.pixels>=1.9,context+' keyboard ring: '+JSON.stringify(focus));
  }
  await page.mouse.move(1,1);
  interactionChecks++;
}

const data=await mkdtemp(join(tmpdir(),'loom-contrast-'));
const projectPath=join(data,'books');await mkdir(projectPath);await mkdir('test-results',{recursive:true});
await writeFile(join(projectPath,'paper.pdf'),pdfFixture());
const store=new Store(data);await store.init();const project=await store.createProject('Books',projectPath);
const chat=await store.newChat({projectId:project.id});
chat.messages.push({id:randomUUID(),role:'user',text:'Read this source with me.',at:Date.now()});
chat.messages.push({id:randomUUID(),role:'assistant',text:'A readable explanation, with **important text**, `code`, and a [source](https://example.com).\n\n> A quoted observation.',at:Date.now()});
await store.commit();
const env=Object.fromEntries(Object.entries({...process.env,STUDIO_DATA_DIR:data}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&entry[0]!=='ELECTRON_RUN_AS_NODE'));
const app=await electron.launch({executablePath:process.env.ELECTRON_PATH||'node_modules/electron/dist/electron',args:['.','--no-sandbox','--ozone-platform=x11'],env});
const checks:string[]=[];
try {
  const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.app').waitFor();await page.evaluate(()=>window.studio.call('refreshAccounts'));
  for(const [theme,os,label] of [['dark','light','dark'],['light','dark','light'],['system','dark','system-dark'],['system','light','system-light']] as const){
    await page.emulateMedia({colorScheme:os});await page.evaluate(theme=>window.studio.call('settings',{theme}),theme);
    await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await page.waitForTimeout(180);
    const books=page.getByRole('button',{name:'Books',exact:true});
    if(await books.getAttribute('aria-expanded')!=='true')await books.click();
    await audit(page,label+' chat');
    for(const [name,control] of [
      ['new chat',page.getByRole('button',{name:'New chat',exact:false}).first()],
      ['project',books],['selected chat',page.locator('.chat-row.selected>button').first()],
      ['sidebar settings',page.getByRole('button',{name:'Settings & connections',exact:true})],
      ['account indicator',page.getByRole('button',{name:'Account connection',exact:true})],
      ['attachment',page.getByRole('button',{name:'Attach files',exact:true})],
      ['empty send',page.getByRole('button',{name:'Send',exact:true})],
    ] as const)await feedback(page,control,label+' '+name);
    const statusBox=await page.getByRole('button',{name:'Account connection',exact:true}).boundingBox();assert(statusBox&&statusBox.width>=24&&statusBox.height>=24,'Account indicator has a usable target');
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('Unsent test draft');
    await feedback(page,page.getByRole('button',{name:'Send',exact:true}),label+' primary send');
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('');
    for(const name of ['Chat provider','Chat model','Response speed']){
      const select=page.getByRole('combobox',{name,exact:true});await select.click();
      await select.locator('option').first().waitFor({state:'visible'});
      await audit(page,label+' '+name);
      if(name==='Chat model')await page.screenshot({path:`test-results/contrast-${label}-models.png`});
      await page.keyboard.press('Escape');
    }
    const model=page.getByRole('combobox',{name:'Chat model',exact:true});const original=await model.inputValue();
    await model.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(original=>document.querySelector<HTMLSelectElement>('select[aria-label="Chat model"]')?.value!==original,original);await model.selectOption(original);
    await page.getByRole('button',{name:'Settings & connections'}).click();await audit(page,label+' accounts');
    await feedback(page,page.getByRole('button',{name:'Import connections from Autoum',exact:true}),label+' account action');
    await feedback(page,page.getByRole('button',{name:'Connect',exact:true}),label+' disabled connect');
    await feedback(page,page.getByRole('button',{name:'Close',exact:true}),label+' dialog close');
    await page.getByRole('button',{name:'Quiz feedback',exact:true}).click();
    for(const name of ['Feedback provider','Jev model']){
      const select=page.getByRole('combobox',{name,exact:true});await select.click();await select.locator('option').first().waitFor({state:'visible'});await audit(page,label+' '+name);await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'Assistant',exact:true}).click();await audit(page,label+' instructions');
    await page.getByRole('button',{name:'Appearance',exact:true}).click();await audit(page,label+' appearance');
    await feedback(page,page.getByRole('button',{name:'Appearance',exact:true}),label+' selected settings tab');
    for(const name of ['Light','Dark','System'])await feedback(page,page.getByRole('button',{name,exact:true}),label+' '+name+' appearance option');
    await page.getByRole('button',{name:'Phone',exact:true}).click();await page.getByRole('button',{name:'Enable phone connection',exact:true}).waitFor({state:'visible'});await audit(page,label+' phone connection');
    await feedback(page,page.getByRole('button',{name:'Enable phone connection',exact:true}),label+' phone action');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add project',exact:true}).click();await audit(page,label+' project form');
    await feedback(page,page.getByRole('dialog').getByRole('button',{name:'Add project',exact:true}),label+' disabled primary action');
    await feedback(page,page.getByRole('button',{name:'Cancel',exact:true}),label+' form cancel');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Manage New chat',exact:true}).click();
    const select=page.getByRole('combobox',{name:'Project',exact:true});await select.click();await select.locator('option').first().waitFor({state:'visible'});await audit(page,label+' projects');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(chatId=>window.studio.call('saveDraft',{chatId,text:''}),chat.id);
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('');
    checks.push(label+' readable menus/text, hover/pressed/focus/disabled states, stable layout, keyboard selection, and Escape');console.log('PASS',checks.at(-1));
  }
  await page.evaluate(()=>window.studio.call('settings',{theme:'dark'}));
  await page.getByRole('button',{name:'Files in Books',exact:true}).click();await page.getByRole('button',{name:'paper.pdf',exact:true}).click();await page.locator('.pdf-page img').waitFor();
  await page.getByRole('combobox',{name:'PDF view'}).click();await page.getByRole('option',{name:'Extracted text',exact:true}).waitFor();await audit(page,'dark PDF reader');await page.keyboard.press('Escape');
  await feedback(page,page.getByRole('button',{name:'Previous PDF page',exact:true}),'PDF first-page control');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.getByRole('button',{name:'Explain this page',exact:true}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s','Reduced motion removes transitions');
  checks.push('PDF menu and disabled page controls');assert.deepEqual(errors,[]);
  await writeFile('test-results/contrast-report.json',JSON.stringify({checks,controlsChecked:interactionChecks,minimumTextContrast:4.5,rendererErrors:errors},null,2));
  console.log(checks.length+' contrast checks passed.');
}catch(error){await (await app.firstWindow()).screenshot({path:'test-results/contrast-failure.png'}).catch(()=>{});throw error;}
finally{await app.close();await rm(data,{recursive:true,force:true});}
