import Chart from 'chart.js/auto';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import {normalizeCanvasMath} from './canvas-math.ts';
import {canvasFeedback} from './canvas-feedback.ts';
import {bindQuiz} from './canvas-quiz.ts';
(window as any).Chart = Chart;
(window as any).katex = katex;
let scheduled=false;
const delimiters=[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false},{left:'$',right:'$',display:false}];
function renderMath(){
  scheduled=false;
  for(const el of document.querySelectorAll<HTMLElement>('[data-math]')){
    const formula=el.dataset.math||el.textContent||'';
    if(el.dataset.loomRendered===formula)continue;
    katex.render(normalizeCanvasMath(formula),el,{displayMode:el.dataset.display==='block',throwOnError:false,trust:false});el.dataset.loomRendered=formula;
  }
  renderMathInElement(document.body,{delimiters,preProcess:normalizeCanvasMath,throwOnError:false,trust:false,ignoredClasses:['katex','katex-display','katex-error','loom-no-math']});
}
const queueMath=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(renderMath)}};
function bindStudio(){if((window as any).Studio)Object.assign((window as any).Studio,{renderMath:queueMath,feedback:canvasFeedback,bindQuiz});}
bindStudio();
document.addEventListener('DOMContentLoaded',()=>{
  bindStudio();
  renderMath();
  new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||!(r.target instanceof Element?r.target:r.target.parentElement)?.closest('.katex,.katex-display,.katex-error,[data-loom-rendered]'))){queueMath();}}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-math','data-display']});
});
