'use strict';
const vscode = require('vscode');
const { matchInWorker } = require('./workerRunner');

async function testRegex(output) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showInformationMessage('Open a text document before testing a pattern.'); return; }
  const pattern = await vscode.window.showInputBox({ title: 'Test extraction pattern', prompt: 'JavaScript regex, applied once to each line. Use named groups such as (?<id>...) or (?<target>...).', placeHolder: '^(?<id>REQ-[0-9]+): (?<title>.+)$', ignoreFocusOut: true });
  if (pattern === undefined) return;
  let regex;
  try { regex = new RegExp(pattern); } catch (error) { vscode.window.showErrorMessage(`Invalid regular expression: ${error.message}`); return; }
  const document = editor.document;
  let matches;
  try { matches = await matchInWorker(pattern,document.getText()); }
  catch(error) { vscode.window.showErrorMessage(`Regex test failed: ${error.message}`); return; }
  output.clear();
  output.appendLine(`Document: ${document.uri.toString()}`);
  output.appendLine(`Pattern: ${pattern}`);
  output.appendLine(`Matches: ${matches.length} (first match per line)`);
  output.appendLine('');
  for (const match of matches) {
    output.appendLine(`${document.uri.fsPath}:${match.line + 1}:${match.column + 1}  ${match.text}`);
    if (match.groups) output.appendLine(`  groups: ${JSON.stringify(match.groups)}`);
  }
  output.show(true);
  if (!matches.length) { vscode.window.showInformationMessage('No lines matched the pattern.'); return; }
  const items = matches.map(m => ({ label: `Line ${m.line + 1}: ${m.text.trim()}`, description: m.groups ? JSON.stringify(m.groups) : '', match: m }));
  const selected = await vscode.window.showQuickPick(items, { title: `${matches.length} matching lines`, placeHolder: 'Select a match to navigate to the editable document' });
  if (!selected) return;
  const target = await vscode.window.showTextDocument(document);
  const m = selected.match;
  const start = new vscode.Position(m.line, m.column);
  const end = new vscode.Position(m.line, m.column + m.length);
  target.selection = new vscode.Selection(start, end);
  target.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}
module.exports = { testRegex };

// Tests the same captured text used by the last scan, not a re-extraction.
async function testConfiguredRegex(output, {file, source, kind}, apply) {
  const pattern = await vscode.window.showInputBox({
    title:`Test ${kind} pattern: ${source.name}`,
    prompt:'Test against the text from the most recent scan. Saving changes the project configuration.',
    value:source[kind] || '', ignoreFocusOut:true,
    validateInput:value=>{
      if (!value && kind === 'reference') return undefined;
      try { new RegExp(value); } catch (error) { return error.message; }
      const group = kind === 'artifact' ? '(?<id>' : '(?<target>';
      return value.includes(group) ? undefined : `Include the named group ${group}...)`;
    }
  });
  if (pattern === undefined) return;
  let regex;
  try { regex = pattern ? new RegExp(pattern) : null; } catch (error) { vscode.window.showErrorMessage(`Invalid regular expression: ${error.message}`); return; }
  let matches;
  try { matches = regex ? await matchInWorker(pattern,file.text,5000,kind==='reference') : []; }
  catch(error) { vscode.window.showErrorMessage(`Regex test failed: ${error.message}`); return; }
  output.clear(); output.appendLine(`Source: ${source.name} / ${file.path}`); output.appendLine(`Pattern: ${pattern || '(disabled)'}`); output.appendLine(`Matches: ${matches.length} (${kind==='reference'?'all matches':'first match per line'})`);
  for (const match of matches) { output.appendLine(`${file.path}:${match.line+1}:${match.column+1}  ${match.text}`); if(match.groups)output.appendLine(`  groups: ${JSON.stringify(match.groups)}`); }
  output.show(true);
  const choices = [{label:'$(save) Save tested pattern to project',kind:'save',description:'Updates traceability.json'},...matches.map(match=>({label:`Line ${match.line+1}: ${match.text.trim()}`,description:match.groups?JSON.stringify(match.groups):'',kind:'match',match}))];
  const selected = await vscode.window.showQuickPick(choices,{title:`${matches.length} matching lines`,placeHolder:'Select a match to navigate, or save the tested pattern'});
  if (!selected) return;
  if (selected.kind === 'save') {
    try { await apply(pattern); vscode.window.showInformationMessage('Pattern saved and traceability refreshed.'); }
    catch(error) { vscode.window.showErrorMessage(`Could not save pattern: ${error.message}`); }
    return;
  }
  const uri = file.viewUri ? vscode.Uri.parse(file.viewUri) : file.uri;
  if (!uri) return vscode.window.showWarningMessage('This source cannot be opened as a text document.');
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.getText() !== file.text) return vscode.window.showWarningMessage('The document changed since analysis. Refresh and test again.');
  const target = await vscode.window.showTextDocument(document);
  const match=selected.match, start=new vscode.Position(match.line,match.column), end=new vscode.Position(match.line,match.column+match.length);
  target.selection=new vscode.Selection(start,end); target.revealRange(new vscode.Range(start,end),vscode.TextEditorRevealType.InCenter);
}
module.exports.testConfiguredRegex = testConfiguredRegex;
