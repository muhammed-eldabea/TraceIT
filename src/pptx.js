'use strict';
const JSZip=require('jszip');const path=require('path').posix;const {XMLParser,XMLValidator}=require('fast-xml-parser');
const local=(object,name)=>object && Object.entries(object).find(([key])=>key.split(':').pop()===name)?.[1];
const list=value=>value==null?[]:Array.isArray(value)?value:[value];
async function extractPptx(bytes){
  const zip=await JSZip.loadAsync(Buffer.from(bytes));let total=0;
  if(Object.keys(zip.files).length>10000)throw new Error('PowerPoint archive has too many entries');
  const read=async name=>{const entry=zip.file(name);if(!entry)throw new Error(`PowerPoint is missing ${name}`);const size=entry._data && entry._data.uncompressedSize;if(!Number.isSafeInteger(size)||size>20*1024*1024||(total+=size)>50*1024*1024)throw new Error('PowerPoint extracted XML exceeds size limits');const xml=await entry.async('string');if(XMLValidator.validate(xml)!==true || /<!DOCTYPE/i.test(xml))throw new Error(`Invalid PowerPoint XML: ${name}`);return xml;};
  const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
  const presentation=local(parser.parse(await read('ppt/presentation.xml')),'presentation');
  const relationships=local(parser.parse(await read('ppt/_rels/presentation.xml.rels')),'Relationships');
  if(!presentation || typeof presentation!=='object' || !relationships || typeof relationships!=='object')throw new Error('PowerPoint presentation or relationships are missing');
  const ids=list(local(local(presentation,'sldIdLst'),'sldId'));
  if(ids.length>2000)throw new Error('PowerPoint exceeds 2000 slides');
  const rels=new Map();for(const rel of list(local(relationships,'Relationship'))){if(!rel || !rel['@_Id'] || rels.has(rel['@_Id']))throw new Error('PowerPoint has invalid or duplicate relationship IDs');rels.set(rel['@_Id'],rel);}
  const lines=[],lineSlides=[],slideFiles=[],diagnostics=[],seen=new Set();
  for(let i=0;i<ids.length;i++){
    const rid=Object.entries(ids[i]).find(([key])=>key.startsWith('@_')&&key.endsWith(':id'))?.[1];const rel=rels.get(rid);
    if(!rel||rel['@_TargetMode']==='External'||!String(rel['@_Type']||'').endsWith('/slide'))throw new Error(`PowerPoint slide ${i+1} has an invalid relationship`);
    const target=String(rel['@_Target']||'');const file=target.startsWith('/')?path.normalize(target.slice(1)):path.normalize(path.join('ppt',target));
    if(!/^ppt\/slides\/[^/]+\.xml$/.test(file)||seen.has(file))throw new Error('PowerPoint slide path is unsupported or duplicated');seen.add(file);slideFiles.push(file);
    const xml=await read(file);const tree=new XMLParser({preserveOrder:true,removeNSPrefix:true,parseTagValue:false,trimValues:false}).parse(xml);
    const paragraphs=[],stack=tree.slice().reverse();
    while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;const key=Object.keys(node).find(k=>k!==':@');if(!key)continue;const children=node[key];
      if(key==='p' && Array.isArray(children)){
        const parts=[],inner=children.slice().reverse();while(inner.length){const part=inner.pop();if(!part||typeof part!=='object')continue;const k=Object.keys(part).find(x=>x!==':@');if(!k)continue;if(k==='#text')parts.push(String(part[k]));else if(k==='br')parts.push('\n');else if(Array.isArray(part[k]))for(let j=part[k].length-1;j>=0;j--)inner.push(part[k][j]);}
        const value=parts.join('').trim();if(value)paragraphs.push(...value.split(/\r?\n/));
      } else if(Array.isArray(children))for(let j=children.length-1;j>=0;j--)stack.push(children[j]);
    }
    lines.push(`[Slide ${i+1}]`);lineSlides.push(i+1);for(const line of paragraphs){lines.push(line);lineSlides.push(i+1);}if(!paragraphs.length)diagnostics.push(`Slide ${i+1}: no extractable text; images and charts are not analyzed`);
  }
  return {text:lines.join('\n'),lineSlides,slideFiles,diagnostics};
}
module.exports={extractPptx};
