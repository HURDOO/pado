export function sandboxDocument(content: string, inputNonce?: string, readOnly = false) {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const bridge =
    inputNonce === undefined && !readOnly
      ? ''
      : `<script>(()=>{const readOnly=${readOnly};const send=(type,extra)=>{if(!readOnly)parent.postMessage({type,nonce:${JSON.stringify(inputNonce)},...extra},'*')};window.pado=Object.freeze({submit:values=>send('pado.input',{values})});addEventListener('error',event=>send('pado.input-error',{message:String(event.message).slice(0,300)}));addEventListener('unhandledrejection',event=>send('pado.input-error',{message:String(event.reason).slice(0,300)}));if(readOnly){const block=event=>{event.preventDefault();event.stopImmediatePropagation()};for(const type of ['click','dblclick','submit','beforeinput','input','change'])addEventListener(type,block,true);addEventListener('keydown',event=>{if(!['Tab','PageDown','PageUp','ArrowDown','ArrowUp','Home','End',' '].includes(event.key))block(event)},true);addEventListener('DOMContentLoaded',()=>{for(const control of document.querySelectorAll('button,input,select,textarea'))control.disabled=true;for(const element of document.querySelectorAll('[contenteditable]'))element.contentEditable='false'})}})();</script>`;
  const base =
    inputNonce === undefined
      ? ''
      : '<style>html{color-scheme:dark}*,*::before,*::after{box-sizing:border-box}body{background:#171a20;color:#e8ebf2;font:15px/1.6 system-ui;margin:0;padding:20px;overflow-wrap:anywhere}button,input,select,textarea{font:inherit;max-width:100%}button{cursor:pointer}@media(max-width:600px){body{padding:12px}}</style>';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1">${base}${bridge}</head><body>${content}</body></html>`;
}
