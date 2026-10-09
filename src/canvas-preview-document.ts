import {canvasTheme,type CanvasAppearance} from './canvas-theme.ts';
import {canvasAssets,type CanvasHost} from './canvas-assets.ts';
export function canvasPreviewDocument(token:string,appearance:CanvasAppearance={},host:CanvasHost='desktop'){
  const assets=canvasAssets(host);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${assets.source}; style-src 'unsafe-inline' ${assets.source}; img-src data: blob:; font-src ${assets.source}; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><link rel="stylesheet" href="${assets.base}/canvas-toolkit.css">${canvasTheme(appearance)}<script>window.__loomPreviewToken=${JSON.stringify(token)};window.Studio={resize(){parent.postMessage({channel:'loom-preview',token:window.__loomPreviewToken,type:'resize',height:document.body.scrollHeight},'*')}};</script><script src="${assets.base}/canvas-preview.js"></script><script src="${assets.base}/canvas-toolkit.js"></script></head><body><div id="loom-preview-content" inert aria-busy="true"></div></body></html>`;
}
