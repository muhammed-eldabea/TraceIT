const vscode = require('vscode');
const path = require('path');
const engine = require('./engine');
const { renderDashboard } = require('./dashboard');
const { testRegex, testConfiguredRegex } = require('./regexTester');
const baseline = require('./baseline');
const { queryItems, queryAssociations, queryTrackerFields } = require('./codebeamer');
const {updateCodebeamerName,updateCodebeamerDescription}=require('./codebeamerWrite');
const { queryRequirements } = require('./oslc');
const {prepareDoorsTitleUpdate,applyDoorsTitleUpdate,prepareDoorsPrimaryTextUpdate,buildDoorsPrimaryTextUpdate}=require('./doorsNextWrite');
const { parseManualLinks, replaceManualLink } = require('./manualLinks');
const { exportMatrix } = require('./matrixExport');
const { matrixLink,matrixUnlink } = require('./matrixLink');
const { openPdfViewer } = require('./pdfViewer');
const { openWordViewer } = require('./wordViewer');
const { openWorkbookViewer } = require('./workbookViewer');
const { openPptxViewer } = require('./pptxViewer');
const projectSetup = require('./projectSetup');
const configEdit = require('./configEdit');
const { analyzeInWorker, extractInWorker } = require('./workerRunner');

const {buildProjectTree} = require('./tree');

