'use strict';
const vscode=require('vscode');
const crypto=require('crypto');
const {extractInWorker,editWorkbookInWorker}=require('./workerRunner');
const fs=require('fs/promises');
const path=require('path');
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function viewerHtml(webview,extensionUri){
  const nonce=crypto.randomBytes(16).toString('base64');
  const script=webview.asWebviewUri(vscode.Uri.joinPath(extensionUri,'resources','workbook-viewer.js')).toString();
  const csp=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>Workbook</title><style>*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size) var(--vscode-font-family)}.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border)}button,select{font:inherit;padding:6px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:0}button:focus-visible,select:focus-visible{outline:1px solid var(--vscode-focusBorder)}button:disabled{opacity:.5}.notice{padding:8px 12px;color:var(--vscode-descriptionForeground)}.grid{overflow:auto}table{border-collapse:collapse;min-width:100%}th,td{border:1px solid var(--vscode-panel-border);padding:6px 10px;text-align:left;white-space:pre-wrap;vertical-align:top;min-width:100px}th{background:var(--vscode-sideBar-background)}.row-number{min-width:55px}.selected-cell{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}.highlight{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}</style></head><body><div class="toolbar"><label>Worksheet <select id="sheet" aria-label="Worksheet"></select></label><button id="edit">Edit text cell in copy</button><button id="previous" disabled>Previous rows</button><span id="page">Rows —</span><button id="next" disabled>Next rows</button></div><div class="notice" id="status" role="status">Loading workbook…</div><div class="grid"><table><thead id="head"></thead><tbody id="body"></tbody></table></div><script nonce="${nonce}" src="${escape(script)}"></script></body></html>`;
}
async function openWorkbookViewer(context,uri,location){
  if(!uri){const selected=await vscode.window.showOpenDialog({canSelectMany:false,filters:{Excel:['xlsx']},openLabel:'Open workbook'});if(!selected)return;uri=selected[0];}
  try {
    const viewerBytes=await vscode.workspace.fs.readFile(uri);
    const viewerHash=crypto.createHash('sha256').update(viewerBytes).digest('hex');
    const model=await extractInWorker('xlsx-view',viewerBytes);
    const panel=vscode.window.createWebviewPanel('reqtraceWorkbook',`Workbook: ${uri.path.split('/').pop()}`,vscode.ViewColumn.One,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'resources')]});
    const rendered=new Promise((resolve,reject)=>{
      let done=false;const timer=setTimeout(()=>finish(new Error('Workbook viewer did not finish loading')),30000);
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
      panel.onDidDispose(()=>finish(new Error('Workbook viewer closed before loading')),null,context.subscriptions);
      panel.webview.onDidReceiveMessage(message=>{
        if(message && message.type==='ready')panel.webview.postMessage({type:'workbook',model,location});
        else if(message && message.type==='rendered')finish(null,{sheet:message.sheet,row:message.row});
        else if(message && message.type==='error')finish(new Error(message.message));
        else if(message && message.type==='edit' && typeof message.sheet==='string' && model.sheets.some(sheet=>sheet.name===message.sheet)) {
          const sheet=model.sheets.find(item=>item.name===message.sheet);
          const match=typeof message.address==='string' && /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(message.address);
          let selection;
          if(match){const column=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);const row=sheet.rows.find(item=>item.number===Number(match[2]));if(row && column<=row.cells.length)selection={address:message.address,value:row.cells[column-1],viewerHash};}
          editWorkbookCopy(uri,message.sheet,selection).catch(error=>vscode.window.showErrorMessage(`Could not edit workbook: ${error.message}`));
        }
      },null,context.subscriptions);
    });
    panel.webview.html=viewerHtml(panel.webview,context.extensionUri);return await rendered;
  }catch(error){vscode.window.showErrorMessage(`Could not open workbook: ${error.message}`);throw error;}
}
async function editWorkbookCopy(uri,sheet,selection){
  const original=await vscode.workspace.fs.readFile(uri);
  if(selection && crypto.createHash('sha256').update(original).digest('hex')!==selection.viewerHash)throw new Error('The source workbook changed since the viewer opened. Reopen it and retry.');
  const address=selection ? selection.address : await vscode.window.showInputBox({title:`Edit ${sheet}`,prompt:'Cell address (for example B12)',validateInput:value=>/^[A-Za-z]{1,3}[1-9][0-9]{0,6}$/.test(value)?null:'Enter a valid cell address'});
  if(address===undefined)return;
  const value=await vscode.window.showInputBox({title:`New text for ${sheet}!${address.toUpperCase()}`,prompt:'Enter the replacement text. Only existing plain-text cells are supported.',value:selection && selection.value});
  if(value===undefined)return;
  const output=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Preparing workbook copy'},()=>editWorkbookInWorker(original,{sheet,address,value}));
  const filename=path.basename(uri.path).replace(/\.xlsx$/i,'')+'-edited.xlsx';
  const defaultUri=vscode.Uri.joinPath(uri.with({path:path.posix.dirname(uri.path)}),filename);
  const destination=await vscode.window.showSaveDialog({defaultUri,filters:{Excel:['xlsx']},saveLabel:'Save new workbook copy'});
  if(!destination)return;
  if(destination.scheme!=='file')throw new Error('Saving workbook copies currently requires a local filesystem destination');
  const latest=await vscode.workspace.fs.readFile(uri);
  const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  if(digest(latest)!==digest(original))throw new Error('The source workbook changed during editing. Open it again and retry.');
  await fs.writeFile(destination.fsPath,output,{flag:'wx'});
  vscode.window.showInformationMessage('Workbook copy saved. Open it in a spreadsheet application and recalculate dependent formulas.');
}
module.exports={viewerHtml,openWorkbookViewer,editWorkbookCopy};
