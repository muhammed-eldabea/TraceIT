'use strict';
const {parse} = require('csv-parse/sync');
function parseDoorsClassic(text, source, path) {
  const required=['kind','module','absolute','id','heading','text','targetModule','targetAbsolute'];
  let hasHeader=false;
  const rows=parse(text,{bom:true,skip_empty_lines:true,columns:header=>{hasHeader=true; if(new Set(header).size!==header.length || required.some(name=>!header.includes(name)))throw new Error('Invalid DOORS Classic bridge header');return header;},info:true,raw:true});
  if(!hasHeader)throw new Error('DOORS Classic export has no header');
  const items=[],relations=[],diagnostics=[];
  let footer=null, objectRows=0, linkRows=0;
  const key=(module,absolute)=>JSON.stringify([module,absolute]);
  for(const {record,raw,info} of rows){
    const line=Math.max(1,info.lines-(raw.match(/\n/g)||[]).length+(raw.endsWith('\n')?1:0));
    if (footer) throw new Error('Records found after the DOORS Classic completion marker');
    if (record.kind==='complete') { footer=record; continue; }
    if (record.kind==='object') objectRows++;
    if (record.kind==='link') linkRows++;
    if(!record.module || !/^\d+$/.test(record.absolute)){diagnostics.push(`${path}:${line}: invalid module path or absolute number`);continue;}
    const externalId=key(record.module,record.absolute);
    if(record.kind==='object') {
      if(!record.id){diagnostics.push(`${path}:${line}: missing object identifier`);continue;}
      items.push({id:record.id,externalId,title:record.heading,text:record.text,source:source.name,path,line,references:[]});
    } else if(record.kind==='link') {
      if(!record.targetModule || !/^\d+$/.test(record.targetAbsolute)){diagnostics.push(`${path}:${line}: link target identity missing`);continue;}
      relations.push({from:externalId,to:key(record.targetModule,record.targetAbsolute),type:source.linkType || 'references'});
    } else diagnostics.push(`${path}:${line}: unknown record type ${record.kind}`);
  }
  if (!footer || footer.text !== 'bridge-v1') throw new Error('DOORS Classic export is missing its completion marker');
  if (!/^\d+$/.test(footer.absolute) || !/^\d+$/.test(footer.id) || !/^\d+$/.test(footer.heading)) throw new Error('Invalid DOORS Classic completion counts');
  if (Number(footer.absolute)!==objectRows || Number(footer.id)!==linkRows) throw new Error('DOORS Classic export record counts do not match its completion marker');
  if (rows.some(({record}) => record.kind !== 'complete' && record.module !== footer.module)) throw new Error('DOORS Classic export contains multiple source modules');
  const objectIdentities = new Set();
  for (const item of items) {
    if (objectIdentities.has(item.externalId)) throw new Error(`Duplicate DOORS Classic object identity: ${item.externalId}`);
    objectIdentities.add(item.externalId);
  }
  for (const relation of relations) {
    if (!objectIdentities.has(relation.from)) throw new Error(`DOORS Classic link source was not exported: ${relation.from}`);
  }
  if (Number(footer.heading)>0) diagnostics.push(`${path}: ${footer.heading} unreadable object(s) were skipped by DOORS Classic`);
  return {items,relations,diagnostics};
}
module.exports={parseDoorsClassic};