class TraceProvider {
  constructor(secrets) { this.secrets = secrets; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; this.items = []; this.results = []; }
  getTreeItem(item) { return item; }
  getChildren(item) { return item ? item.children : this.items; }
  refresh() {
    const previous = this.refreshChain || Promise.resolve();
    this.refreshChain = previous.catch(() => {}).then(() => this.scan());
    return this.refreshChain;
  }
  async scan() {
    const items = [], results = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      try {
        const uri = vscode.Uri.joinPath(folder.uri, 'traceability.json');
        const configText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const config = JSON.parse(configText);
        engine.validate(config);
        const manualUri = vscode.Uri.joinPath(folder.uri, 'traceability-links.json');
        try { config.manualLinks = parseManualLinks(Buffer.from(await vscode.workspace.fs.readFile(manualUri)).toString('utf8')).links; }
        catch (error) { if (error.code !== 'FileNotFound') throw error; config.manualLinks = []; }
        const files = [], scanDiagnostics = [];
        for (const source of config.sources) {
          if (source.format === 'doors-next') {
            if (!source.connection || !source.queryUrl) throw new Error(`DOORS Next source ${source.name} needs connection and queryUrl`);
            const saved = await this.secrets.get(`reqtrace.doors-next.${source.connection}`);
            if (!saved) throw new Error(`No credentials for DOORS Next connection ${source.connection}; run Requirements: Configure DOORS Next Connection`);
            const result = await queryRequirements(source, JSON.parse(saved));
            files.push({source:source.name, ...result});
            continue;
          }
          if (source.format === 'codebeamer') {
            if (!source.connection) throw new Error(`Codebeamer source ${source.name} needs a connection name`);
            const saved = await this.secrets.get(`reqtrace.codebeamer.${source.connection}`);
            if (!saved) throw new Error(`No credentials for Codebeamer connection ${source.connection}; run Requirements: Configure Codebeamer Connection`);
            const credentials = JSON.parse(saved);
            const remoteItems = await queryItems(source, credentials);
            const relations = source.includeAssociations ? await queryAssociations(source, credentials, remoteItems) : [];
            if(relations.diagnostics) scanDiagnostics.push(...relations.diagnostics.map(message=>`${source.name}: ${message}`));
            files.push({source:source.name, items:remoteItems, relations});
            continue;
          }
          const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, source.include), vscode.workspace.getConfiguration('reqtrace', folder.uri).get('exclude'));
          if (!found.length) scanDiagnostics.push(`${source.name}: no files matched ${source.include}`);
          for (const file of found) {
            const relative = path.posix.relative(folder.uri.path, file.path);
            let bytes;
            try { bytes = await vscode.workspace.fs.readFile(file); }
            catch (error) { scanDiagnostics.push(`${source.name}: ${relative}: could not read file: ${error.message}`); continue; }
            if (bytes.length > (['reqif', 'reqifz', 'docx', 'xlsx', 'pdf', 'pptx', 'odt', 'csv', 'doors-classic-export'].includes(source.format) ? 20 : 1) * 1024 * 1024) { scanDiagnostics.push(`${source.name}: ${relative}: skipped because file exceeds the size limit`); continue; }
            if (source.format === 'odt') {
              try {
                const extracted=await extractInWorker('odt',bytes);
                const viewUri=vscode.Uri.from({scheme:'reqtrace-odt',path:'/extracted.txt',query:Buffer.from(file.toString(),'utf8').toString('base64url')}).toString();
                files.push({source:source.name,path:relative,...extracted,viewUri,originalUri:file.toString(),originalFormat:'odt'});
              } catch(error) { files.push({source:source.name,path:relative,text:'',diagnostics:[`OpenDocument import failed: ${error.message}`]}); }
              continue;
            }
            if (source.format === 'reqifz') {
              try {
                const extracted=await extractInWorker('reqifz',bytes);
                const viewUri=vscode.Uri.from({scheme:'reqtrace-reqifz',path:'/extracted.reqif',query:Buffer.from(file.toString(),'utf8').toString('base64url')}).toString();
                files.push({source:source.name,path:relative,text:extracted.text,viewUri});
              } catch(error) { scanDiagnostics.push(`${source.name}: ${relative}: ReqIFz import failed: ${error.message}`); }
              continue;
            }
            if (source.format === 'pptx') {
              try {
                const extracted=await extractInWorker('pptx',bytes);
                const viewUri=vscode.Uri.from({scheme:'reqtrace-pptx',path:'/extracted.txt',query:Buffer.from(file.toString(),'utf8').toString('base64url')}).toString();
                files.push({source:source.name,path:relative,...extracted,viewUri,originalUri:file.toString(),originalFormat:'pptx'});
              } catch(error) { files.push({source:source.name,path:relative,text:'',diagnostics:[`PowerPoint import failed: ${error.message}`]}); }
              continue;
            }
            if (source.format === 'pdf') {
              try {
                const extracted = await extractInWorker('pdf',bytes);
                const viewUri = vscode.Uri.from({scheme:'reqtrace-pdf', path:'/extracted.txt', query:Buffer.from(file.toString(), 'utf8').toString('base64url')}).toString();
                files.push({source:source.name, path:relative, ...extracted, viewUri, originalUri:file.toString()});
              } catch (error) { files.push({source:source.name, path:relative, text:'', diagnostics:[`PDF import failed: ${error.message}`]}); }
              continue;
            }
            if (source.format === 'xlsx') {
              try {
                const extracted = await extractInWorker('xlsx',bytes,source);
                const query = Buffer.from(JSON.stringify({uri:file.toString(),sheet:source.sheet}), 'utf8').toString('base64url');
                const viewUri = vscode.Uri.from({scheme:'reqtrace-xlsx', path:'/extracted.tsv', query}).toString();
                files.push({source:source.name, path:relative, text:extracted.text, lineLocations:extracted.lineLocations, viewUri, originalUri:file.toString(), originalFormat:'xlsx', diagnostics:extracted.diagnostics});
              } catch (error) { files.push({source:source.name, path:relative, text:'', diagnostics:[`Excel import failed: ${error.message}`]}); }
              continue;
            }
            if (source.format === 'docx') {
              try {
                const extracted = await extractInWorker('docx',bytes);
                const viewUri = vscode.Uri.from({scheme:'reqtrace-docx', path:'/extracted.txt', query:Buffer.from(file.toString(), 'utf8').toString('base64url')}).toString();
                files.push({source:source.name, path:relative, text:extracted.text, viewUri, originalUri:file.toString(), originalFormat:'docx', diagnostics:extracted.diagnostics});
              } catch (error) { files.push({source:source.name, path:relative, text:'', diagnostics:[`Word import failed: ${error.message}`]}); }
              continue;
            }
            if (bytes.includes(0)) { scanDiagnostics.push(`${source.name}: ${relative}: skipped binary file`); continue; }
            files.push({ source: source.name, path: relative, uri: file, text: Buffer.from(bytes).toString('utf8') });
          }
        }
        const result = await analyzeInWorker(config, files); result.diagnostics.unshift(...scanDiagnostics); results.push({ folder, result, config, configText, files });
        items.push(buildProjectTree(vscode,folder,config,result));
      } catch (error) {
        if (error.code !== 'FileNotFound') {const issue=new vscode.TreeItem(`${folder.name}: Could not load project`,vscode.TreeItemCollapsibleState.None);issue.description=error.message;issue.tooltip=`${error.message}\nOpen traceability.json to review the configuration.`;issue.iconPath=new vscode.ThemeIcon('error');issue.command={command:'vscode.open',title:'Open project configuration',arguments:[vscode.Uri.joinPath(folder.uri,'traceability.json')]};items.push(issue);}
      }
    }
    this.items = items; this.results = results;
    this.changed.fire();
  }
}
async function chooseProject(results) {
  if (!results.length) { vscode.window.showWarningMessage('No valid traceability project found.'); return; }
  if (results.length === 1) return results[0];
  const pick = await vscode.window.showQuickPick(results.map(value => ({ label: value.folder.name, value })), { placeHolder: 'Choose a workspace folder' });
  return pick && pick.value;
}
async function saveManualLinks(entry, links) {
  const uri = vscode.Uri.joinPath(entry.folder.uri, 'traceability-links.json');
  let current;
  try { current = parseManualLinks(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')).links; }
  catch (error) { if (error.code !== 'FileNotFound') throw error; current = []; }
  if (JSON.stringify(current) !== JSON.stringify(entry.config.manualLinks)) throw new Error('The manual link file changed since the last refresh; refresh and try again');
  const data = {version:1,links};
  parseManualLinks(JSON.stringify(data));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data,null,2)+'\n'));
}
function activate(context) {
  const provider = new TraceProvider(context.secrets);
  const regexOutput = vscode.window.createOutputChannel('Traceability Regex');
  context.subscriptions.push(regexOutput);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-odt', {
    async provideTextDocumentContent(uri) {
      try {const original=vscode.Uri.parse(Buffer.from(uri.query,'base64url').toString('utf8'));return (await extractInWorker('odt',await vscode.workspace.fs.readFile(original))).text;}
      catch(error){return `Unable to extract OpenDocument: ${error.message}`;}
    }
  }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-reqifz', {
    async provideTextDocumentContent(uri) {
      try {const original=vscode.Uri.parse(Buffer.from(uri.query,'base64url').toString('utf8'));return (await extractInWorker('reqifz',await vscode.workspace.fs.readFile(original))).text;}
      catch(error) {return `Unable to extract ReqIFz: ${error.message}`;}
    }
  }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-pptx', {
    async provideTextDocumentContent(uri) {
      try {const original=vscode.Uri.parse(Buffer.from(uri.query,'base64url').toString('utf8'));return (await extractInWorker('pptx',await vscode.workspace.fs.readFile(original))).text;}
      catch(error) {return `Unable to extract PowerPoint: ${error.message}`;}
    }
  }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-pdf', {
    async provideTextDocumentContent(uri) {
      try {
        const original = vscode.Uri.parse(Buffer.from(uri.query, 'base64url').toString('utf8'));
        return (await extractInWorker('pdf',await vscode.workspace.fs.readFile(original))).text;
      } catch (error) { return `Unable to extract PDF: ${error.message}`; }
    }
  }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-xlsx', {
    async provideTextDocumentContent(uri) {
      try {
        const options = JSON.parse(Buffer.from(uri.query, 'base64url').toString('utf8'));
        return (await extractInWorker('xlsx',await vscode.workspace.fs.readFile(vscode.Uri.parse(options.uri)),options)).text;
      } catch (error) { return `Unable to extract workbook: ${error.message}`; }
    }
  }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('reqtrace-docx', {
    async provideTextDocumentContent(uri) {
      try {
        const original = vscode.Uri.parse(Buffer.from(uri.query, 'base64url').toString('utf8'));
        return (await extractInWorker('docx',await vscode.workspace.fs.readFile(original))).text;
      } catch (error) { return `Unable to extract Word document: ${error.message}`; }
    }
  }));
  let dashboard, matrixSavePending=false, projectEditPending=false;
  const updateDashboard = () => { if (dashboard) dashboard.webview.html = renderDashboard(provider.results); };
  context.subscriptions.push(provider.changed.event(updateDashboard));
  context.subscriptions.push(provider.changed, vscode.window.registerTreeDataProvider('requirementsTraceability', provider),
    vscode.commands.registerCommand('reqtrace.openPptxViewer', (uri,slide) => openPptxViewer(context,uri,slide)),
    vscode.commands.registerCommand('reqtrace.openWorkbookViewer', (uri,location) => openWorkbookViewer(context,uri,location)),
    vscode.commands.registerCommand('reqtrace.openWordViewer', uri => openWordViewer(context,uri)),
    vscode.commands.registerCommand('reqtrace.openPdfViewer', (uri,page) => openPdfViewer(context,uri,page)),
    vscode.commands.registerCommand('reqtrace.exportGroupDiagram', async project => {
      try {
        const entry=typeof project==='string' ? provider.results.find(item=>item.folder.uri.toString()===project) : await chooseProject(provider.results);if(!entry)return;
        const svg=require('./graph').exportGroupGraphSvg(entry.result);
        const target=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.joinPath(entry.folder.uri,'traceability-groups.svg'),filters:{SVG:['svg']}});if(!target)return;
        await vscode.workspace.fs.writeFile(target,Buffer.from(svg,'utf8'));
        vscode.window.showInformationMessage('Document group diagram saved.');
      } catch(error){vscode.window.showErrorMessage(`Could not export document group diagram: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.getStarted', () => vscode.commands.executeCommand('workbench.action.openWalkthrough',`${context.extension.id}#getStarted`,false)),
    vscode.commands.registerCommand('reqtrace.openProject', async () => { try { await projectSetup.openProject(); } catch(error) { vscode.window.showErrorMessage(`Could not open traceability project: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.saveProject', async () => { try { await projectSetup.saveProject(()=>provider.refresh()); } catch(error) { vscode.window.showErrorMessage(`Could not save project: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.reloadProject', async () => { try { await projectSetup.reloadProject(()=>provider.refresh()); } catch(error) { vscode.window.showErrorMessage(`Could not reload project: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.editProjectConfig', async () => { try { await projectSetup.editProjectConfig(); } catch(error) { vscode.window.showErrorMessage(`Could not open project configuration: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.createProject', async () => { try { await projectSetup.createProject(); await provider.refresh(); } catch(error) { vscode.window.showErrorMessage(`Project setup failed: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.addSource', async () => { try { await projectSetup.addSource(); await provider.refresh(); } catch(error) { vscode.window.showErrorMessage(`Could not add source: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.assignGroup', async () => { try { await projectSetup.assignGroup(); await provider.refresh(); } catch(error) { vscode.window.showErrorMessage(`Could not organize document groups: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.addRule', async () => { try { await projectSetup.addRule(); await provider.refresh(); } catch(error) { vscode.window.showErrorMessage(`Could not add rule: ${error.message}`); } }),
    vscode.commands.registerCommand('reqtrace.openDoorsClassicBridge', async () => {
      const file=vscode.Uri.joinPath(context.extensionUri,'resources','doors-classic','export-current-module.dxl');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }),
    vscode.commands.registerCommand('reqtrace.configureDoorsNext', async () => {
      const name = await vscode.window.showInputBox({title:'DOORS Next connection name', prompt:'Use this name in traceability.json', ignoreFocusOut:true});
      if (!name || !name.trim()) return;
      const server = await vscode.window.showInputBox({title:'DOORS Next server origin',prompt:'HTTPS origin, for example https://doors.example.com',ignoreFocusOut:true});
      if (!server) return;
      let origin;
      try { const url = new URL(server); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(); origin = url.origin; }
      catch (_) { vscode.window.showErrorMessage('Enter an HTTPS origin without a path, credentials, query, or fragment.'); return; }
      const selection = await vscode.window.showQuickPick([{label:'Username and password',kind:'basic'}, {label:'Bearer token',kind:'bearer'}], {placeHolder:'Choose authentication supported by your server'});
      if (!selection) return;
      let username;
      if (selection.kind === 'basic') { username = await vscode.window.showInputBox({title:'DOORS Next username',ignoreFocusOut:true}); if (!username) return; }
      const secret = await vscode.window.showInputBox({title:selection.kind === 'basic' ? 'DOORS Next password' : 'DOORS Next bearer token',password:true,ignoreFocusOut:true});
      if (!secret) return;
      await context.secrets.store(`reqtrace.doors-next.${name.trim()}`, JSON.stringify({kind:selection.kind,username,secret,origin}));
      vscode.window.showInformationMessage(`DOORS Next connection ${name.trim()} saved in VS Code secret storage.`);
    }),
    vscode.commands.registerCommand('reqtrace.configureCodebeamer', async () => {
      const name = await vscode.window.showInputBox({title:'Codebeamer connection name', prompt:'Use this name in traceability.json', ignoreFocusOut:true});
      if (!name || !name.trim()) return;
      const baseUrl = await vscode.window.showInputBox({title:'Codebeamer base URL', prompt:'HTTPS URL including the Codebeamer context path, for example https://server/cb', ignoreFocusOut:true});
      if (!baseUrl) return;
      try { const url = new URL(baseUrl); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(); }
      catch (_) { vscode.window.showErrorMessage('Enter an HTTPS base URL without credentials, query, or fragment.'); return; }
      const selection = await vscode.window.showQuickPick([{label:'Username and password',kind:'basic'}, {label:'Bearer token',kind:'bearer'}], {placeHolder:'Choose authentication supported by your server'});
      if (!selection) return;
      let username;
      if (selection.kind === 'basic') { username = await vscode.window.showInputBox({title:'Codebeamer username',ignoreFocusOut:true}); if (!username) return; }
      const secret = await vscode.window.showInputBox({title:selection.kind === 'basic' ? 'Codebeamer password' : 'Codebeamer bearer token',password:true,ignoreFocusOut:true});
      if (!secret) return;
      await context.secrets.store(`reqtrace.codebeamer.${name.trim()}`, JSON.stringify({baseUrl,kind:selection.kind,username,secret}));
      vscode.window.showInformationMessage(`Codebeamer connection ${name.trim()} saved in VS Code secret storage.`);
    }),
    vscode.commands.registerCommand('reqtrace.updateDoorsNextPrimaryText', async () => {
      await provider.refresh();const entry=await chooseProject(provider.results);if(!entry)return;
      const sources=new Map(entry.config.sources.filter(source=>source.format==='doors-next').map(source=>[source.name,source]));
      const choices=entry.result.artifacts.filter(item=>sources.has(item.source) && typeof item.externalId==='string').map(item=>({label:item.id,description:item.title,detail:item.source,artifact:item}));
      if(!choices.length)return vscode.window.showWarningMessage('No imported DOORS Next requirements are available.');
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Choose a DOORS Next requirement to edit',matchOnDescription:true});if(!selected)return;
      try {
        const item=selected.artifact,source=sources.get(item.source),saved=await context.secrets.get(`reqtrace.doors-next.${source.connection}`);if(!saved)throw new Error(`No credentials for connection ${source.connection}`);
        const credentials=JSON.parse(saved);const plan=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Reading DOORS Next text for ${item.id}`},()=>prepareDoorsPrimaryTextUpdate(source,credentials,{uri:item.externalId,expectedText:item.text}));
        if(!plan.segments.length)throw new Error('No editable primary-text segments were found');
        const pick=await vscode.window.showQuickPick(plan.segments.map(segment=>({label:segment.text.replace(/[\r\n\t]/g,' ').slice(0,200),description:`Text segment ${segment.index+1}`,segment})),{placeHolder:'Select a text segment; formatting can split a sentence'});if(!pick)return;
        const newText=await vscode.window.showInputBox({title:`Replacement text for ${item.id}`,value:pick.segment.text,prompt:'Enter one line. Existing formatting around this segment is retained.'});if(newText===undefined||newText===pick.segment.text)return;
        const update=buildDoorsPrimaryTextUpdate(plan,pick.segment.index,pick.segment.text,newText);
        const action='Update in DOORS Next';const confirmation=await vscode.window.showWarningMessage(`Update a text segment in ${item.id}?\nCurrent: ${pick.segment.text}\nNew: ${newText}`,{modal:true},action);if(confirmation!==action)return;
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Updating ${item.id} in DOORS Next`},()=>applyDoorsTitleUpdate(credentials,update));
        await provider.refresh();vscode.window.showInformationMessage('DOORS Next primary-text segment updated.');
      }catch(error){vscode.window.showErrorMessage(`Could not update DOORS Next primary text: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.updateDoorsNextTitle', async () => {
      await provider.refresh();const entry=await chooseProject(provider.results);if(!entry)return;
      const sources=new Map(entry.config.sources.filter(source=>source.format==='doors-next').map(source=>[source.name,source]));
      const choices=entry.result.artifacts.filter(item=>sources.has(item.source) && typeof item.externalId==='string').map(item=>({label:item.id,description:item.title,detail:item.source,artifact:item}));
      if(!choices.length)return vscode.window.showWarningMessage('No imported DOORS Next requirements are available.');
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Choose a DOORS Next requirement to rename',matchOnDescription:true});if(!selected)return;
      try {
        const item=selected.artifact,source=sources.get(item.source),saved=await context.secrets.get(`reqtrace.doors-next.${source.connection}`);if(!saved)throw new Error(`No credentials for connection ${source.connection}`);
        const credentials=JSON.parse(saved);const newTitle=await vscode.window.showInputBox({title:`New title for ${item.id}`,value:item.title,validateInput:value=>value.trim() && value.length<=4096 && !/[\r\n]/.test(value)?undefined:'Enter a nonempty single-line title of at most 4096 characters'});if(newTitle===undefined||newTitle===item.title)return;
        const plan=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Preparing DOORS Next update for ${item.id}`},()=>prepareDoorsTitleUpdate(source,credentials,{uri:item.externalId,expectedTitle:item.title,newTitle}));
        const action='Update in DOORS Next';const confirmation=await vscode.window.showWarningMessage(`Update ${item.id} in DOORS Next?\nCurrent: ${item.title}\nNew: ${newTitle}`,{modal:true},action);if(confirmation!==action)return;
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Updating ${item.id} in DOORS Next`},()=>applyDoorsTitleUpdate(credentials,plan));
        await provider.refresh();vscode.window.showInformationMessage('DOORS Next requirement title updated.');
      }catch(error){vscode.window.showErrorMessage(`Could not update DOORS Next requirement: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.updateCodebeamerDescription', async () => {
      await provider.refresh();const entry=await chooseProject(provider.results);if(!entry)return;
      const sources=new Map(entry.config.sources.filter(source=>source.format==='codebeamer').map(source=>[source.name,source]));
      const choices=entry.result.artifacts.filter(item=>sources.has(item.source) && item.trackerId && item.descriptionAvailable && Number.isSafeInteger(item.attributes?.version) && ['Wiki','PlainText'].includes(item.attributes?.descriptionFormat)).map(item=>({label:item.id,description:item.title,detail:`${item.source} · ${item.attributes.descriptionFormat} · version ${item.attributes.version}`,artifact:item}));
      if(!choices.length)return vscode.window.showWarningMessage('No Codebeamer items with a supported description, tracker ID, and numeric version are available.');
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Choose a Codebeamer item to edit',matchOnDescription:true});if(!selected)return;
      try {
        const item=selected.artifact,source=sources.get(item.source),saved=await context.secrets.get(`reqtrace.codebeamer.${source.connection}`);if(!saved)throw new Error(`No credentials for connection ${source.connection}`);
        const credentials=JSON.parse(saved),fields=await queryTrackerFields(credentials,item.trackerId);
        const pick=await vscode.window.showQuickPick(fields.map(field=>({label:field.name,description:`ID ${field.id}`,field})),{placeHolder:'Select the tracker field used for the item description'});if(!pick)return;
        const field=await queryTrackerFields(credentials,item.trackerId,String(pick.field.id));
        if(field.trackerItemField!=='description'||field.valueModel!=='WikiTextFieldValue'||field.hidden===true)throw new Error('Select the visible field mapped to the item description');
        const draft=await vscode.workspace.openTextDocument({language:'plaintext',content:item.text});await vscode.window.showTextDocument(draft);
        const review='Review update';const choice=await vscode.window.showInformationMessage(`Edit the ${item.attributes.descriptionFormat} description in the open document, then select Review update.`,review,'Cancel');if(choice!==review)return;
        const proposed=draft.getText();if(proposed===item.text)return;if(proposed.length>1000000)throw new Error('Description exceeds the 1,000,000-character limit');
        const original=await vscode.workspace.openTextDocument({language:'plaintext',content:item.text});await vscode.commands.executeCommand('vscode.diff',original.uri,draft.uri,`Codebeamer ${item.id}: current ↔ proposed`);
        const action='Update in Codebeamer';const confirmation=await vscode.window.showWarningMessage(`Review the diff, then update ${item.id} in Codebeamer? The existing ${item.attributes.descriptionFormat} format will be retained.`,action,'Cancel');if(confirmation!==action)return;
        if(draft.getText()!==proposed || original.getText()!==item.text)throw new Error('The preview changed after review; restart the update');
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Updating ${item.id} in Codebeamer`},()=>updateCodebeamerDescription(credentials,{itemId:item.id,trackerId:item.trackerId,expectedVersion:item.attributes.version,expectedText:item.text,expectedFormat:item.attributes.descriptionFormat,newText:proposed,fieldId:String(field.id),fieldName:field.name}));
        await provider.refresh();vscode.window.showInformationMessage('Codebeamer item description updated.');
      } catch(error){vscode.window.showErrorMessage(`Could not update Codebeamer description: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.updateCodebeamerName', async () => {
      await provider.refresh();const entry=await chooseProject(provider.results);if(!entry)return;
      const sources=new Map(entry.config.sources.filter(source=>source.format==='codebeamer').map(source=>[source.name,source]));
      const choices=entry.result.artifacts.filter(item=>sources.has(item.source) && item.trackerId && Number.isSafeInteger(item.attributes?.version)).map(item=>({label:item.id,description:item.title,detail:`${item.source} · version ${item.attributes.version}`,artifact:item}));
      if(!choices.length)return vscode.window.showWarningMessage('No Codebeamer items with tracker IDs and numeric versions are available.');
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Choose a Codebeamer item to rename',matchOnDescription:true});if(!selected)return;
      try {
        const item=selected.artifact,source=sources.get(item.source),saved=await context.secrets.get(`reqtrace.codebeamer.${source.connection}`);if(!saved)throw new Error(`No credentials for connection ${source.connection}`);
        const credentials=JSON.parse(saved),fields=await queryTrackerFields(credentials,item.trackerId);
        const pick=await vscode.window.showQuickPick(fields.map(field=>({label:field.name,description:`ID ${field.id}`,field})),{placeHolder:'Select the tracker field used for the item name'});if(!pick)return;
        const field=await queryTrackerFields(credentials,item.trackerId,String(pick.field.id));
        if(field.trackerItemField!=='name'||field.valueModel!=='TextFieldValue'||field.hidden===true)throw new Error('Select the visible text field mapped to the item name');
        const newName=await vscode.window.showInputBox({title:`New name for ${item.id}`,value:item.title,validateInput:value=>value.trim() && value.length<=4096 ? undefined : 'Enter a nonempty name of at most 4096 characters'});if(newName===undefined||newName===item.title)return;
        const action='Update in Codebeamer';const confirmation=await vscode.window.showWarningMessage(`Update ${item.id} in Codebeamer?\nCurrent: ${item.title}\nNew: ${newName}`,{modal:true},action);if(confirmation!==action)return;
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Updating ${item.id} in Codebeamer`},()=>updateCodebeamerName(credentials,{itemId:item.id,trackerId:item.trackerId,expectedVersion:item.attributes.version,expectedName:item.title,newName,fieldId:String(field.id),fieldName:field.name}));
        await provider.refresh();vscode.window.showInformationMessage('Codebeamer item name updated.');
      } catch(error){vscode.window.showErrorMessage(`Could not update Codebeamer item: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.inspectCodebeamerFields', async () => {
      await provider.refresh();const entry=await chooseProject(provider.results);if(!entry)return;
      const sources=new Map(entry.config.sources.filter(source=>source.format==='codebeamer').map(source=>[source.name,source]));
      const choices=entry.result.artifacts.filter(item=>sources.has(item.source) && item.trackerId).map(item=>({label:item.id,description:item.title,detail:`${item.source} · tracker ${item.trackerId}`,artifact:item}));
      if(!choices.length)return vscode.window.showWarningMessage('No imported Codebeamer items with tracker IDs are available.');
      const selected=await vscode.window.showQuickPick(choices,{placeHolder:'Select a Codebeamer item to inspect its tracker fields',matchOnDescription:true});if(!selected)return;
      try {
        const source=sources.get(selected.artifact.source),saved=await context.secrets.get(`reqtrace.codebeamer.${source.connection}`);
        if(!saved)throw new Error(`No credentials for connection ${source.connection}`);
        const credentials=JSON.parse(saved),fields=await queryTrackerFields(credentials,selected.artifact.trackerId);
        const pick=await vscode.window.showQuickPick(fields.map(field=>({label:field.name,description:`ID ${field.id}`,detail:field.type,field})),{placeHolder:'Select a field to inspect its definition'});if(!pick)return;
        const definition=await queryTrackerFields(credentials,selected.artifact.trackerId,String(pick.field.id));
        const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(definition,null,2)+'\n'});await vscode.window.showTextDocument(doc);
      } catch(error){vscode.window.showErrorMessage(`Could not inspect Codebeamer fields: ${error.message}`);}
    }),
    vscode.commands.registerCommand('reqtrace.addLink', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      const rules = entry.config.links || [];
      if (!rules.length) return vscode.window.showWarningMessage('Configure a link rule in traceability.json first.');
      const rulePick = await vscode.window.showQuickPick(rules.map(rule => ({label:`${rule.from} → ${rule.to}`,description:rule.type || 'references',rule})), {placeHolder:'Select the direction and link type'});
      if (!rulePick) return;
      const rule = rulePick.rule;
      const pickArtifact = async (source, label) => vscode.window.showQuickPick(entry.result.artifacts.filter(a => a.source === source).map(a => ({label:a.id,description:a.title,detail:a.path,artifact:a})), {placeHolder:label,matchOnDescription:true});
      const from = await pickArtifact(rule.from, 'Select the covering artifact'); if (!from) return;
      const to = await pickArtifact(rule.to, 'Select the covered artifact'); if (!to) return;
      const unique = artifact => entry.result.artifacts.filter(a => a.source === artifact.source && a.id === artifact.id).length === 1;
      if (!unique(from.artifact) || !unique(to.artifact)) return vscode.window.showErrorMessage('Cannot link an ambiguous artifact ID. Resolve duplicate IDs first.');
      const record = {from:{source:rule.from,id:from.artifact.id},to:{source:rule.to,id:to.artifact.id},type:rule.type || 'references'};
      const data = {version:1,links:[...entry.config.manualLinks,record]};
      try {
        await saveManualLinks(entry,data.links);
        await provider.refresh(); vscode.window.showInformationMessage('Manual trace link added.');
      } catch (error) { vscode.window.showErrorMessage(`Could not add manual link: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.editLink', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      const records = entry.config.manualLinks;
      if (!records.length) return vscode.window.showInformationMessage('There are no manual trace links to edit.');
      const selected = await vscode.window.showQuickPick(records.map((record,index) => ({label:`${record.from.source}/${record.from.id} → ${record.to.source}/${record.to.id}`,description:record.type,index})), {placeHolder:'Select a manual link to edit'});
      if (!selected) return;
      const rules = entry.config.links || [];
      if (!rules.length) return vscode.window.showWarningMessage('Configure a link rule in traceability.json first.');
      const rulePick = await vscode.window.showQuickPick(rules.map(rule => ({label:`${rule.from} → ${rule.to}`,description:rule.type || 'references',rule})), {placeHolder:'Choose the new direction and link type'});
      if (!rulePick) return;
      const rule = rulePick.rule;
      const pickArtifact = async (source,label) => vscode.window.showQuickPick(entry.result.artifacts.filter(a => a.source === source).map(a => ({label:a.id,description:a.title,detail:a.path,artifact:a})), {placeHolder:label,matchOnDescription:true});
      const from = await pickArtifact(rule.from,'Select the covering artifact'); if (!from) return;
      const to = await pickArtifact(rule.to,'Select the covered artifact'); if (!to) return;
      const unique = artifact => entry.result.artifacts.filter(a => a.source === artifact.source && a.id === artifact.id).length === 1;
      if (!unique(from.artifact) || !unique(to.artifact)) return vscode.window.showErrorMessage('Cannot link an ambiguous artifact ID. Resolve duplicate IDs first.');
      const replacement = {from:{source:rule.from,id:from.artifact.id},to:{source:rule.to,id:to.artifact.id},type:rule.type || 'references'};
      try {
        const links = replaceManualLink(records,selected.index,replacement);
        await saveManualLinks(entry,links); await provider.refresh();
        vscode.window.showInformationMessage('Manual trace link updated. Links discovered in source documents remain.');
      } catch (error) { vscode.window.showErrorMessage(`Could not edit manual link: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.removeLink', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      const records = entry.config.manualLinks;
      if (!records.length) return vscode.window.showInformationMessage('There are no manual trace links to remove.');
      const pick = await vscode.window.showQuickPick(records.map((record,index) => ({label:`${record.from.source}/${record.from.id} → ${record.to.source}/${record.to.id}`,description:record.type,index})), {placeHolder:'Select a manual link to remove'});
      if (!pick) return;
      const links = records.filter((_,index) => index !== pick.index);
      try { await saveManualLinks(entry,links); await provider.refresh(); vscode.window.showInformationMessage('Manual trace link removed. Links discovered in source documents remain.'); }
      catch (error) { vscode.window.showErrorMessage(`Could not remove manual link: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('reqtrace.baseline', async () => {
      await provider.refresh();
      const entry = await chooseProject(provider.results);
      if (!entry) return;
      const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(entry.folder.uri, 'traceability-baseline.json'), filters: { JSON: ['json'] } });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(baseline.snapshot(entry.result, entry.folder.name), null, 2), 'utf8'));
      vscode.window.showInformationMessage('Traceability baseline saved.');
    }),
    vscode.commands.registerCommand('reqtrace.previewBaseline', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      const selected = await vscode.window.showOpenDialog({canSelectMany:false,filters:{JSON:['json']},openLabel:'Compare baseline'});
      if (!selected) return;
      try {
        const old = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(selected[0])).toString('utf8'));
        const current = baseline.snapshot(entry.result,entry.folder.name);
        const diff = baseline.compare(old,current);
        const panel = vscode.window.createWebviewPanel('reqtraceBaseline','Baseline comparison',vscode.ViewColumn.One,{enableScripts:false});
        panel.webview.html = baseline.renderComparison(diff,old,current);
      } catch (error) { vscode.window.showErrorMessage(`Baseline comparison failed: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.compareBaseline', async () => {
      await provider.refresh();
      const entry = await chooseProject(provider.results);
      if (!entry) return;
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] }, openLabel: 'Compare baseline' });
      if (!selected) return;
      try {
        const old = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(selected[0])).toString('utf8'));
        const current = baseline.snapshot(entry.result, entry.folder.name);
        const diff = baseline.compare(old, current);
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(entry.folder.uri, 'baseline-comparison.html'), filters: { HTML: ['html'] } });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, Buffer.from(baseline.renderComparison(diff, old, current), 'utf8'));
        vscode.window.showInformationMessage(`Baseline comparison saved; ${diff.suspiciousLinks.length} links need review.`);
      } catch (error) { vscode.window.showErrorMessage(`Baseline comparison failed: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.testConfiguredRegex', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      const supported = entry.config.sources.filter(source => ['text','docx','xlsx','pdf','pptx','odt',undefined].includes(source.format));
      const sourcePick = await vscode.window.showQuickPick(supported.map(source=>({label:source.name,description:source.format || 'text',source})), {placeHolder:'Choose a regex-based source'});
      if (!sourcePick) return;
      const available = entry.files.filter(file=>file.source===sourcePick.source.name && typeof file.text==='string');
      if (!available.length) return vscode.window.showWarningMessage('No files were loaded for that source. Check the configured glob and diagnostics.');
      const filePick = await vscode.window.showQuickPick(available.map(file=>({label:file.path,description:file.diagnostics && file.diagnostics.length ? 'Has extraction diagnostics' : '',file})),{placeHolder:'Choose a document to test'});
      if (!filePick) return;
      const kindPick = await vscode.window.showQuickPick([{label:'Artifact pattern',kind:'artifact'},{label:'Reference pattern',kind:'reference'}],{placeHolder:'Choose the pattern to test'});
      if (!kindPick) return;
      await testConfiguredRegex(regexOutput,{file:filePick.file,source:sourcePick.source,kind:kindPick.kind}, async pattern => {
        await projectSetup.updatePattern(entry.folder,sourcePick.source.name,kindPick.kind,sourcePick.source[kindPick.kind],pattern);
        await provider.refresh();
      });
    }),
    vscode.commands.registerCommand('reqtrace.testRegex', () => testRegex(regexOutput)),
    vscode.commands.registerCommand('reqtrace.dashboard', async () => {
      if (dashboard) { dashboard.reveal(); return; }
      dashboard = vscode.window.createWebviewPanel('reqtraceDashboard', 'Traceability', vscode.ViewColumn.One, { enableScripts: true });
      dashboard.onDidDispose(() => { dashboard = undefined; }, null, context.subscriptions);
      dashboard.webview.onDidReceiveMessage(async message => {
        if (message.command === 'refresh') await provider.refresh();
        else if (message.command === 'report') await vscode.commands.executeCommand('reqtrace.report');
        else if (message.command === 'matrix') await vscode.commands.executeCommand('reqtrace.exportMatrix');
        else if (message.command === 'exportGroupDiagram' && typeof message.project==='string') await vscode.commands.executeCommand('reqtrace.exportGroupDiagram',message.project);
        else if (message.command === 'baseline') await vscode.commands.executeCommand('reqtrace.previewBaseline');
        else if (message.command === 'saveConfig' && Number.isInteger(message.folder) && typeof message.text==='string' && typeof message.version==='string') {
          const entry=provider.results[message.folder];if(!entry)return;
          try {if(require('crypto').createHash('sha256').update(entry.configText).digest('hex')!==message.version)throw new Error('Project configuration changed since the dashboard was loaded; refresh and try again');await projectSetup.updateFromDashboard(entry.folder,entry.configText,message.text);await provider.refresh();if(dashboard)await dashboard.webview.postMessage({command:'configSaved',folder:message.folder});}
          catch(error){vscode.window.showErrorMessage(`Could not save project configuration: ${error.message}`);}
        }
        else if (message.command==='editProject' && Number.isInteger(message.folder) && typeof message.version==='string' && message.edit && typeof message.edit==='object') {
          if(projectEditPending)return;
          projectEditPending=true;
          const reportFailure=text=>dashboard && dashboard.webview.postMessage({command:'editFailed',folder:message.folder,message:text});
          try {
            const entry=provider.results[message.folder];
            if(!entry)throw new Error('Project is no longer loaded; refresh the dashboard');
            if(require('crypto').createHash('sha256').update(entry.configText).digest('hex')!==message.version)throw new Error('Project configuration changed since the dashboard was loaded; refresh and try again');
            const edit=configEdit.applyEdit(entry.configText,message.edit);
            if(message.edit.op==='removeSource'){
              const detail=edit.removedRules.length ? `\n\nThese coverage rules also stop applying:\n${edit.removedRules.join('\n')}` : '';
              const choice=await vscode.window.showWarningMessage(`Remove source ${message.edit.name} from the project?${detail}\n\nThe document itself is not deleted.`,{modal:true},'Remove Source');
              if(choice!=='Remove Source'){reportFailure('Removal cancelled');return;}
            }
            await projectSetup.updateFromDashboard(entry.folder,entry.configText,edit.text);
            await provider.refresh();
          } catch(error) { reportFailure(error.message); vscode.window.showErrorMessage(`Could not update project: ${error.message}`); }
          finally { projectEditPending=false; }
        }
        else if (message.command==='connectGroups' && typeof message.project==='string' && typeof message.from==='string' && typeof message.to==='string') {
          const entry=provider.results.find(item=>item.folder.uri.toString()===message.project);if(!entry)return;
          try{if(await projectSetup.addGroupRuleForFolder(entry.folder,message.from,message.to))await provider.refresh();}catch(error){vscode.window.showErrorMessage(`Could not connect document groups: ${error.message}`);}
        }
        else if (['addSource','assignGroup','addRule','testRegex','doorsNext','codebeamer','doorsClassic'].includes(message.command)) {
          const commands={addSource:'reqtrace.addSource',assignGroup:'reqtrace.assignGroup',addRule:'reqtrace.addRule',testRegex:'reqtrace.testConfiguredRegex',doorsNext:'reqtrace.configureDoorsNext',codebeamer:'reqtrace.configureCodebeamer',doorsClassic:'reqtrace.openDoorsClassicBridge'};
          await vscode.commands.executeCommand(commands[message.command]);
        }
        else if (['matrixAdd','matrixRemove'].includes(message.command) && typeof message.project==='string') {
          if(matrixSavePending)return;
          matrixSavePending=true;
          try {
            const locate=()=>provider.results.find(item=>item.folder.uri.toString()===message.project);
            let entry=locate();if(!entry)throw new Error('The matrix project is no longer open');
            const request={from:message.from,to:message.to,type:message.type};
            const remove=message.command==='matrixRemove';
            if(remove)matrixUnlink(entry,request);else matrixLink(entry,request);
            await provider.refresh();entry=locate();if(!entry)throw new Error('The matrix project could not be refreshed');
            const links=remove ? matrixUnlink(entry,request) : [...entry.config.manualLinks,matrixLink(entry,request)];
            await saveManualLinks(entry,links);
            await provider.refresh();vscode.window.showInformationMessage(remove ? 'Manual link removed. Links found in source data remain.' : 'Manual trace link added from matrix.');
          } catch(error) {vscode.window.showErrorMessage(`Could not update matrix link: ${error.message}`);}
          finally {matrixSavePending=false;}
        }
        else if (message.command === 'impact' && Number.isInteger(message.folder) && Number.isInteger(message.artifact) && Number.isInteger(message.request)) {
          const entry = provider.results[message.folder];
          const artifact = entry && entry.result.artifacts[message.artifact];
          if (artifact && dashboard) {
            const indices = new Map(entry.result.artifacts.map((item,index)=>[item,index]));
            const affected = engine.impact(entry.result,artifact).map(item=>({id:item.artifact.id,title:item.artifact.title,type:item.type,via:item.via.id,depth:item.depth,index:indices.get(item.artifact)}));
            await dashboard.webview.postMessage({command:'impactResult',request:message.request,folder:message.folder,id:artifact.id,items:affected});
          }
        }
        else if (message.command === 'pptx' && Number.isInteger(message.folder) && Number.isInteger(message.artifact)) {
          const entry=provider.results[message.folder];const artifact=entry && entry.result.artifacts[message.artifact];
          if(artifact && artifact.originalFormat==='pptx' && artifact.originalUri)await vscode.commands.executeCommand('reqtrace.openPptxViewer',vscode.Uri.parse(artifact.originalUri),artifact.slide);
        }
        else if (message.command === 'xlsx' && Number.isInteger(message.folder) && Number.isInteger(message.artifact)) {
          const entry=provider.results[message.folder]; const artifact=entry && entry.result.artifacts[message.artifact];
          if(artifact && artifact.originalFormat==='xlsx' && artifact.originalUri) await vscode.commands.executeCommand('reqtrace.openWorkbookViewer',vscode.Uri.parse(artifact.originalUri),artifact.workbookLocation);
        }
        else if (message.command === 'word' && Number.isInteger(message.folder) && Number.isInteger(message.artifact)) {
          const entry=provider.results[message.folder]; const artifact=entry && entry.result.artifacts[message.artifact];
          if(artifact && artifact.originalFormat==='docx' && artifact.originalUri) await vscode.commands.executeCommand('reqtrace.openWordViewer',vscode.Uri.parse(artifact.originalUri));
        }
        else if (message.command === 'pdf' && Number.isInteger(message.folder) && Number.isInteger(message.artifact)) {
          const entry = provider.results[message.folder];
          const artifact = entry && entry.result.artifacts[message.artifact];
          if (artifact && artifact.originalUri && artifact.page) await vscode.commands.executeCommand('reqtrace.openPdfViewer',vscode.Uri.parse(artifact.originalUri),artifact.page);
        }
        else if (message.command === 'open' && Number.isInteger(message.folder) && Number.isInteger(message.artifact)) {
          const entry = provider.results[message.folder];
          const artifact = entry && entry.result.artifacts[message.artifact];
          if (artifact) await vscode.commands.executeCommand('reqtrace.openReference', artifact.url ? vscode.Uri.parse(artifact.url) : artifact.viewUri ? vscode.Uri.parse(artifact.viewUri) : vscode.Uri.joinPath(entry.folder.uri, artifact.path), artifact.line - 1);
        }
      }, null, context.subscriptions);
      updateDashboard();
      await provider.refresh();
    }),
    vscode.commands.registerCommand('reqtrace.exportMatrix', async () => {
      await provider.refresh(); const entry = await chooseProject(provider.results); if (!entry) return;
      if (!entry.result.coverage.length) return vscode.window.showWarningMessage('Configure a coverage rule before exporting a matrix.');
      const pick = await vscode.window.showQuickPick(entry.result.coverage.map(rule=>({label:`${rule.from} → ${rule.to}`,description:rule.type,detail:`${rule.covered}/${rule.total} targets linked`,rule})),{placeHolder:'Choose a coverage rule'});
      if (!pick) return;
      try {
        const csv = exportMatrix(entry.result,pick.rule);
        const target = await vscode.window.showSaveDialog({defaultUri:vscode.Uri.joinPath(entry.folder.uri,'traceability-matrix.csv'),filters:{CSV:['csv']}});
        if (!target) return;
        await vscode.workspace.fs.writeFile(target,Buffer.from(csv,'utf8'));
        vscode.window.showInformationMessage(`Traceability matrix saved: ${target.fsPath}`);
      } catch (error) { vscode.window.showErrorMessage(`Could not export matrix: ${error.message}`); }
    }),
    vscode.commands.registerCommand('reqtrace.report', async () => {
      await provider.refresh();
      if (!provider.results.length) return vscode.window.showWarningMessage('No valid traceability.json found in an open workspace folder.');
      let selected = provider.results[0];
      if (provider.results.length > 1) { const pick = await vscode.window.showQuickPick(provider.results.map(r => ({ label: r.folder.name, value: r })), { placeHolder: 'Choose a workspace folder' }); if (!pick) return; selected = pick.value; }
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(selected.folder.uri, 'traceability-report.html'), filters: { HTML: ['html'] } });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(engine.report(selected.result), 'utf8'));
      vscode.window.showInformationMessage(`Traceability report saved: ${target.fsPath}`);
    }),
    vscode.commands.registerCommand('reqtrace.openReference', async (uri, line) => { if (uri.scheme === 'https') { await vscode.env.openExternal(uri); return; } const editor = await vscode.window.showTextDocument(uri); const position = new vscode.Position(line, 0); editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter); }));
  provider.refresh();
  return {getAnalysisSummary: () => provider.results.map(({folder,result})=>({folder:folder.name,artifacts:result.artifacts.length,links:result.links.length,diagnostics:result.diagnostics.length,unresolved:result.unresolved.length}))};
}
exports.activate = activate;
