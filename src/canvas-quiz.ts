import {canvasFeedback} from './canvas-feedback.ts';
type QuizOptions={input:string;feedback:string;question:string;detailed?:string;stateKey?:string;sources?:string[];onResult?:(result:any)=>void};
export function bindQuiz(options:QuizOptions){
  const input=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(options.input),feedback=document.querySelector<HTMLElement>(options.feedback),detailed=options.detailed?document.querySelector<HTMLButtonElement>(options.detailed):null;
  if(!input||!feedback)throw Error('Quiz input and feedback elements must exist before binding.');
  const studio=(window as any).Studio,key=options.stateKey||options.input;let timer:ReturnType<typeof setTimeout>|undefined,version=0,disposed=false;
  const saved=studio.quizAnswers?.[key]??studio.state?.quizAnswers?.[key];if(typeof saved==='string')input.value=saved;
  const update=()=>{
    const current=++version;clearTimeout(timer);studio.cancelCheck();const answer=input.value;
    studio.saveQuizAnswer(key,answer);
    if(detailed)detailed.disabled=!answer.trim();canvasFeedback(feedback,answer.trim()?'checking':'empty');if(!answer.trim())return;
    timer=setTimeout(async()=>{try{const result=await studio.check({question:options.question,answer});if(current!==version||disposed)return;canvasFeedback(feedback,result);options.onResult?.(result);}catch(e){if(current===version&&!disposed)canvasFeedback(feedback,'unavailable',e instanceof Error&&/rate limited/i.test(e.message)?e.message:undefined);}},300);
  };
  const detail=()=>{if(!input.value.trim())return;studio.ask('Give detailed feedback on this explanation, identify the specific gap or misconception, and suggest a next attempt.\nQuestion: '+options.question+'\nLearner answer: '+input.value+'\nPublished rubric: '+JSON.stringify(studio.rubric||[])+'\nSources: '+(options.sources||[]).join('\n'));};
  input.addEventListener('input',update);detailed?.addEventListener('click',detail);if(detailed)detailed.disabled=!input.value.trim();canvasFeedback(feedback,'empty');
  return()=>{disposed=true;version++;clearTimeout(timer);studio.cancelCheck();input.removeEventListener('input',update);detailed?.removeEventListener('click',detail);};
}
