'use strict';
const { parseReqif } = require('./reqif');
const { parseCsv } = require('./csv');
const { parseDoorsClassic } = require('./doorsClassic');
const { renderMatrices } = require('./matrix');
const { renderAttributes } = require('./attributes');
const { renderSourceGraph } = require('./graph');

// Each parser applies its patterns line by line. Named groups describe the data.
function compile(pattern, label) {
  try { return new RegExp(pattern); } catch (error) { throw new Error(`${label}: ${error.message}`); }
}
function validate(config) {
  if (!config || !Array.isArray(config.sources) || !config.sources.length) throw new Error('sources must be a non-empty array');
  const names = new Set();
  for (const source of config.sources) {
    if (!source.name || (!['codebeamer', 'doors-next'].includes(source.format) && !source.include) || (!['reqif', 'reqifz', 'csv', 'doors-classic-export', 'codebeamer', 'doors-next'].includes(source.format) && !source.artifact)) throw new Error('Each source needs name, include, and an artifact pattern unless format is reqif');
    if (source.format && !['text', 'docx', 'xlsx', 'pdf', 'pptx', 'odt', 'reqif', 'reqifz', 'csv', 'doors-classic-export', 'codebeamer', 'doors-next'].includes(source.format)) throw new Error(`Unsupported source format: ${source.format}`);
    if (names.has(source.name)) throw new Error(`Duplicate source: ${source.name}`);
    names.add(source.name);
    if (!['reqif', 'reqifz', 'csv', 'doors-classic-export', 'codebeamer', 'doors-next'].includes(source.format)) source._artifact = compile(source.artifact, `${source.name} artifact`);
    if (source.reference) source._reference = compile(source.reference, `${source.name} reference`);
  }
  for (const rule of config.links || []) if (!names.has(rule.from) || !names.has(rule.to)) throw new Error(`Unknown source in link rule: ${rule.from} -> ${rule.to}`);
  const groups=new Set(config.sources.map(source=>source.group || source.name));
  if(config.sources.some(source=>source.group!==undefined && (typeof source.group!=='string' || !source.group.trim())))throw new Error('Source group must be a nonempty name');
  if(config.groupLinks!==undefined && !Array.isArray(config.groupLinks))throw new Error('groupLinks must be an array');
  for(const rule of config.groupLinks || [])if(!rule || !groups.has(rule.from) || !groups.has(rule.to))throw new Error(`Unknown document group in coverage rule: ${rule && rule.from} -> ${rule && rule.to}`);
  return config;
}
function analyze(config, files) {
  validate(config);
  const sourceGroup=new Map(config.sources.map(source=>[source.name,source.group || source.name]));
  const groups=new Map();for(const source of config.sources){const name=sourceGroup.get(source.name);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(source.name);}
  const rules=[],ruleSet=new Set();
  const addRule=rule=>{const normalized={from:rule.from,to:rule.to,type:rule.type || 'references'};const key=JSON.stringify([normalized.from,normalized.to,normalized.type]);if(!ruleSet.has(key)){ruleSet.add(key);rules.push(normalized);}};
  for(const rule of config.links || [])addRule(rule);
  for(const rule of config.groupLinks || [])for(const from of groups.get(rule.from))for(const to of groups.get(rule.to))addRule({from,to,type:rule.type});
  const artifacts = [], diagnostics = [], ids = new Map(), importedLinks = [], remoteRelations = [];
  for (const file of files) {
    const source = config.sources.find(s => s.name === file.source);
    if (!source) continue;
    if (['codebeamer', 'doors-next'].includes(source.format)) {
      for (const item of file.items) {
        const artifact = {...item, source:source.name, path:item.url, line:1, references:[]};
        artifacts.push(artifact);
        const key = `${source.name}\0${artifact.id}`;
        if (!ids.has(key)) ids.set(key, []);
        ids.get(key).push(artifact);
        if (ids.get(key).length > 1) diagnostics.push(`Duplicate artifact ID ${artifact.id} in ${source.name}`);
      }
      for (const relation of file.relations || []) remoteRelations.push({source, relation});
      continue;
    }
    if (source.format === 'doors-classic-export') {
      try {
        const parsed = parseDoorsClassic(file.text, source, file.path);
        diagnostics.push(...parsed.diagnostics);
        for (const item of parsed.items) {
          artifacts.push(item);
          const key = `${source.name}\0${item.id}`;
          if (!ids.has(key)) ids.set(key, []);
          ids.get(key).push(item);
          if (ids.get(key).length > 1) diagnostics.push(`Duplicate artifact ID ${item.id} in ${source.name}`);
        }
        for (const relation of parsed.relations) remoteRelations.push({source,relation});
      } catch (error) { diagnostics.push(`${file.path}: DOORS Classic import failed: ${error.message}`); }
      continue;
    }
    if (source.format === 'csv') {
      try {
        const parsed = parseCsv(file.text, source, file.path);
        diagnostics.push(...parsed.diagnostics);
        for (const artifact of parsed.artifacts) {
          artifacts.push(artifact);
          const key = `${source.name}\0${artifact.id}`;
          if (!ids.has(key)) ids.set(key, []);
          ids.get(key).push(artifact);
          if (ids.get(key).length > 1) diagnostics.push(`Duplicate artifact ID ${artifact.id} in ${source.name}`);
        }
      } catch (error) { diagnostics.push(`${file.path}: CSV import failed: ${error.message}`); }
      continue;
    }
    if (source.format === 'reqif' || source.format === 'reqifz') {
      try {
        const parsed = parseReqif(file.text, source.name, file.path, source);
        if(file.viewUri)for(const artifact of parsed.artifacts)artifact.viewUri=file.viewUri;
        artifacts.push(...parsed.artifacts); importedLinks.push(...parsed.relations); diagnostics.push(...parsed.diagnostics);
        for (const artifact of parsed.artifacts) {
          const key = `${source.name}\0${artifact.id}`;
          if (!ids.has(key)) ids.set(key, []);
          ids.get(key).push(artifact);
          if (ids.get(key).length > 1) diagnostics.push(`Duplicate artifact ID ${artifact.id} in ${source.name}`);
        }
      } catch (error) { diagnostics.push(`${file.path}: ${error.message}`); }
      continue;
    }
    if (file.diagnostics) diagnostics.push(...file.diagnostics.map(message => `${file.path}: ${message}`));
    let current;
    file.text.split(/\r?\n/).forEach((text, line) => {
      const match = source._artifact.exec(text);
      if (!match && current) current.text += '\n' + text;
      if (match) {
        current = undefined;
        if (!match.groups || !match.groups.id) diagnostics.push(`${file.path}:${line + 1}: artifact pattern must capture a nonempty named group 'id'`);
        else {
          current = { id: match.groups.id, title: match.groups.title || '', source: source.name, path: file.path, line: line + 1, text, viewUri: file.viewUri, originalUri: file.originalUri, originalFormat: file.originalFormat, workbookLocation: file.lineLocations && file.lineLocations[line], page: file.linePages && file.linePages[line], slide: file.lineSlides && file.lineSlides[line], references: [] };
          artifacts.push(current);
          const key = `${source.name}\0${current.id}`;
          if (ids.has(key)) { diagnostics.push(`Duplicate artifact ID ${current.id} in ${source.name}`); ids.get(key).push(current); }
          else ids.set(key, [current]);
        }
      }
      if (source._reference) {
        const targets = new Set();
        for (const ref of text.matchAll(new RegExp(source._reference.source, 'g'))) {
          if (!ref.groups || !ref.groups.target) diagnostics.push(`${file.path}:${line + 1}: reference pattern must capture a nonempty named group 'target'`);
          else if (!current) diagnostics.push(`${file.path}:${line + 1}: reference appears before an artifact`);
          else if (!targets.has(ref.groups.target)) { targets.add(ref.groups.target); current.references.push({ target: ref.groups.target, line: line + 1 }); }
        }
      }
    });
  }
  const artifactIndexes=new Map(artifacts.map((artifact,index)=>[artifact,index]));
  const linkKey=(from,to,type)=>JSON.stringify([artifactIndexes.get(from),artifactIndexes.get(to),type]);
  const sourceDefinitions=new Map(config.sources.map(source=>[source.name,source]));
  const remoteKey=(source,externalId)=>JSON.stringify([source.format,source.connection || source.name,source.format==='doors-next' ? source.configurationContext || null : null,externalId]);
  const remoteIndex=new Map();
  for(const artifact of artifacts){
    const definition=sourceDefinitions.get(artifact.source);if(!definition || typeof artifact.externalId!=='string')continue;
    const key=remoteKey(definition,artifact.externalId);
    if(!remoteIndex.has(key))remoteIndex.set(key,[]);
    remoteIndex.get(key).push(artifact);
  }
  const importedKeys=new Set(importedLinks.map(link=>linkKey(link.from,link.to,link.type)));
  for (const {source, relation} of remoteRelations) {
    const from=typeof relation.from==='string' ? remoteIndex.get(remoteKey(source,relation.from)) || [] : [];
    const to=typeof relation.to==='string' ? remoteIndex.get(remoteKey(source,relation.to)) || [] : [];
    if (from.length === 1 && to.length === 1) {
      const key=linkKey(from[0],to[0],relation.type);
      if (!importedKeys.has(key)){importedKeys.add(key);importedLinks.push({from:from[0],to:to[0],type:relation.type,originalPredicate:relation.originalPredicate,line:1});}
    } else diagnostics.push(`${source.name}: ${source.format} relation ${relation.from} → ${relation.to} points outside imported results or is ambiguous`);
  }
  const links = [...importedLinks], unresolved = [];
  const linkIndex=new Map(links.map(link=>[linkKey(link.from,link.to,link.type),link]));
  for (const artifact of artifacts) for (const ref of artifact.references) {
    const applicableRules = rules.filter(r => r.from === artifact.source);
    const matches = applicableRules.flatMap(rule => (ids.get(`${rule.to}\0${ref.target}`) || []).map(target => ({ target, rule })));
    if (matches.length === 1) {
      const to=matches[0].target,type=matches[0].rule.type || 'references',key=linkKey(artifact,to,type);
      let link=linkIndex.get(key);
      if(!link){link={from:artifact,to,type,line:ref.line,referenceLines:[]};links.push(link);linkIndex.set(key,link);}
      if(!link.referenceLines)link.referenceLines=[];
      if(link.referenceLines[link.referenceLines.length-1]!==ref.line)link.referenceLines.push(ref.line);
    }
    else unresolved.push({ from: artifact, target: ref.target, line: ref.line, reason: matches.length ? 'ambiguous target' : 'target not found or no matching link rule' });
  }
  for (const manual of config.manualLinks || []) {
    const from = ids.get(`${manual.from.source}\0${manual.from.id}`) || [];
    const to = ids.get(`${manual.to.source}\0${manual.to.id}`) || [];
    if (from.length !== 1 || to.length !== 1) {
      diagnostics.push(`Manual link ${manual.from.source}/${manual.from.id} → ${manual.to.source}/${manual.to.id}: missing or ambiguous endpoint`);
      continue;
    }
    const key=linkKey(from[0],to[0],manual.type),existing=linkIndex.get(key);
    if (existing) existing.manual = true;
    else {const link={from:from[0],to:to[0],type:manual.type,line:from[0].line,manual:true};links.push(link);linkIndex.set(key,link);}
  }
  const targetCounts=new Map(), coveredTargets=new Map();
  for(const artifact of artifacts)targetCounts.set(artifact.source,(targetCounts.get(artifact.source)||0)+1);
  const ruleKey=(from,to,type)=>JSON.stringify([from,to,type]);
  for(const link of links){
    if(!artifactIndexes.has(link.to))continue;
    const key=ruleKey(link.from.source,link.to.source,link.type);
    if(!coveredTargets.has(key))coveredTargets.set(key,new Set());
    coveredTargets.get(key).add(link.to);
  }
  const coverage = (config.links || []).map(rule => {
    const type=rule.type || 'references';
    return {from:rule.from,to:rule.to,type,covered:coveredTargets.get(ruleKey(rule.from,rule.to,type))?.size || 0,total:targetCounts.get(rule.to) || 0};
  });
  const groupCoverage=(config.groupLinks || []).map(rule=>{
    const type=rule.type || 'references';
    const targets=artifacts.filter(a=>sourceGroup.get(a.source)===rule.to);
    const covered=new Set(links.filter(link=>sourceGroup.get(link.from.source)===rule.from && sourceGroup.get(link.to.source)===rule.to && link.type===type).map(link=>link.to));
    return {from:rule.from,to:rule.to,type,covered:covered.size,total:targets.length};
  });
  return { artifacts, links, unresolved, diagnostics, coverage, groupCoverage, sourceGroups:Object.fromEntries(sourceGroup) };
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function report(result) {
  const e = escapeHtml;
  const incomingByArtifact=new Map(),outgoingByArtifact=new Map();
  for(const link of result.links){if(!incomingByArtifact.has(link.to))incomingByArtifact.set(link.to,[]);incomingByArtifact.get(link.to).push(link);if(!outgoingByArtifact.has(link.from))outgoingByArtifact.set(link.from,[]);outgoingByArtifact.get(link.from).push(link);}
  const rows = result.artifacts.map(a => {
    const incoming = incomingByArtifact.get(a) || [], outgoing = outgoingByArtifact.get(a) || [];
    const label=l=>`${l.type}${l.referenceLines && l.referenceLines.length ? `; ${l.from.path}${l.from.originalUri ? ' extracted line' : ''}:${l.referenceLines.join(', ')}` : ''}`;
    const describe=(links,endpoint)=>links.map(l=>`${e(l[endpoint].id)} (${e(label(l))})${renderAttributes(l.attributes)}`).join(', ') || '—';
    return `<tr><td>${e(a.source)}</td><td>${e(a.id)}</td><td>${e(a.title)}${renderAttributes(a.attributes)}${a.hierarchy && a.hierarchy.length ? `<br><small>${a.hierarchy.map(h=>e([h.specification,...h.ancestors,a.id].join(' → '))).join('<br>')}</small>` : ''}</td><td><pre>${e(a.text || '—')}</pre></td><td>${e(a.path)}${a.page ? `, page ${a.page}` : a.slide ? `, slide ${a.slide}` : a.workbookLocation ? `, ${e(a.workbookLocation.sheet)} row ${a.workbookLocation.row}` : `:${a.line}`}</td><td>${describe(incoming,'from')}</td><td>${describe(outgoing,'to')}</td></tr>`;
  }).join('');
  const problems = [...result.diagnostics, ...result.unresolved.map(r => `${r.from.path}:${r.line}: ${r.from.id} → ${r.target}: ${r.reason}`)];
  const status = problems.length ? '<p><strong>Analysis needs review:</strong> source diagnostics or unresolved references may make coverage incomplete.</p>' : '<p>No diagnostics detected. Review patterns and links to confirm coverage.</p>';
  const coverage = result.coverage.map(c => `<li>${e(c.from)} → ${e(c.to)} (${e(c.type)}): ${c.covered}/${c.total} targets linked${c.total ? ` (${Math.round(c.covered / c.total * 100)}%)` : ''}</li>`).join('');
  const uncovered = result.coverage.map(rule=>{
    const targets=result.artifacts.filter(a=>a.source===rule.to);
    const gaps=targets.filter(target=>!(incomingByArtifact.get(target)||[]).some(link=>link.from.source===rule.from && link.type===rule.type));
    const heading=`${e(rule.from)} → ${e(rule.to)} (${e(rule.type)})`;
    if(!targets.length)return `<section><h3>${heading}</h3><p>No target artifacts found for this rule.</p></section>`;
    return `<section><h3>${heading}</h3><p>${gaps.length} uncovered of ${targets.length} targets</p>${gaps.length ? `<ul>${gaps.map(a=>`<li>${e(a.id)} — ${e(a.title || '')} (${e(a.path)}${a.page ? `, page ${a.page}` : a.slide ? `, slide ${a.slide}` : a.workbookLocation ? `, ${e(a.workbookLocation.sheet)} row ${e(a.workbookLocation.row)}` : `:${a.line || 1}`})</li>`).join('')}</ul>` : '<p>No uncovered targets.</p>'}</section>`;
  }).join('');
  const groupedCoverage=(result.groupCoverage || []).map(rule=>{
    const groupOf=source=>result.sourceGroups?.[source] || source;
    const targets=result.artifacts.filter(a=>groupOf(a.source)===rule.to);
    const gaps=targets.filter(target=>!(incomingByArtifact.get(target)||[]).some(link=>groupOf(link.from.source)===rule.from && link.type===rule.type));
    const label=`${e(rule.from)} → ${e(rule.to)} (${e(rule.type)})`;
    return `<section><h3>${label}</h3><p>${rule.covered}/${rule.total} targets linked${rule.total ? ` (${Math.round(rule.covered/rule.total*100)}%)` : ' (no targets)'} · ${gaps.length} uncovered</p>${gaps.length ? `<ul>${gaps.map(a=>`<li>${e(a.id)} — ${e(a.title || '')} (${e(a.source)}: ${e(a.path)}:${a.line || 1})</li>`).join('')}</ul>` : '<p>No uncovered targets.</p>'}</section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Traceability report</title><style>body{font:15px system-ui;margin:2rem;color:#20242a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}li{margin:.3rem 0}.graph-scroll{overflow:auto}.graph-node{fill:#f2f6f8;stroke:#5e7080;stroke-width:1.5}.graph-edge{fill:none;stroke:#315f82;stroke-width:2}.graph-arrow{fill:#315f82}.graph-label{fill:#172a3a;font:600 14px system-ui}.graph-detail{fill:#354b5c;font:12px system-ui}</style></head><body><h1>Traceability report</h1>${status}<p>${result.artifacts.length} artifacts · ${result.links.length} resolved links · ${result.unresolved.length} unresolved references</p><p>Links are based on configured patterns and require review. An incoming link does not by itself prove implementation or verification.</p><h2>Link coverage</h2><ul>${coverage || '<li>No link rules configured</li>'}</ul><table><thead><tr><th>Source</th><th>ID</th><th>Title</th><th>Extracted text</th><th>Location</th><th>Incoming</th><th>Outgoing</th></tr></thead><tbody>${rows}</tbody></table><h2>Uncovered targets by rule</h2>${uncovered || '<p>No source-level link rules configured.</p>'}<h2>Group coverage</h2>${groupedCoverage || '<p>No group coverage rules configured.</p>'}<h2>Document group diagram</h2>${renderSourceGraph(result)}<h2>Traceability matrices</h2>${renderMatrices(result) || '<p>No link rules configured.</p>'}<h2>Diagnostics and unresolved references</h2><ul>${problems.map(p => `<li>${e(p)}</li>`).join('') || '<li>None</li>'}</ul></body></html>`;
}
module.exports = { validate, analyze, report };

// Walk incoming links: if a target changes, its covering artifacts may be affected.
function impact(result, start) {
  const visited = new Set([start]);
  const incoming = new Map();
  for (const link of result.links) {
    if (!incoming.has(link.to)) incoming.set(link.to, []);
    incoming.get(link.to).push(link);
  }
  const queue = [{ artifact: start, depth: 0 }];
  const affected = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const link of incoming.get(current.artifact) || []) {
      if (visited.has(link.from)) continue;
      visited.add(link.from);
      const item = { artifact: link.from, via: current.artifact, type: link.type, depth: current.depth + 1 };
      affected.push(item);
      queue.push(item);
    }
  }
  return affected;
}
module.exports.impact = impact;
