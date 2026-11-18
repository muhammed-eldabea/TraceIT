'use strict';
const vscode = require('vscode');
const path = require('path');
const engine = require('./engine');
const {validateConfigurationContext}=require('./oslc');
const formats = [
  {label:'Text / code', format:'text', include:'**/*.md'},
  {label:'Word (.docx)', format:'docx', include:'**/*.docx'},
  {label:'OpenDocument Text (.odt)', format:'odt', include:'**/*.odt'},
  {label:'Excel (.xlsx)', format:'xlsx', include:'**/*.xlsx'},
  {label:'PDF', format:'pdf', include:'**/*.pdf'},
  {label:'PowerPoint (.pptx)', format:'pptx', include:'**/*.pptx'},
  {label:'CSV', format:'csv', include:'**/*.csv'},
  {label:'ReqIF XML', format:'reqif', include:'**/*.reqif'},
  {label:'ReqIFz archive', format:'reqifz', include:'**/*.reqifz'},
  {label:'DOORS Classic bridge export (experimental)', format:'doors-classic-export', include:'**/*.doors.csv'},
  {label:'Codebeamer (experimental)', format:'codebeamer'},
  {label:'DOORS Next (experimental)', format:'doors-next'}
];
async function askSource(existing) {
  const choice = await vscode.window.showQuickPick(formats, {placeHolder:'Choose a source format'}); if (!choice) return;
  const name = await vscode.window.showInputBox({title:'Source name',prompt:'A unique name used in coverage rules',validateInput:value => !value.trim() ? 'Enter a name' : existing.some(s=>s.name===value.trim()) ? 'A source with this name already exists' : undefined});
  if (!name) return;
  const source = {name:name.trim(),format:choice.format};
  if (choice.include) {
    const include = await vscode.window.showInputBox({title:'Files to analyze',prompt:'Workspace-relative glob',value:choice.include,validateInput:v=>v.trim()?undefined:'Enter a file glob'});
    if (!include) return; source.include=include.trim();
  }
  if (['text','docx','xlsx','pdf','pptx','odt'].includes(choice.format)) {
    const artifact = await vscode.window.showInputBox({title:'Artifact extraction regex',prompt:'Use named capture group (?<id>...) and optional (?<title>...)',value:'^(?<id>REQ-[0-9]+): (?<title>.+)$',validateInput:v=>{try{if(!v.includes('(?<id>')) return 'Include a named id group'; new RegExp(v);return undefined;}catch(e){return e.message;}}});
    if (!artifact) return; source.artifact=artifact;
    const reference = await vscode.window.showInputBox({title:'Reference extraction regex (optional)',prompt:'Use named capture group (?<target>...). Leave empty to add links manually.',validateInput:v=>{try{if(v && !v.includes('(?<target>')) return 'Include a named target group'; if(v)new RegExp(v);return undefined;}catch(e){return e.message;}}});
    if (reference === undefined) return; if (reference) source.reference=reference;
    if (choice.format==='xlsx') { const sheet=await vscode.window.showInputBox({title:'Worksheet name (optional)',prompt:'Leave empty to scan every worksheet'}); if(sheet===undefined)return; if(sheet)source.sheet=sheet; }
  } else if (choice.format==='csv') {
    const idColumn=await vscode.window.showInputBox({title:'Identifier column',prompt:'Enter the exact CSV header for requirement IDs',validateInput:v=>v.trim()?undefined:'Enter a column name'}); if(!idColumn)return; source.idColumn=idColumn;
    for (const [key,title] of [['titleColumn','Title column'],['textColumn','Requirement text column'],['referenceColumn','Reference column']]) {
      const value=await vscode.window.showInputBox({title:`${title} (optional)`,prompt:'Enter the exact CSV header, or leave empty'});
      if(value===undefined)return;
      if(value)source[key]=value;
    }
    if(source.referenceColumn){
      const separator=await vscode.window.showInputBox({title:'Reference separator',prompt:'Separates multiple IDs in a reference cell',value:';',validateInput:v=>v ? undefined : 'Enter a separator'});
      if(separator===undefined)return;if(!separator)throw new Error('Reference separator cannot be empty');source.referenceSeparator=separator;
    }
    const parseColumns=value=>{
      if(!value.trim())return [];
      let columns;try{columns=JSON.parse(value);}catch{throw new Error('Enter a JSON array of column names');}
      if(!Array.isArray(columns) || columns.some(column=>typeof column!=='string' || !column.trim()) || new Set(columns).size!==columns.length)throw new Error('Enter a JSON array of unique, nonempty column names');
      return columns;
    };
    const attributes=await vscode.window.showInputBox({title:'Additional attribute columns (optional)',prompt:'JSON array of exact headers, for example ["Status", "Owner"]',validateInput:v=>{try{parseColumns(v);return undefined;}catch(error){return error.message;}}});
    if(attributes===undefined)return;const columns=parseColumns(attributes);if(columns.length)source.attributeColumns=columns;
    const delimiter=await vscode.window.showInputBox({title:'CSV delimiter',prompt:'Enter a single character',value:',',validateInput:v=>v.length===1?undefined:'Enter one character'});
    if(delimiter===undefined)return;if(delimiter.length!==1)throw new Error('CSV delimiter must be one character');source.delimiter=delimiter;
  } else if (choice.format==='doors-classic-export') {
    const connection=await vscode.window.showInputBox({title:'DOORS Classic database group',prompt:'Use the same group for modules from one database',value:'doors-classic',validateInput:v=>v.trim()?undefined:'Enter a database group'}); if(!connection)return; source.connection=connection.trim();
    const linkType=await vscode.window.showInputBox({title:'Type for exported DOORS links',value:'references',validateInput:v=>v.trim()?undefined:'Enter a link type'}); if(!linkType)return; source.linkType=linkType.trim();
  } else if (choice.format==='codebeamer' || choice.format==='doors-next') {
    const connection=await vscode.window.showInputBox({title:'Connection name',prompt:'Create credentials with the appropriate Configure Connection command',validateInput:v=>v.trim()?undefined:'Enter a connection name'}); if(!connection)return; source.connection=connection.trim();
    if(choice.format==='codebeamer') {
      const api=await vscode.window.showQuickPick([{label:'v3',description:'Current Swagger API'},{label:'v2',description:'Older Swagger API'}],{placeHolder:'Select your Codebeamer API version'});
      if(!api)return; source.apiVersion=api.label;
      const associations=await vscode.window.showQuickPick([{label:'None',value:'none',description:'Import items without associations'},{label:'REST v1',value:'v1',description:'Import incoming and outgoing associations'},{label:'Swagger v3',value:'v3',description:'Resolve associations through item relations'}],{placeHolder:'Choose how to import Codebeamer associations'});
      if(!associations)return; if(associations.value!=='none'){source.includeAssociations=true;source.associationApi=associations.value;}
    }
    const key=choice.format==='codebeamer'?'query':'queryUrl';
    const value=await vscode.window.showInputBox({title:key==='query'?'Codebeamer cbQL query':'DOORS Next OSLC query URL',validateInput:v=>v.trim()?undefined:'Enter a value'}); if(!value)return; source[key]=value.trim();
    if(choice.format==='doors-next'){
      const context=await vscode.window.showInputBox({title:'DOORS Next configuration context (optional)',prompt:'HTTPS URL of a local or global configuration. Leave empty for projects without configuration management.',validateInput:v=>{if(!v.trim())return undefined;try{validateConfigurationContext(v.trim());return undefined;}catch(error){return error.message;}}});
      if(context===undefined)return;if(context.trim())source.configurationContext=validateConfigurationContext(context.trim());
    }
  }
  return source;
}
async function chooseFolder() {
  const folders=vscode.workspace.workspaceFolders || [];
  if (!folders.length) { vscode.window.showWarningMessage('Open a workspace folder first.'); return; }
  if (folders.length===1) return folders[0];
  const selected=await vscode.window.showQuickPick(folders.map(folder=>({label:folder.name,description:folder.uri.fsPath,folder})),{placeHolder:'Choose a workspace folder'});
  return selected && selected.folder;
}
async function openConfig(folder) {
  const uri=vscode.Uri.joinPath(folder.uri,'traceability.json');
  const doc=await vscode.workspace.openTextDocument(uri);
  const config=JSON.parse(doc.getText()); engine.validate(config); return {doc,config};
}
function serializeConfig(config) { return JSON.stringify(config,(key,value)=>key==='_artifact' || key==='_reference' ? undefined : value,2)+'\n'; }
async function updateConfig(doc, config) {
  engine.validate(config);
  const edit=new vscode.WorkspaceEdit();
  edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),serializeConfig(config));
  if(!await vscode.workspace.applyEdit(edit))throw new Error('VS Code could not apply the configuration edit');
  await vscode.window.showTextDocument(doc);
  if(!await doc.save())throw new Error('Could not save the configuration');
}
async function createProjectInFolder(folder) {
  const uri=vscode.Uri.joinPath(folder.uri,'traceability.json');
  try { await vscode.workspace.fs.stat(uri); vscode.window.showWarningMessage('traceability.json already exists. Use Add Source or edit the file.'); return; }
  catch(error){ if(error.code!=='FileNotFound')throw error; }
  const source=await askSource([]); if(!source)return;
  const config={sources:[source],links:[]}; engine.validate(config);
  const edit=new vscode.WorkspaceEdit(); edit.createFile(uri,{overwrite:false,ignoreIfExists:false}); edit.insert(uri,new vscode.Position(0,0),serializeConfig(config));
  if(!await vscode.workspace.applyEdit(edit))throw new Error('Could not create traceability.json; it may already exist');
  const doc=await vscode.workspace.openTextDocument(uri);
  if(!await doc.save())throw new Error('Could not save the new configuration');
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('Traceability project created. Add sources and coverage rules as needed.');
  return true;
}
async function createProject() { const folder=await chooseFolder();if(folder)return createProjectInFolder(folder); }
async function openProject() {
  const method=await vscode.window.showQuickPick([{label:'Choose a folder',value:'choose'},{label:'Enter an absolute folder path',value:'path'}],{placeHolder:'Open a traceability project'});
  if(!method)return;
  let uri;
  if(method.value==='path'){
    const value=await vscode.window.showInputBox({title:'Project folder path',prompt:'Enter an absolute path to an existing directory',validateInput:v=>path.isAbsolute(v.trim())?undefined:'Enter an absolute folder path'});
    if(value===undefined)return;if(!path.isAbsolute(value.trim()))throw new Error('Project folder path must be absolute');uri=vscode.Uri.file(value.trim());
  }else{
    const selected=await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'Open project folder'});
    if(!selected || !selected.length)return;uri=selected[0];
  }
  const stat=await vscode.workspace.fs.stat(uri);
  if(!(stat.type & vscode.FileType.Directory))throw new Error('Selected project path is not a directory');
  const configUri=vscode.Uri.joinPath(uri,'traceability.json');let exists=true;
  try{await vscode.workspace.fs.stat(configUri);}catch(error){if(error.code!=='FileNotFound')throw error;exists=false;}
  if(!exists && !await createProjectInFolder({uri,name:path.basename(uri.fsPath)}))return;
  await vscode.commands.executeCommand('vscode.openFolder',uri,{forceNewWindow:true});
}
function dirtyProjectDocuments(folder){
  return vscode.workspace.textDocuments.filter(doc=>doc.isDirty && vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString()===folder.uri.toString());
}
async function saveDocuments(documents){
  for(const doc of documents)if(!await doc.save())throw new Error(`Could not save ${doc.uri.toString()}`);
}
async function saveProject(refresh){
  const folder=await chooseFolder();if(!folder)return;
  const documents=dirtyProjectDocuments(folder);await saveDocuments(documents);await refresh();
}
async function reloadProject(refresh){
  const folder=await chooseFolder();if(!folder)return;
  const documents=dirtyProjectDocuments(folder);
  if(documents.length){
    const choice=await vscode.window.showWarningMessage('This project has unsaved files. Reloading scans the saved files; unsaved editor changes remain open.',{modal:true},'Save and Reload','Reload Saved Files');
    if(!choice)return;if(choice==='Save and Reload')await saveDocuments(documents);else if(choice!=='Reload Saved Files')return;
  }
  await refresh();
}
async function editProjectConfig(){
  const folder=await chooseFolder();if(!folder)return;
  const doc=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri,'traceability.json'));
  await vscode.window.showTextDocument(doc);
}
async function updateFromDashboard(folder,expected,text){
  if(typeof text!=='string' || Buffer.byteLength(text,'utf8')>1024*1024)throw new Error('Configuration must be text under 1 MB');
  let parsed;try{parsed=JSON.parse(text);}catch(error){throw new Error(`Invalid configuration JSON: ${error.message}`);}
  engine.validate(parsed);
  const uri=vscode.Uri.joinPath(folder.uri,'traceability.json');
  const disk=Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  const doc=await vscode.workspace.openTextDocument(uri);
  if(doc.isDirty || disk!==expected || doc.getText()!==expected)throw new Error('Project configuration changed since the dashboard was loaded; save or discard editor changes and refresh');
  const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),text);
  if(!await vscode.workspace.applyEdit(edit))throw new Error('VS Code could not apply the configuration edit');
  if(!await doc.save())throw new Error('Could not save the configuration');
}
async function addSource() {
  const folder=await chooseFolder(); if(!folder)return;
  const {doc,config}=await openConfig(folder);
  const source=await askSource(config.sources); if(!source)return;
  config.sources.push(source); await updateConfig(doc,config);
}
async function assignGroup(){
  const folder=await chooseFolder();if(!folder)return;
  const {doc,config}=await openConfig(folder);if(doc.isDirty)throw new Error('Save the project configuration before changing document groups');
  const selected=await vscode.window.showQuickPick(config.sources.map(source=>({label:source.name,description:source.include || source.queryUrl || source.query || source.format,detail:`Current group: ${source.group || source.name}`,name:source.name})),{canPickMany:true,matchOnDescription:true,placeHolder:'Choose the document sources to collect in a folder'});
  if(!selected || !selected.length)return;
  const group=await vscode.window.showInputBox({title:'Document group name',prompt:'Sources with the same name appear together as a folder in the coverage diagram',validateInput:value=>value.trim()?undefined:'Enter a group name'});
  if(group===undefined)return;if(!group.trim())throw new Error('Document group name cannot be empty');
  const names=new Set(selected.map(item=>item.name));for(const source of config.sources)if(names.has(source.name))source.group=group.trim();
  await updateConfig(doc,config);
}
async function addGroupRuleForFolder(folder,from,to){
  const {doc,config}=await openConfig(folder);if(doc.isDirty)throw new Error('Save the project configuration before connecting groups');
  const groups=new Set(config.sources.map(source=>source.group || source.name));
  if(!groups.has(from) || !groups.has(to))throw new Error('A document group no longer exists; reload the project');
  const type=await vscode.window.showInputBox({title:'Coverage link type',prompt:`Links from ${from} cover ${to}`,value:'verifies',validateInput:value=>value.trim()?undefined:'Enter a link type'});
  if(type===undefined)return;if(!type.trim())throw new Error('Enter a link type');
  config.groupLinks=config.groupLinks || [];
  if(config.groupLinks.some(rule=>rule.from===from && rule.to===to && (rule.type||'references')===type.trim()))throw new Error('That group coverage rule already exists');
  config.groupLinks.push({from,to,type:type.trim()});await updateConfig(doc,config);return true;
}
async function addRule() {
  const folder=await chooseFolder(); if(!folder)return;
  const {doc,config}=await openConfig(folder);
  const choices=config.sources.map(s=>({label:s.name}));
  const from=await vscode.window.showQuickPick(choices,{placeHolder:'Select the covering source (for example, tests)'}); if(!from)return;
  const to=await vscode.window.showQuickPick(choices,{placeHolder:'Select the covered source (for example, requirements)'}); if(!to)return;
  const type=await vscode.window.showInputBox({title:'Link type',prompt:'For example: verifies, implements, or satisfies',value:'references',validateInput:v=>v.trim()?undefined:'Enter a link type'}); if(!type)return;
  config.links=config.links || [];
  if(config.links.some(r=>r.from===from.label && r.to===to.label && (r.type||'references')===type.trim()))throw new Error('That coverage rule already exists');
  config.links.push({from:from.label,to:to.label,type:type.trim()}); await updateConfig(doc,config);
}
async function updatePattern(folder, name, kind, expected, pattern) {
  if (!['artifact','reference'].includes(kind)) throw new Error('Unsupported pattern type');
  const {doc,config}=await openConfig(folder);
  const source=config.sources.find(item=>item.name===name);
  if (!source || source[kind]!==expected) throw new Error('Source configuration changed since the scan; refresh and try again');
  if (kind==='reference' && !pattern) delete source.reference;
  else source[kind]=pattern;
  await updateConfig(doc,config);
}
module.exports={createProject,openProject,saveProject,reloadProject,editProjectConfig,updateFromDashboard,addSource,assignGroup,addGroupRuleForFolder,addRule,updatePattern};
