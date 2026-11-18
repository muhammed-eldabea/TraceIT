const assert = require('node:assert/strict');
const { analyze, report } = require('../src/engine');
const config = { sources: [
  { name: 'req', include: '*.md', artifact: '^# (?<id>REQ-\\d+): (?<title>.+)$' },
  { name: 'test', include: '*.txt', artifact: '^# (?<id>T-\\d+): (?<title>.+)$', reference: '^ref: (?<target>REQ-\\d+)$' }
], links: [{ from: 'test', to: 'req', type: 'verifies' }] };
const files = [ {source:'req',path:'req.md',text:'# REQ-1: <unsafe>\n# REQ-2: uncovered'}, {source:'test',path:'test.txt',text:'# T-1: test\nref: REQ-1\nref: REQ-9'} ];
const result = analyze(config, files);
assert.equal(result.artifacts.length, 3);
assert.equal(result.links.length, 1);
assert.equal(result.links[0].to.id, 'REQ-1');
assert.equal(result.unresolved.length, 1);
assert.match(report(result), /&lt;unsafe&gt;/);
const duplicate = analyze(config, [...files, {source:'req',path:'duplicate.md',text:'# REQ-1: duplicate'}]);
assert.equal(duplicate.links.length, 0);
assert.equal(duplicate.unresolved[0].reason, 'ambiguous target');
for (const format of ['codebeamer', 'doors-next']) {
  const remote = analyze({sources:[{name:'remote',format}]}, [{source:'remote',items:[
    {id:'REQ-1',url:'https://example.test/1',externalId:'1',title:'First'},
    {id:'REQ-1',url:'https://example.test/2',externalId:'2',title:'Second'}
  ]}]);
  assert.equal(remote.artifacts.length,2);
  assert.match(remote.diagnostics.join('\n'),/Duplicate artifact ID REQ-1 in remote/);
  assert.match(report(remote),/Analysis needs review/);
}
assert.throws(() => analyze({sources:[{name:'x',include:'*',artifact:'['}]}, []), /artifact/);
const multiConfig={sources:[{name:'req',include:'*.md',artifact:'^# (?<id>REQ-\\d+)'},{name:'test',include:'*.txt',artifact:'^# (?<id>T-\\d+)',reference:'(?<target>REQ-\\d+)'}],links:[{from:'test',to:'req',type:'verifies'}]};
const multi=analyze(multiConfig,[{source:'req',path:'r',text:'# REQ-1\n# REQ-2'},{source:'test',path:'t',text:'# T-1\nverifies REQ-1, REQ-2 and REQ-1'}]);
assert.deepEqual(multi.links.map(link=>link.to.id),['REQ-1','REQ-2']);assert.equal(multi.coverage[0].covered,2);
const zero=analyze({sources:[{name:'s',include:'*',artifact:'^# (?<id>[^ ]+)',reference:'(?<target>)(?=a)'}]},[{source:'s',path:'z',text:'# ID\naa'}]);assert.equal(zero.diagnostics.length,2);
console.log('Engine tests passed');
const { impact } = require('../src/engine');
const a = {id:'A'}, b = {id:'B'}, c = {id:'C'};
const graph = { links: [{from:b,to:a,type:'covers'}, {from:c,to:b,type:'tests'}, {from:a,to:c,type:'cycle'}] };
assert.deepEqual(impact(graph, a).map(x => [x.artifact.id, x.depth]), [['B', 1], ['C', 2]]);
assert.deepEqual(impact({links:[]}, a), []);
console.log('Impact analysis tests passed');
const nodes=Array.from({length:5000},(_,id)=>({id}));
const chain={links:nodes.slice(1).map((node,i)=>({from:node,to:nodes[i],type:'covers'}))};
const chainImpact=impact(chain,nodes[0]);
assert.equal(chainImpact.length,4999);
assert.equal(chainImpact[chainImpact.length-1].depth,4999);
const repeated=analyze(multiConfig,[{source:'req',path:'r',text:'# REQ-1'},{source:'test',path:'t',text:'# T-1\nREQ-1\nREQ-1'}]);assert.equal(repeated.links.length,1);assert.deepEqual(repeated.links[0].referenceLines,[2,3]);assert.equal(repeated.artifacts.find(a=>a.id==='T-1').references.length,2);
const repeatedHtml=report(repeated);assert.match(repeatedHtml,/t:2, 3/);const repeatedDashboard=require('../src/dashboard').renderDashboard([{folder:{name:'p'},result:repeated}]);assert.match(repeatedDashboard,/t:2, 3/);
const withText=report({artifacts:[{id:'R',source:'req',title:'Title',path:'r',line:1,text:'First line\n<script>alert(1)</script>'}],links:[],coverage:[],diagnostics:[],unresolved:[]});assert.match(withText,/First line\n&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(withText,/<script>alert\(1\)<\/script>/);assert.match(withText,/<th>Extracted text<\/th>/);
const duplicateRuleCoverage=analyze({sources:[{name:'r',include:'r',artifact:'^(?<id>R[0-9]+)$'},{name:'t',include:'t',artifact:'^(?<id>T[0-9]+)$',reference:'(?<target>R[0-9]+)'}],links:[{from:'t',to:'r',type:'verifies'},{from:'t',to:'r',type:'implements'}]},[{source:'r',path:'r',text:'R1\nR2'},{source:'t',path:'t',text:'T1\nR1'}]);assert.equal(duplicateRuleCoverage.unresolved[0].reason,'ambiguous target');assert.deepEqual(duplicateRuleCoverage.coverage.map(c=>c.covered),[0,0]);
const largeCount=2000;const largeResult=analyze({sources:[{name:'req',include:'r',artifact:'^(?<id>R[0-9]+)$'},{name:'test',include:'t',artifact:'^(?<id>T[0-9]+)$',reference:'^ref (?<target>R[0-9]+)$'}],links:[{from:'test',to:'req',type:'verifies'}]},[{source:'req',path:'r',text:Array.from({length:largeCount},(_,i)=>`R${i}`).join('\n')},{source:'test',path:'t',text:Array.from({length:largeCount},(_,i)=>`T${i}\nref R${i}`).join('\n')}]);assert.equal(largeResult.coverage[0].covered,largeCount);assert.equal(largeResult.links.length,largeCount);
const reportTargets=Array.from({length:82},(_,i)=>({id:`REQ-${i}`,title:i===81?'<last target>':'Target',source:'req',path:'requirements.md',line:i+1}));
const reportTest={id:'T-1',title:'Test',source:'test',path:'tests.md',line:1};
const reportResult={artifacts:[...reportTargets,reportTest],links:[{from:reportTest,to:reportTargets[0],type:'verifies'},{from:reportTest,to:reportTargets[81],type:'mentions'}],coverage:[{from:'test',to:'req',type:'verifies',covered:1,total:82}],diagnostics:[],unresolved:[]};
const coverageHtml=report(reportResult), gaps=coverageHtml.split('<h2>Uncovered targets by rule</h2>')[1].split('<h2>Traceability matrices</h2>')[0];
assert.match(gaps,/REQ-81/);assert.match(gaps,/&lt;last target&gt;/);assert.match(gaps,/81 uncovered/);assert.doesNotMatch(gaps,/REQ-0\b/);
const none=report({...reportResult,artifacts:[reportTargets[0],reportTest],links:[{from:reportTest,to:reportTargets[0],type:'verifies'}],coverage:[{from:'test',to:'req',type:'verifies',covered:1,total:1}]});assert.match(none,/No uncovered targets/);
const groupedConfig={sources:[
 {name:'req-a',group:'Requirements',include:'r1',artifact:'^(?<id>R[0-9]+)$'},
 {name:'req-b',group:'Requirements',include:'r2',artifact:'^(?<id>R[0-9]+)$'},
 {name:'test-a',group:'Tests',include:'t1',artifact:'^(?<id>T[0-9]+)$',reference:'^ref (?<target>R[0-9]+)$'},
 {name:'test-b',group:'Tests',include:'t2',artifact:'^(?<id>T[0-9]+)$',reference:'^ref (?<target>R[0-9]+)$'}
],links:[],groupLinks:[{from:'Tests',to:'Requirements',type:'verifies'}]};
const grouped=analyze(groupedConfig,[{source:'req-a',path:'r1',text:'R1'},{source:'req-b',path:'r2',text:'R2\nR3'},{source:'test-a',path:'t1',text:'T1\nref R1'},{source:'test-b',path:'t2',text:'T2\nref R2'}]);
assert.equal(grouped.links.length,2);assert.deepEqual(grouped.groupCoverage,[{from:'Tests',to:'Requirements',type:'verifies',covered:2,total:3}]);
const groupedReport=report(grouped);assert.match(groupedReport,/Group coverage/);assert.match(groupedReport,/Tests → Requirements/);assert.match(groupedReport,/2\/3/);assert.match(groupedReport,/R3/);
assert.throws(()=>analyze({...groupedConfig,groupLinks:[{from:'Missing',to:'Requirements'}]},[]),/unknown.*group/i);
const overlapping=analyze({...groupedConfig,links:[{from:'test-a',to:'req-a',type:'verifies'}]},[{source:'req-a',path:'r1',text:'R1'},{source:'test-a',path:'t1',text:'T1\nref R1'}]);assert.equal(overlapping.links.length,1);assert.equal(overlapping.unresolved.length,0);
