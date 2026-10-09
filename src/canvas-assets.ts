export type CanvasHost='desktop'|'android';
export function canvasAssets(host:CanvasHost='desktop'){
 return host==='android'?{source:'https://appassets.androidplatform.net',base:'https://appassets.androidplatform.net/assets'}:{source:'studio:',base:'studio://app'};
}
