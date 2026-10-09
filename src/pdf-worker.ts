import { parentPort, workerData } from 'node:worker_threads';
import { PDFParse } from 'pdf-parse';
const parser=new PDFParse({data:new Uint8Array(workerData.bytes),isEvalSupported:false,verbosity:0});
try {
  const {mode,pages,query}=workerData;
  let result:any;
  if(mode==='render'){
    const images=await parser.getScreenshot({partial:pages,desiredWidth:1200,imageBuffer:false,imageDataUrl:true});
    result={total:images.total,pages:images.pages.map(p=>({page:p.pageNumber,width:p.width,height:p.height,dataUrl:p.dataUrl}))};
  }else if(mode==='search'){
    const text=await parser.getText();const needle=query.toLowerCase();
    const matches=text.pages.flatMap(p=>{const normalized=p.text.replace(/\s+/g,' '),at=normalized.toLowerCase().indexOf(needle);return at<0?[]:[{page:p.num,excerpt:normalized.slice(Math.max(0,at-180),at+needle.length+440)}];});
    const matched=new Set(matches.slice(0,10).map(m=>m.page));
    result={total:text.total,query,matches:matches.slice(0,10),more:matches.length>10,needsVisualReading:!text.text.trim(),_textPages:text.pages.filter(p=>matched.has(p.num)).map(p=>({page:p.num,text:p.text.slice(0,16000),truncated:p.text.length>16000}))};
  }else if(mode==='tables'){
    const tables=await parser.getTable({partial:pages,first:pages?undefined:5});
    result={total:tables.total,pages:tables.pages,truncated:false};
    if(JSON.stringify(result).length>100000)throw Error('These tables are too large. Request fewer pages.');
  }else if(mode==='info'){
    const info=await parser.getInfo();result={total:info.total,info:info.info,outline:info.outline?.slice(0,30)};
  }else{
    const text=await parser.getText({partial:pages,first:pages?undefined:5});
    result={total:text.total,pages:text.pages.map(p=>({page:p.num,text:p.text.slice(0,16000),truncated:p.text.length>16000})),needsVisualReading:!text.text.trim()};
  }
  parentPort!.postMessage({result});
}catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:'Could not read this PDF.'});}
finally{await parser.destroy().catch(()=>{});}
