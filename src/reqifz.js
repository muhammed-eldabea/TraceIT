'use strict';
const JSZip=require('jszip');
async function extractReqifz(bytes){
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  const entries=Object.values(zip.files);if(entries.length>10000)throw new Error('ReqIFz archive has too many entries');
  const documents=entries.filter(entry=>!entry.dir && /\.reqif$/i.test(entry.name));
  if(documents.length!==1)throw new Error('ReqIFz archive must contain exactly one ReqIF document');
  const entry=documents[0];
  if(!entry._data || !Number.isSafeInteger(entry._data.uncompressedSize) || entry._data.uncompressedSize>20*1024*1024)throw new Error('ReqIF document exceeds the 20 MB size limit');
  const buffer=await entry.async('nodebuffer');if(buffer.length>20*1024*1024)throw new Error('ReqIF document exceeds the 20 MB size limit');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('ReqIFz XML must be UTF-8');}
  if(/^\s*<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["'])/i.test(text))throw new Error('ReqIFz XML must declare UTF-8 encoding');
  return {text,entry:entry.name};
}
module.exports={extractReqifz};
