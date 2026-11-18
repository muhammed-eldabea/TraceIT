'use strict';
const assert=require('node:assert/strict');
const {buildProjectTree}=require('../src/tree');
class TreeItem{constructor(label,state){this.label=label;this.collapsibleState=state;}}
class ThemeIcon{constructor(id){this.id=id;}}
const vscode={TreeItem,ThemeIcon,TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},Uri:{parse:value=>value,joinPath:(_uri,path)=>path}};
const folder={name:'Vehicle',uri:{}};
const requirement={id:'REQ-1',title:'Brake',source:'Requirements',path:'req.md',line:2};
const test={id:'TEST-1',title:'Brake test',source:'Tests',path:'test.md',line:3};
const result={artifacts:[requirement,test],links:[{from:test,to:requirement,type:'verifies'}],diagnostics:['Source skipped'],unresolved:[]};
const tree=buildProjectTree(vscode,folder,{sources:[{name:'Requirements',format:'text'},{name:'Tests',format:'text'}]},result);
assert.equal(tree.label,'Vehicle');assert.equal(tree.children[0].label,'Requirements');assert.equal(tree.children[1].label,'Tests');
assert.match(tree.children[0].children[0].label,/REQ-1/);assert.equal(tree.children[0].children[0].children[0].command.command,'reqtrace.openReference');
assert.match(tree.children[2].label,/Issues/);assert.match(tree.children[2].children[0].label,/Source skipped/);
assert.equal(tree.children[0].children[0].command.arguments[1],1);
const grouped=buildProjectTree(vscode,folder,{sources:[{name:'Requirements',group:'System'},{name:'Tests',group:'System'}]},result);
assert.equal(grouped.children[0].label,'System');assert.equal(grouped.children[0].children.length,2);assert.equal(grouped.children[0].children[0].label,'Requirements');
console.log('Traceability tree tests passed');
