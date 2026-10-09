type Item={id:string;label:string;status:'missing'|'partial'|'demonstrated'|'contradicted'|'uncertain';hint?:string};
type Feedback={items:Item[]}| 'checking' | 'empty' | 'unavailable';
const labels={missing:'Not yet shown',partial:'Add more detail',demonstrated:'Understanding demonstrated',contradicted:'Revisit this idea',uncertain:'Uncertain'};
export function canvasFeedback(target:HTMLElement|string,result:Feedback){
  const el=typeof target==='string'?document.querySelector<HTMLElement>(target):target;if(!el)return;
  const fragment=document.createDocumentFragment(),summary=document.createElement('div');summary.className='loom-feedback-summary';summary.setAttribute('role','status');
  if(typeof result==='string'){summary.textContent={checking:'Checking…',empty:'Feedback appears after you write.',unavailable:'Feedback unavailable. Your answer is still saved.'}[result];fragment.append(summary);el.replaceChildren(fragment);return;}
  const items=result.items||[],all=items.length>0&&items.every(i=>i.status==='demonstrated');
  summary.textContent=items.some(i=>i.status==='contradicted')?'Revisit an idea':items.some(i=>i.status==='uncertain')?'Uncertain — try adding detail':all?'Understanding demonstrated':items.some(i=>i.status==='partial'||i.status==='demonstrated')?'Add more detail':'Keep going';
  summary.dataset.status=all?'demonstrated':items.some(i=>i.status==='contradicted')?'contradicted':'partial';fragment.append(summary);
  const ideas=document.createElement('div');ideas.className='loom-feedback-ideas';
  for(const item of items){
    const pill=document.createElement(item.hint?'details':'span');pill.className='loom-feedback-idea';pill.dataset.status=item.status;
    const name=(item.status==='demonstrated'?'✓ ':item.status==='contradicted'?'! ':'• ')+item.label;
    if(item.hint){const title=document.createElement('summary');title.textContent=name;title.setAttribute('aria-label',item.label+': '+labels[item.status]+'. Show hint');const hint=document.createElement('p');hint.textContent=item.hint;pill.append(title,hint);pill.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Escape'){(pill as HTMLDetailsElement).open=false;title.focus();}});}
    else{pill.textContent=name;pill.setAttribute('aria-label',item.label+': '+labels[item.status]);}
    ideas.append(pill);
  }
  fragment.append(ideas);el.replaceChildren(fragment);
}
