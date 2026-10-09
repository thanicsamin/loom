import katex from 'katex';

// Some generated HTML retains the JSON layer's escaping. Normalize a whole
// overescaped expression, including its matrix row breaks, only if it parses.
// Ordinary TeX and expressions that already contain single escapes stay intact.
export function normalizeCanvasMath(tex:string):string {
  if(!/(?<!\\)\\\\(?:[A-Za-z]{2,}\b|[|,;!:])/.test(tex)||/(?<!\\)\\(?:[A-Za-z]+\b|[|,;!:])/.test(tex))return tex;
  const candidate=tex.replaceAll('\\\\','\\');
  try{katex.renderToString(candidate,{throwOnError:true,trust:false});return candidate;}
  catch{return tex;}
}
