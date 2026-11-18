'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const actualLoad = Module._load;
const state = {input:[],picks:[],saved:null,exists:false,warnings:[],folderSelection:null,opened:[],warningChoice:undefined,documents:[]};
class WorkspaceEdit { constructor(){this.changes=[];} createFile(uri,options){this.changes.push({kind:'create',uri,options});} insert(uri,pos,text){this.changes.push({kind:'insert',text});} replace(uri,range,text){this.changes.push({kind:'replace',text});} }
const vscode = {
 Uri:{file:fsPath=>({fsPath}),joinPath:(base,name)=>({fsPath:base.fsPath+'/'+name})}, FileType:{Directory:2}, Position:class {constructor(line,character){this.line=line;this.character=character;}}, Range:class {}, WorkspaceEdit,
 commands:{executeCommand:async(...args)=>state.opened.push(args)},
 window:{showQuickPick:async()=>state.picks.shift(),showInputBox:async()=>state.input.shift(),showOpenDialog:async()=>state.folderSelection,showWarningMessage:async message=>{state.warnings.push(message);return state.warningChoice;},showInformationMessage:async()=>{},showTextDocument:async()=>{}},
 workspace:{workspaceFolders:[{name:'project',uri:{fsPath:'/project'}}],get textDocuments(){return state.documents;},getWorkspaceFolder:uri=>uri.folder==='project'?vscode.workspace.workspaceFolders[0]:undefined,fs:{readFile:async()=>Buffer.from(state.saved || '{}'),stat:async uri=>{if(uri.fsPath==='/external')return {type:2};if(!state.exists){const e=new Error('missing');e.code='FileNotFound';throw e;}return {type:1};}},openTextDocument:async()=>({uri:{},getText:()=>state.saved || '{}',positionAt:i=>i,save:async()=>true}),applyEdit:async edit=>{const c=edit.changes.find(x=>x.text);state.saved=c.text;return true;}}
};
Module._load=function(request,parent,isMain){if(request==='vscode')return vscode;return actualLoad.apply(this,arguments);};
const setup=require('../src/projectSetup');
Module._load=actualLoad;
(async()=>{
 state.picks=[{format:'text',include:'**/*.md'}]; state.input=['requirements','requirements.md','^(?<id>REQ-[0-9]+): (?<title>.+)$',''];
 await setup.createProject();
 let config=JSON.parse(state.saved); assert.equal(config.sources[0].name,'requirements'); assert.equal(config.sources[0].artifact,'^(?<id>REQ-[0-9]+): (?<title>.+)$'); assert.ok(!('_artifact' in config.sources[0]));
 const previous=state.saved; state.exists=true; await setup.createProject(); assert.equal(state.saved,previous); assert.equal(state.warnings.length,1);
 config.sources.push({name:'tests',format:'text',include:'tests.md',artifact:'^(?<id>T-[0-9]+)$'}); state.saved=JSON.stringify(config);
 state.picks=[{label:'tests'},{label:'requirements'}];state.input=['verifies']; await setup.addRule();
 config=JSON.parse(state.saved); assert.deepEqual(config.links,[{from:'tests',to:'requirements',type:'verifies'}]); assert.ok(!('_artifact' in config.sources[0]));
 const currentPattern=config.sources[0].artifact;
 await setup.updatePattern({uri:{}},'requirements','artifact',currentPattern,'^(?<id>NEW-[0-9]+)$');
 config=JSON.parse(state.saved); assert.equal(config.sources[0].artifact,'^(?<id>NEW-[0-9]+)$');
 await assert.rejects(setup.updatePattern({uri:{}},'requirements','artifact',currentPattern,'other'),/changed since the scan/);
 state.picks=[{format:'codebeamer'},{label:'v3'},{value:'v3'}];state.input=['cb','server','project.id IN (1)'];await setup.addSource();
 config=JSON.parse(state.saved);assert.equal(config.sources.at(-1).apiVersion,'v3');assert.equal(config.sources.at(-1).associationApi,'v3');assert.equal(config.sources.at(-1).includeAssociations,true);
 state.picks=[{format:'doors-next'}];state.input=['doors','server','https://doors.test/rm/query','https://gc.test/config/stream'];await setup.addSource();
 config=JSON.parse(state.saved);assert.equal(config.sources.at(-1).configurationContext,'https://gc.test/config/stream');
 state.picks=[{format:'csv',include:'**/*.csv'}];state.input=['csv requirements','req.csv','ID','Title','Description','Links','|','["Status", "Owner, team"]',','];await setup.addSource();
 config=JSON.parse(state.saved);const csv=config.sources.at(-1);assert.equal(csv.idColumn,'ID');assert.equal(csv.titleColumn,'Title');assert.equal(csv.textColumn,'Description');assert.equal(csv.referenceColumn,'Links');assert.equal(csv.referenceSeparator,'|');assert.deepEqual(csv.attributeColumns,['Status','Owner, team']);assert.equal(csv.delimiter,',');
 const sourceResult=require('../src/engine').analyze(config,[{source:'csv requirements',path:'req.csv',text:'ID,Title,Description,Links,Status,"Owner, team"\nR1,Title,Text,,Approved,Jane\n'}]);
 assert.equal(sourceResult.artifacts[0].attributes['Owner, team'],'Jane');
 const beforeCancel=state.saved;state.picks=[{format:'csv',include:'**/*.csv'}];state.input=['cancelled','cancel.csv','ID',undefined];await setup.addSource();assert.equal(state.saved,beforeCancel);
 state.exists=false;state.picks=[{value:'path'},{format:'text',include:'**/*.md'}];state.input=['/external','external requirements','**/*.md','^(?<id>REQ-[0-9]+)$',''];await setup.openProject();
 config=JSON.parse(state.saved);assert.equal(config.sources[0].name,'external requirements');assert.equal(state.opened.at(-1)[0],'vscode.openFolder');assert.equal(state.opened.at(-1)[1].fsPath,'/external');assert.equal(state.opened.at(-1)[2].forceNewWindow,true);
 const beforeOpen=state.saved;state.exists=true;state.picks=[{value:'choose'}];state.folderSelection=[{fsPath:'/external'}];await setup.openProject();assert.equal(state.saved,beforeOpen);assert.equal(state.opened.length,2);
 const beforeBad=state.opened.length;state.picks=[{value:'path'}];state.input=['relative/path'];await assert.rejects(setup.openProject(),/absolute/i);assert.equal(state.opened.length,beforeBad);
 let savedDocs=0,refreshed=0;state.documents=[{uri:{folder:'project'},isDirty:true,save:async()=>{savedDocs++;return true;}},{uri:{folder:'other'},isDirty:true,save:async()=>{throw Error('must not save another project');}}];
 await setup.saveProject(async()=>{refreshed++;});assert.equal(savedDocs,1);assert.equal(refreshed,1);
 state.warningChoice=undefined;await setup.reloadProject(async()=>{refreshed++;});assert.equal(refreshed,1);
 state.warningChoice='Reload Saved Files';await setup.reloadProject(async()=>{refreshed++;});assert.equal(refreshed,2);assert.equal(savedDocs,1);
 state.warningChoice='Save and Reload';await setup.reloadProject(async()=>{refreshed++;});assert.equal(refreshed,3);assert.equal(savedDocs,2);
 state.documents=[{uri:{folder:'project'},isDirty:true,save:async()=>false}];await assert.rejects(setup.saveProject(async()=>{refreshed++;}),/save/i);assert.equal(refreshed,3);
 const configBefore=state.saved;const configUpdated=JSON.stringify({sources:[{name:'edited',format:'text',include:'*.md',artifact:'^(?<id>R[0-9]+)$'}],links:[]});
 await setup.updateFromDashboard({uri:{fsPath:'/project'}},configBefore,configUpdated);assert.equal(JSON.parse(state.saved).sources[0].name,'edited');
 await assert.rejects(setup.updateFromDashboard({uri:{fsPath:'/project'}},configBefore,configUpdated),/changed/i);
 await assert.rejects(setup.updateFromDashboard({uri:{fsPath:'/project'}},state.saved,'{"sources":[]}'),/sources/i);
 state.picks=[[{name:'edited'}]];state.input=['Requirements'];await setup.assignGroup();config=JSON.parse(state.saved);assert.equal(config.sources[0].group,'Requirements');
 config.sources.push({name:'tests',group:'Tests',format:'text',include:'tests.md',artifact:'^(?<id>T[0-9]+)$'});state.saved=JSON.stringify(config);
 state.input=['verifies'];await setup.addGroupRuleForFolder({uri:{fsPath:'/project'}},'Tests','Requirements');config=JSON.parse(state.saved);assert.deepEqual(config.groupLinks,[{from:'Tests',to:'Requirements',type:'verifies'}]);
 state.input=['verifies'];await assert.rejects(setup.addGroupRuleForFolder({uri:{fsPath:'/project'}},'Tests','Requirements'),/already exists/i);
 console.log('Project setup tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
