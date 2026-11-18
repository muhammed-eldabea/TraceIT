'use strict';
const JSZip=require('jszip');
const {XMLParser,XMLValidator}=require('fast-xml-parser');
async function readRuns(bytes){
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  if(Object.keys(zip.files).some(name=>/^_xmlsignatures\//i.test(name)||/vbaProject\.bin$/i.test(name)))throw new Error('Signed or macro-enabled documents are not supported');
  const entry=zip.file('word/document.xml');if(!entry)throw new Error('Word document body is missing');
  const xml=await entry.async('string');
  if(XMLValidator.validate(xml)!==true || /<!DOCTYPE/i.test(xml) || !/xmlns:w=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/.test(xml))throw new Error('Unsupported Word document XML');
  const settings=zip.file('word/settings.xml');if(settings && /<(?:\w+:)?documentProtection\b/.test(await settings.async('string')))throw new Error('Protected documents cannot be edited');
  if(/<w:(?:ins|del|moveFrom|moveTo)\b/.test(xml))throw new Error('Documents with tracked changes are not supported');
  if(/<!--[\s\S]*?<w:t[\s\S]*?-->|<!\[CDATA\[[\s\S]*?<w:t[\s\S]*?\]\]>/.test(xml))throw new Error('Unsupported text inside an XML comment or CDATA section');
  const parser=new XMLParser({parseTagValue:false,trimValues:false});
  const matches=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t\s*>/g)].map(match=>({match,text:parser.parse(`<t>${match[1]}</t>`).t || ''}));
  if(matches.length>50000)throw new Error('Word document exceeds 50,000 text runs');
  return {zip,xml,matches};
}
async function listWordRuns(bytes){const {matches}=await readRuns(bytes);return matches.map((entry,index)=>({index,text:entry.text})).filter(entry=>entry.text);}
async function editWordText(bytes,{oldText,newText,index}){
  if(typeof oldText!=='string'||!oldText||typeof newText!=='string')throw new Error('Enter existing and replacement text');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(newText)||/[\r\n\t]/.test(newText))throw new Error('Replacement must be a single line of valid XML text');
  const {zip,xml,matches}=await readRuns(bytes);
  let selected;
  if(index!==undefined){if(!Number.isInteger(index)||!matches[index]||matches[index].text!==oldText)throw new Error('Selected text run changed; retry');selected=matches[index];}
  else {const matching=matches.filter(entry=>entry.text===oldText);if(matching.length!==1)throw new Error('Find text must match exactly one complete text run in the document');selected=matching[0];}
  const match=selected.match, opening=match[0].match(/^<w:t\b([^>]*)>/);if(!opening)throw new Error('Unsupported text run');
  const attrs=opening[1].replace(/\s+xml:space\s*=\s*(["'])[^"']*\1/g,'');
  const escaped=newText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const replacement=`<w:t${attrs} xml:space="preserve">${escaped}</w:t>`;
  const output=xml.slice(0,match.index)+replacement+xml.slice(match.index+match[0].length);
  if(XMLValidator.validate(output)!==true)throw new Error('Edited Word XML did not validate');
  zip.file('word/document.xml',output);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={editWordText,listWordRuns};
