'use strict';
function parseManualLinks(text) {
  let data;
  try { data = JSON.parse(text); } catch (error) { throw new Error(`Invalid traceability-links.json: ${error.message}`); }
  if (!data || data.version !== 1 || !Array.isArray(data.links)) throw new Error('Manual link file must contain version 1 and a links array');
  for (const link of data.links) {
    if (!link || !link.from || !link.to || ![link.from.source,link.from.id,link.to.source,link.to.id,link.type].every(x => typeof x === 'string' && x.trim())) throw new Error('Each manual link needs nonempty from/to source and id, and type');
  }
  const key = l => JSON.stringify([l.from.source,l.from.id,l.to.source,l.to.id,l.type]);
  if (new Set(data.links.map(key)).size !== data.links.length) throw new Error('Duplicate manual links are not allowed');
  return data;
}
function replaceManualLink(links, index, replacement) {
  if (!Array.isArray(links) || !Number.isInteger(index) || index < 0 || index >= links.length) throw new Error('Manual link no longer exists');
  const updated = links.map((link, i) => i === index ? replacement : link);
  return parseManualLinks(JSON.stringify({version:1, links:updated})).links;
}
module.exports = { parseManualLinks, replaceManualLink };
