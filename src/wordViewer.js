'use strict';
const vscode=require('vscode');
const {extractInWorker,editWordInWorker,listWordRunsInWorker}=require('./workerRunner');
const crypto=require('crypto');
const fs=require('fs/promises');
const path=require('path');
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function viewerHtml(content,cspSource) {
  const nonce=crypto.randomBytes(16).toString('base64');
  const csp=`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>Word document</title><style>body{margin:0;padding:24px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family)}.notice{color:var(--vscode-descriptionForeground);margin:0 auto 16px;max-width:900px}.document{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);padding:36px;max-width:900px;margin:auto;line-height:1.6;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid var(--vscode-panel-border);padding:6px;vertical-align:top}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{border-left:3px solid var(--vscode-panel-border);padding-left:12px}</style></head><body><p class="notice">Converted view. <button id="edit">Edit text run in copy</button></p><article class="document">${content}</article><script nonce="${nonce}">document.getElementById("edit").addEventListener("click",()=>acquireVsCodeApi().postMessage({type:"edit"}));</script></body></html>`;
}
async function openWordViewer(context,uri) {
  if(!uri){const selected=await vscode.window.showOpenDialog({canSelectMany:false,filters:{Word:['docx']},openLabel:'Open Word document'});if(!selected)return;uri=selected[0];}
  try {
    const bytes=await vscode.workspace.fs.readFile(uri);
    const result=await extractInWorker('docx-html',bytes);
    const panel=vscode.window.createWebviewPanel('reqtraceWord',`Word: ${uri.path.split('/').pop()}`,vscode.ViewColumn.One,{enableScripts:true,localResourceRoots:[]});
    panel.webview.onDidReceiveMessage(message=>{if(message && message.type==='edit')editWordCopy(uri).catch(error=>vscode.window.showErrorMessage(`Could not edit Word document: ${error.message}`));},null,context.subscriptions);
    panel.webview.html=viewerHtml(result.html,panel.webview.cspSource);
    if(result.diagnostics.length)vscode.window.showWarningMessage(`Word conversion reported ${result.diagnostics.length} issue(s); the visual view may be incomplete.`);
    return {converted:true,diagnostics:result.diagnostics};
  } catch(error){vscode.window.showErrorMessage(`Could not open Word document: ${error.message}`);throw error;}
}
async function editWordCopy(uri){
  const original=await vscode.workspace.fs.readFile(uri);
  const runs=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Reading editable Word text'},()=>listWordRunsInWorker(original));
  if(!runs.length)throw new Error('No editable text runs were found');
  const selected=await vscode.window.showQuickPick(runs.map(run=>({label:run.text.replace(/[\r\n\t]/g,' ').slice(0,200) || '(whitespace)',description:`Text run ${run.index+1}`,run})),{title:'Choose a Word text run',placeHolder:'Search by text; formatting can split a sentence into multiple runs'});
  if(!selected)return;
  const oldText=selected.run.text;
  const newText=await vscode.window.showInputBox({title:'Replacement text',prompt:'Enter replacement text on one line',value:oldText});
  if(newText===undefined)return;
  const output=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Preparing Word document copy'},()=>editWordInWorker(original,{oldText,newText,index:selected.run.index}));
  const filename=path.basename(uri.path).replace(/\.docx$/i,'')+'-edited.docx';
  const destination=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.joinPath(uri.with({path:path.posix.dirname(uri.path)}),filename),filters:{Word:['docx']},saveLabel:'Save new document copy'});
  if(!destination)return;
  if(destination.scheme!=='file')throw new Error('Saving Word copies currently requires a local filesystem destination');
  const latest=await vscode.workspace.fs.readFile(uri), digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  if(digest(latest)!==digest(original))throw new Error('The source document changed during editing. Open it again and retry.');
  await fs.writeFile(destination.fsPath,output,{flag:'wx'});
  vscode.window.showInformationMessage('Word document copy saved.');
}
module.exports={viewerHtml,openWordViewer,editWordCopy};
