'use strict';
const assert=require('node:assert/strict');const vscode=require('vscode');
exports.run=async function(){
 const extension=vscode.extensions.getExtension('local.reqtify-like');assert.ok(extension);await extension.activate();
 const folders=vscode.workspace.workspaceFolders;assert.equal(folders.length,1);const root=folders[0].uri;
 await vscode.commands.executeCommand('reqtrace.refresh');const summary=extension.exports.getAnalysisSummary();assert.equal(summary.length,1);assert.equal(summary[0].artifacts,9);assert.equal(summary[0].links,3);assert.equal(summary[0].diagnostics,0);assert.equal(summary[0].unresolved,0);
 await vscode.commands.executeCommand('reqtrace.dashboard');
 const pptx=vscode.Uri.joinPath(root,'slides.pptx');const view=vscode.Uri.from({scheme:'reqtrace-pptx',path:'/extracted.txt',query:Buffer.from(pptx.toString(),'utf8').toString('base64url')});const document=await vscode.workspace.openTextDocument(view);assert.match(document.getText(),/REQ-302: Second slide/);const slide=await vscode.commands.executeCommand('reqtrace.openPptxViewer',pptx,2);assert.equal(slide,2);
 const word=await vscode.commands.executeCommand('reqtrace.openWordViewer',vscode.Uri.joinPath(root,'verification.docx'));assert.equal(word.converted,true);
 const workbook=await vscode.commands.executeCommand('reqtrace.openWorkbookViewer',vscode.Uri.joinPath(root,'verification.xlsx'),{sheet:'Verification',row:2});assert.equal(workbook.sheet,'Verification');assert.equal(workbook.row,2);
 const page=await vscode.commands.executeCommand('reqtrace.openPdfViewer',vscode.Uri.joinPath(root,'supplement.pdf'),1);assert.equal(page,1);
 console.log('Multi-format VS Code host integration passed');
};
