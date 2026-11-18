const assert = require('node:assert/strict');
const { renderDashboard } = require('../src/dashboard');
const result = { artifacts: [{ id: '<REQ>', title: 'test', source: 'req', path: 'r.md', line: 1 }], links: [], coverage: [], diagnostics: [], unresolved: [] };
const html = renderDashboard([{folder: {name: '<project>'}, result}]);
assert.match(html, /&lt;REQ&gt;/);
assert.match(html, /&lt;project&gt;/);
assert.match(html, /data-artifact="0"/);
assert.match(renderDashboard([]), /No traceability project found/);
console.log('Dashboard tests passed');
const issueResult = {...result, diagnostics:['Unable to parse source']};
assert.match(renderDashboard([{folder:{name:'p'},result:issueResult}]),/Analysis needs review/);
assert.match(renderDashboard([{folder:{name:'p'},result}]),/No diagnostics detected/);
const {report} = require('../src/engine');
assert.match(report(issueResult),/coverage incomplete/);

const unsafe={id:'<img src=x>',title:'',source:'tests',path:'t',line:1};const linked=renderDashboard([{folder:{name:'p'},result:{...result,artifacts:[result.artifacts[0],unsafe],links:[{from:unsafe,to:result.artifacts[0],type:'<type>'}]}}]);assert.doesNotMatch(linked,/<img src=x>/);assert.match(linked,/&lt;img src=x&gt;/);assert.match(linked,/&lt;type&gt;/);
const richArtifact={...result.artifacts[0],attributes:{Status:'Approved',Owner:{name:'<owner>'},Flag:false}};const richResult={...result,artifacts:[richArtifact]};const richDashboard=renderDashboard([{folder:{name:'p'},result:richResult}]);const richReport=report(richResult);for(const html of [richDashboard,richReport]){assert.match(html,/Approved/);assert.match(html,/&lt;owner&gt;/);assert.match(html,/false/);assert.doesNotMatch(html,/<owner>/);}
