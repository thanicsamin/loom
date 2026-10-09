import {Script} from 'node:vm';
export function validateCanvasScripts(html:string){
  let index=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([^]*?)<\/script\s*>/gi)){
    index++;const attrs=match[1],type=attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const kind=(type?.[1]??type?.[2]??type?.[3]??'').trim().toLowerCase();
    if(/\bsrc\s*=/i.test(attrs)||kind&&!['text/javascript','application/javascript'].includes(kind))continue;
    try{new Script(match[2],{filename:`canvas-script-${index}.js`});}
    catch(error){throw Error(`Inline script ${index} has invalid JavaScript: ${error instanceof Error?error.message:'syntax error'}. Repair it and publish again. Nothing was saved.`);}
  }
  // Formula containers are part of the authoring contract. Catch plain pseudo-math
  // before it becomes a saved lesson, while leaving prose and algorithm code alone.
  const markup=html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi,'');
  for(const m of markup.matchAll(/<(div|span|p)\b([^>]*\bclass\s*=\s*["'][^"']*\b(?:eq|equation|formula|math)\b[^"']*["'][^>]*)>([^]*?)<\/\1\s*>/gi)){
    const content=m[3].replace(/<[^>]+>/g,'').trim();
    if(content&&!/data-math\s*=|class\s*=\s*["'][^"']*katex|\$[^]*\$|\\\([^]*\\\)|\\\[[^]*\\\]/i.test(m[2]+m[3])){
      throw Error('A formula is plain text instead of LaTeX. Put formulas in $...$, $$...$$, or data-math attributes; preserve TeX backslashes in the JSON. Repair and publish again. Nothing was saved.');
    }
  }
}
