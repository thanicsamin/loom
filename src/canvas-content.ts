// Preserve raw text in scripts and styles while removing outer document containers.
export function canvasContent(html:string){
  return html.split(/(<!--[^]*?-->|<script\b[^>]*>[^]*?<\/script\s*>|<style\b[^>]*>[^]*?<\/style\s*>)/gi)
    .map((part,index)=>index%2?part:part.replace(/<!doctype[^>]*>/gi,'').replace(/<\/?(?:html|head|body)(?:\s[^>]*)?>/gi,''))
    .join('');
}
