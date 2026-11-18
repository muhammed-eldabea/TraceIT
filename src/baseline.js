'use strict';

// Source and ID are the engine's identity within a project. Duplicate IDs are
// deliberately excluded: an ambiguous identity cannot be compared reliably.
function snapshot(result, project, now = new Date()) {
  const counts = new Map();
  for (const a of result.artifacts) { const key = JSON.stringify([a.source, a.id]); counts.set(key, (counts.get(key) || 0) + 1); }
  const artifacts = result.artifacts.map(a => ({ source: a.source, id: a.id, title: a.title, path: a.path, line: a.line, text: a.text || '', externalIdentity: a.externalId ?? null, metadata: JSON.parse(JSON.stringify({attributes:a.attributes ?? null,hierarchy:a.hierarchy ?? null})) }));
  const links = result.links.map(l => ({ from: [l.from.source, l.from.id], to: [l.to.source, l.to.id], type: l.type, attributes:JSON.parse(JSON.stringify(l.attributes ?? null)) }));
  return { version: 1, project, createdAt: now.toISOString(), analysisIssues: [...(result.diagnostics || []), ...((result.unresolved || []).map(r => `Unresolved reference: ${r.target}`))], artifacts, links, ambiguous: [...counts].filter(([, count]) => count > 1).map(([key]) => JSON.parse(key)) };
}
function compare(before, after) {
  for (const value of [before, after]) if (!value || value.version !== 1 || !Array.isArray(value.artifacts) || !Array.isArray(value.links) || !Array.isArray(value.ambiguous)) throw new Error('Invalid or unsupported baseline file');
  const id = a => JSON.stringify([a.source, a.id]);
  const canonical = value => {if(Array.isArray(value))return value.map(canonical);if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;};
  const metadataIncomplete=[...before.artifacts,...after.artifacts].some(a=>!Object.hasOwn(a,'metadata'));
  const externalIdentityIncomplete=[...before.artifacts,...after.artifacts].some(a=>!Object.hasOwn(a,'externalIdentity'));
  const linkAttributesIncomplete=[...before.links,...after.links].some(l=>!Object.hasOwn(l,'attributes'));
  const excluded = new Set([...before.ambiguous, ...after.ambiguous].map(k => JSON.stringify(k)));
  const old = new Map(before.artifacts.filter(a => !excluded.has(id(a))).map(a => [id(a), a]));
  const current = new Map(after.artifacts.filter(a => !excluded.has(id(a))).map(a => [id(a), a]));
  const added = [], removed = [], changed = [];
  for (const [key, a] of current) { const b = old.get(key); if (!b) added.push(a); else if (a.title !== b.title || a.text !== b.text || a.path !== b.path || (Object.hasOwn(a,'externalIdentity') && Object.hasOwn(b,'externalIdentity') && a.externalIdentity !== b.externalIdentity) || (Object.hasOwn(a,'metadata') && Object.hasOwn(b,'metadata') && JSON.stringify(canonical(a.metadata)) !== JSON.stringify(canonical(b.metadata)))) changed.push({ before: b, after: a }); }
  for (const [key, a] of old) if (!current.has(key)) removed.push(a);
  const linkKey = l => JSON.stringify([l.from, l.to, l.type]);
  const ambiguousLinkKeys=new Set();
  for(const snapshot of [before,after]){const seen=new Set();for(const l of snapshot.links){const key=linkKey(l);if(seen.has(key))ambiguousLinkKeys.add(key);seen.add(key);}}
  const usable = l => !excluded.has(JSON.stringify(l.from)) && !excluded.has(JSON.stringify(l.to)) && !ambiguousLinkKeys.has(linkKey(l));
  const oldLinks = new Map(before.links.filter(usable).map(l => [linkKey(l), l]));
  const newLinks = new Map(after.links.filter(usable).map(l => [linkKey(l), l]));
  const addedLinks = [...newLinks].filter(([key]) => !oldLinks.has(key)).map(([, value]) => value);
  const removedLinks = [...oldLinks].filter(([key]) => !newLinks.has(key)).map(([, value]) => value);
  const changedLinks = [...newLinks].filter(([key,link])=>{const oldLink=oldLinks.get(key);return oldLink && Object.hasOwn(oldLink,'attributes') && Object.hasOwn(link,'attributes') && JSON.stringify(canonical(oldLink.attributes))!==JSON.stringify(canonical(link.attributes));}).map(([key,link])=>({before:oldLinks.get(key),after:link}));
  const changedIds = new Set(changed.map(c => id(c.after)));
  const suspiciousLinks = [...newLinks].filter(([key, link]) => oldLinks.has(key) && (changedIds.has(JSON.stringify(link.from)) || changedIds.has(JSON.stringify(link.to)))).map(([, link]) => link);
  return { added, removed, changed, addedLinks, removedLinks, changedLinks, suspiciousLinks, metadataIncomplete, externalIdentityIncomplete, linkAttributesIncomplete, ambiguousLinks:ambiguousLinkKeys.size, excluded: [...excluded].map(k => JSON.parse(k)) };
}
function renderComparison(diff, before, after) {
  const e = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const artifact = a => `${e(a.source)} / ${e(a.id)} — ${e(a.title)}`;
  const link = l => `${e(l.from.join(' / '))} → ${e(l.to.join(' / '))} (${e(l.type)})`;
  const details=(oldValue,newValue,fields)=>{
    const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const display=value=>typeof value==='string'?value:JSON.stringify(value,null,2) ?? '(not recorded)';
    const rows=fields.filter(([key])=>Object.hasOwn(oldValue,key) && Object.hasOwn(newValue,key) && JSON.stringify(canonical(oldValue[key]))!==JSON.stringify(canonical(newValue[key]))).map(([key,label])=>`<dt>${e(label)} — before</dt><dd><pre>${e(display(oldValue[key]))}</pre></dd><dt>${e(label)} — after</dt><dd><pre>${e(display(newValue[key]))}</pre></dd>`).join('');
    return rows?`<details><summary>Review changes</summary><dl>${rows}</dl></details>`:'';
  };
  const list = (title, items, format) => `<h2>${e(title)} (${items.length})</h2><ul>${items.map(x => `<li>${format(x)}</li>`).join('') || '<li>None</li>'}</ul>`;
  const issueNotice = (!Array.isArray(before.analysisIssues) || !Array.isArray(after.analysisIssues) ? '<p><strong>Review required:</strong> an older snapshot does not record analysis diagnostics, so its completeness is unknown.</p>' : (before.analysisIssues.length || after.analysisIssues.length) ? `<p><strong>Review required:</strong> the baseline has ${before.analysisIssues.length} analysis issues and the current scan has ${after.analysisIssues.length}; changes and suspicious links may be incomplete.</p>` : '') + (diff.ambiguousLinks ? `<p><strong>Review required:</strong> ${diff.ambiguousLinks} repeated link identity or identities were excluded from comparison.</p>` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Baseline comparison</title><style>body{font:15px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.5}h2{border-bottom:1px solid #bbb;padding-bottom:.3rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}dt{font-weight:bold}</style></head><body><h1>Baseline comparison</h1>${issueNotice}${diff.metadataIncomplete ? '<p><strong>Review required:</strong> artifact metadata was not compared for older snapshots.</p>' : ''}${diff.externalIdentityIncomplete ? '<p><strong>Review required:</strong> native identity was not compared for older snapshots.</p>' : ''}${diff.linkAttributesIncomplete ? '<p><strong>Review required:</strong> link attributes were not compared for older snapshots.</p>' : ''}<p>${e(before.project)}: ${e(before.createdAt)} → ${e(after.createdAt)}</p><p>Suspicious links connect artifacts whose captured content, metadata or native identity changed and should be reviewed. Changes outside captured artifact text may not be detected.</p>${list('Added artifacts',diff.added,artifact)}${list('Removed artifacts',diff.removed,artifact)}${list('Changed artifacts',diff.changed,x => artifact(x.after)+details(x.before,x.after,[['title','Title'],['text','Text'],['path','Location'],['externalIdentity','Native identity'],['metadata','Metadata']]))}${list('Added links',diff.addedLinks,link)}${list('Removed links',diff.removedLinks,link)}${list('Changed link attributes',diff.changedLinks || [],x=>link(x.after)+details(x.before,x.after,[['attributes','Attributes']]))}${list('Suspicious links',diff.suspiciousLinks,link)}${list('Ambiguous identities excluded',diff.excluded,x=>e(x.join(' / ')))}</body></html>`;
}
module.exports = { snapshot, compare, renderComparison };
