'use strict';
const { parse } = require('csv-parse/sync');
function parseCsv(text, source, path) {
  const diagnostics = []; let headerSeen = false;
  const attributeColumns = source.attributeColumns ?? [];
  if (!Array.isArray(attributeColumns) || attributeColumns.some(name => typeof name !== 'string' || !name.trim()) || new Set(attributeColumns).size !== attributeColumns.length) throw new Error('CSV attributeColumns must be an array of unique, nonempty column names');
  const columnsNeeded = [source.idColumn,source.titleColumn,source.textColumn,source.referenceColumn,...attributeColumns].filter(Boolean);
  if (!source.idColumn || typeof source.idColumn !== 'string') throw new Error('CSV source requires idColumn');
  if (source.delimiter != null && (typeof source.delimiter !== 'string' || source.delimiter.length !== 1)) throw new Error('CSV delimiter must be one character');
  const records = parse(text, {bom:true,skip_empty_lines:true,relax_column_count:false,info:true,raw:true,delimiter:source.delimiter || ',',columns:header=>{
    headerSeen = true;
    if (new Set(header).size !== header.length) throw new Error('CSV column names must be unique');
    for (const name of columnsNeeded) if (!header.includes(name)) throw new Error(`CSV column not found: ${name}`);
    return header;
  }});
  if (!headerSeen) throw new Error('CSV file has no header row');
  const artifacts = [];
  for (const {record,raw,info} of records) {
    const id = record[source.idColumn].trim();
    const line = Math.max(1,info.lines - (raw.match(/\n/g) || []).length + (raw.endsWith('\n') ? 1 : 0));
    if (!id) { diagnostics.push(`${path}:${line}: row has no identifier`); continue; }
    const refs = source.referenceColumn ? String(record[source.referenceColumn] || '').split(source.referenceSeparator || ';').map(x=>x.trim()).filter(Boolean) : [];
    const attributes = Object.fromEntries(attributeColumns.map(name => [name,record[name]]));
    artifacts.push({id,title:source.titleColumn ? record[source.titleColumn] : '',text:source.textColumn ? record[source.textColumn] : '',...(attributeColumns.length ? {attributes} : {}),source:source.name,path,line,references:refs.map(target=>({target,line}))});
  }
  return {artifacts,diagnostics};
}
module.exports = {parseCsv};
