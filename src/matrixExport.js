'use strict';
function safeCell(value) {
  let text = String(value ?? '');
  // Spreadsheet applications may execute cells beginning with formula markers.
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
function exportMatrix(result, rule) {
  if (!result.coverage.some(c=>c.from===rule.from && c.to===rule.to && c.type===rule.type)) throw new Error('The selected coverage rule is no longer available');
  const from = result.artifacts.filter(a=>a.source===rule.from), to = result.artifacts.filter(a=>a.source===rule.to);
  if (from.length * to.length > 5000000) throw new Error('Matrix exceeds 5 million cells; narrow the source selection before export');
  const links = new Map();
  for (const link of result.links) {
    if (link.from.source !== rule.from || link.to.source !== rule.to || link.type !== rule.type) continue;
    if (!links.has(link.to)) links.set(link.to,new Set());
    links.get(link.to).add(link.from);
  }
  const label = a => `${a.id} — ${a.path}${a.page ? ` page ${a.page}` : a.slide ? ` slide ${a.slide}` : `:${a.line || 1}`}`;
  const issues = result.diagnostics.length + result.unresolved.length;
  const status = issues ? `Needs review: ${issues} diagnostic(s) or unresolved reference(s)` : 'No diagnostics detected; review links';
  const header = [`Analysis status: ${status}`,`Coverage rule: ${rule.from} → ${rule.to} (${rule.type})`,'Target ID','Target title','Target location',...from.map(label)];
  const rows = [header,...to.map(target => [status,`${rule.from} → ${rule.to} (${rule.type})`,target.id,target.title,label(target),...from.map(source=>links.get(target)?.has(source) ? 'linked' : '')])];
  return '\ufeff' + rows.map(row=>row.map(safeCell).join(',')).join('\r\n')+'\r\n';
}
module.exports = {exportMatrix};
