'use strict';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderSourceGraph(result,folderIndex,projectUri) {
  const sourceGroups=result.sourceGroups || {};
  const grouped=Array.isArray(result.groupCoverage) && result.groupCoverage.length>0;
  const coverage=grouped ? result.groupCoverage : (result.coverage || []);
  const groupOf=source=>sourceGroups[source] || source;
  const names = [...new Set([...Object.values(sourceGroups),...result.artifacts.map(a=>groupOf(a.source)), ...coverage.flatMap(r=>[r.from,r.to])])];
  if (!names.length) return '<p>No sources with artifacts or configured coverage rules.</p>';
  const shown = names.slice(0,50), indices = new Map(shown.map((name,index)=>[name,index]));
  const allRules = coverage.filter(r=>indices.has(r.from) && indices.has(r.to));
  const rules = allRules.slice(0,50);
  const y = name => 45 + indices.get(name)*78;
  const width = 500 + rules.length*22, height = Math.max(105,shown.length*78+30);
  const nodes = shown.map(name=>{
    const count = result.artifacts.filter(a=>groupOf(a.source)===name).length;
    const interactive=projectUri ? ` data-group-node="${escape(name)}" data-project="${escape(projectUri)}" role="button" tabindex="0" aria-label="Connect group ${escape(name)}"` : '';
    return `<g${interactive}><path d="M20 ${y(name)-25} h90 l8 -7 h65 l8 7 h109 v50 h-280 z" class="graph-node"/><text x="32" y="${y(name)-4}" class="graph-label">${escape(name.length>31 ? name.slice(0,28)+'…' : name)}</text><text x="32" y="${y(name)+14}" class="graph-detail">${count} artifact${count === 1 ? '' : 's'}</text><title>${escape(name)}: ${count} artifact${count === 1 ? '' : 's'}</title></g>`;
  }).join('');
  const edges = rules.map((rule,index)=>{
    const a=y(rule.from), b=y(rule.to), lane=345+index*22;
    const path = a===b ? `M 300 ${a-9} C ${lane} ${a-35}, ${lane} ${a+35}, 300 ${a+9}` : `M 300 ${a} H ${lane} V ${b} H 304`;
    const marker=`arrowhead-${Number.isInteger(folderIndex)?folderIndex:'report'}-${index}`;
    const percent=rule.total ? `${Math.round(rule.covered/rule.total*100)}%` : 'No targets';
    return `<path d="${path}" class="graph-edge" marker-end="url(#${marker})"><title>${escape(rule.from)} to ${escape(rule.to)}: ${escape(rule.type)}, ${rule.covered} of ${rule.total} targets linked</title></path><text x="${lane+5}" y="${a===b?a-28:(a+b)/2-6}" class="graph-detail">${escape(percent)}</text><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="graph-arrow"/></marker>`;
  }).join('');
  const labels = rules.map(r=>`<li>${escape(r.from)} → ${escape(r.to)} (${escape(r.type)}): ${r.covered} of ${r.total} targets linked</li>`).join('');
  const truncated = names.length>shown.length || allRules.length>rules.length ? '<p>Graph shows up to 50 sources and 50 rules. The full list and coverage appear elsewhere on this page.</p>' : '';
  return `<div class="source-graph"><p>Arrows go from covering group to covered group. ${projectUri ? 'Drag from one folder to another, or select two folders, to add a coverage rule.' : ''}</p>${projectUri ? `<button class="action secondary" data-export-group="${escape(projectUri)}">Export diagram (SVG)</button><p data-group-status role="status" aria-live="polite"></p>` : ''}${truncated}<div class="graph-scroll"><svg role="${projectUri ? 'group' : 'img'}" aria-label="Configured coverage between document groups" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${edges}${nodes}</svg></div><details><summary>Coverage rule details</summary><ul>${labels || '<li>No coverage rules configured.</li>'}</ul></details></div>`;
}
function exportGroupGraphSvg(result){
  const html=renderSourceGraph(result),match=html.match(/<svg\b[\s\S]*?<\/svg>/);
  if(!match)throw new Error('No document groups are available to export');
  const style='<style>.graph-node{fill:#f2f6f8;stroke:#5e7080;stroke-width:1.5}.graph-edge{fill:none;stroke:#315f82;stroke-width:2}.graph-arrow{fill:#315f82}.graph-label{fill:#172a3a;font:600 14px system-ui,sans-serif}.graph-detail{fill:#354b5c;font:12px system-ui,sans-serif}</style><rect width="100%" height="100%" fill="white"/>';
  return match[0].replace(/(<svg\b[^>]*>)/,`$1${style}`);
}
module.exports = {renderSourceGraph,exportGroupGraphSvg};
