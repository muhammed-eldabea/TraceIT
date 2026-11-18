'use strict';
const JSZip=require('jszip');
const {SaxesParser}=require('saxes');
const OFFICE='urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TEXT='urn:oasis:names:tc:opendocument:xmlns:text:1.0';
async function extractOdt(bytes){
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  if(Object.keys(zip.files).length>10000)throw new Error('OpenDocument archive has too many entries');
  const read=async(name,limit)=>{
    const entry=zip.file(name);if(!entry || !entry._data || !Number.isSafeInteger(entry._data.uncompressedSize) || entry._data.uncompressedSize>limit)throw new Error(`OpenDocument missing or oversized ${name}`);
    const data=await entry.async('nodebuffer');if(data.length>limit)throw new Error(`OpenDocument oversized ${name}`);
    try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new Error(`OpenDocument ${name} must be UTF-8`);}
  };
  if((await read('mimetype',256)).trim()!=='application/vnd.oasis.opendocument.text')throw new Error('File is not an OpenDocument Text document');
  const xml=await read('content.xml',20*1024*1024);
  if(/<!DOCTYPE/i.test(xml))throw new Error('OpenDocument XML DOCTYPE is not supported');
  const parser=new SaxesParser({xmlns:true}),lines=[],diagnostics=new Set();
  let depth=0,bodyDepth=0,textDepth=0,paragraphDepth=0,skipDepth=0,paragraph='';
  parser.on('opentag',tag=>{
    depth++;
    if(tag.uri===OFFICE && tag.local==='body')bodyDepth=depth;
    if(bodyDepth && tag.uri===OFFICE && tag.local==='text' && !textDepth)textDepth=depth;
    if(!textDepth)return;
    if(tag.uri==='urn:oasis:names:tc:opendocument:xmlns:drawing:1.0')diagnostics.add('Drawing, image and embedded-object fidelity is not supported');
    if(!skipDepth && ((tag.uri===OFFICE && tag.local==='annotation') || (tag.uri===TEXT && ['tracked-changes','deletion'].includes(tag.local)))){skipDepth=depth;diagnostics.add('Comments and tracked changes are not included');return;}
    if(skipDepth)return;
    if(!paragraphDepth && tag.uri===TEXT && (tag.local==='p' || tag.local==='h')){paragraphDepth=depth;paragraph='';return;}
    if(!paragraphDepth)return;
    if(tag.uri===TEXT && tag.local==='s'){
      const attr=Object.values(tag.attributes).find(a=>a.uri===TEXT && a.local==='c');const count=attr?Number(attr.value):1;
      if(!Number.isInteger(count)||count<1||count>100000)throw new Error('Invalid OpenDocument space count');paragraph+=' '.repeat(count);
    }else if(tag.uri===TEXT && tag.local==='tab')paragraph+='\t';
    else if(tag.uri===TEXT && tag.local==='line-break')paragraph+='\n';
  });
  const appendText=value=>{if(paragraphDepth && !skipDepth)paragraph+=value.replace(/[\t\r\n ]+/g,' ');};
  parser.on('text',appendText);parser.on('cdata',appendText);
  parser.on('closetag',()=>{
    if(depth===skipDepth)skipDepth=0;
    if(depth===paragraphDepth){const value=paragraph.trim();if(value)lines.push(value);paragraphDepth=0;paragraph='';}
    if(depth===textDepth)textDepth=0;if(depth===bodyDepth)bodyDepth=0;depth--;
  });
  try{parser.write(xml).close();}catch(error){throw new Error(`Invalid OpenDocument XML: ${error.message}`);}
  if(!lines.length)diagnostics.add('No extractable OpenDocument text found');
  return {text:lines.join('\n'),diagnostics:[...diagnostics]};
}
module.exports={extractOdt};
