'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const escape = value => String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function viewerHtml(webview, extensionUri) {
  const nonce=crypto.randomBytes(16).toString('base64');
  const resource=(...parts)=>webview.asWebviewUri(vscode.Uri.joinPath(extensionUri,...parts)).toString();
  const library=resource('node_modules','pdfjs-dist','build','pdf.mjs');
  const worker=resource('node_modules','pdfjs-dist','build','pdf.worker.mjs');
  const client=resource('resources','pdf-viewer.js');
  const csp=`default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource} blob:; style-src 'unsafe-inline'; connect-src ${webview.cspSource}; worker-src blob:; img-src data: blob:;`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta name="pdf-library" content="${escape(library)}"><meta name="pdf-worker" content="${escape(worker)}"><title>PDF document</title><style>*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size) var(--vscode-font-family)}.toolbar{position:sticky;top:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);z-index:2}button{font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:0;padding:7px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.status{padding:12px 16px;color:var(--vscode-descriptionForeground)}.page-container{overflow:auto;padding:12px 20px 32px;text-align:center}canvas{display:block;margin:0 auto;max-width:none;box-shadow:0 2px 12px #0005;background:white}</style></head><body><div class="toolbar"><button id="previous" disabled>Previous page</button><span id="page-label">Page —</span><button id="next" disabled>Next page</button><button id="zoom-out" disabled>Zoom out</button><span id="zoom-label">100%</span><button id="zoom-in" disabled>Zoom in</button></div><div id="status" class="status" role="status">Loading PDF…</div><div class="page-container"><canvas id="page" aria-label="PDF page"></canvas></div><script nonce="${nonce}" src="${escape(client)}"></script></body></html>`;
}
async function openPdfViewer(context, uri, page=1) {
  if (!uri) { const picked=await vscode.window.showOpenDialog({canSelectMany:false,filters:{PDF:['pdf']},openLabel:'Open PDF'}); if(!picked)return; uri=picked[0]; }
  try {
    const bytes=await vscode.workspace.fs.readFile(uri);
    if(bytes.length>20*1024*1024) throw new Error('PDF exceeds the 20 MB size limit');
    const panel=vscode.window.createWebviewPanel('reqtracePdf',`PDF: ${uri.path.split('/').pop()}`,vscode.ViewColumn.One,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'resources'),vscode.Uri.joinPath(context.extensionUri,'node_modules','pdfjs-dist')]});
    const rendered=new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>finish(new Error('PDF viewer did not finish loading')),30000);
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
      panel.onDidDispose(()=>finish(new Error('PDF viewer was closed before loading')),null,context.subscriptions);
      panel.webview.onDidReceiveMessage(message=>{
        if(message && message.type==='ready') panel.webview.postMessage({type:'document',data:Buffer.from(bytes).toString('base64'),page:Number.isInteger(page)?page:1});
        else if(message && message.type==='rendered')finish(null,message.page);
        else if(message && message.type==='error')finish(new Error(message.message));
      },null,context.subscriptions);
    });
    panel.webview.html=viewerHtml(panel.webview,context.extensionUri);
    return await rendered;
  } catch(error) { vscode.window.showErrorMessage(`Could not open PDF: ${error.message}`); throw error; }
}
module.exports={viewerHtml,openPdfViewer};
