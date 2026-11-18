'use strict';
const JSZip=require('jszip');const {XMLParser,XMLValidator}=require('fast-xml-parser');const {extractPptx}=require('./pptx');
async function readSlide(bytes,slide){
  if(!Number.isInteger(slide)||slide<1)throw new Error('Select a valid slide');
  const extracted=await extractPptx(bytes),file=extracted.slideFiles[slide-1];if(!file)throw new Error('Slide not found');
  const zip=await JSZip.loadAsync(Buffer.from(bytes));if(Object.keys(zip.files).some(name=>/^_xmlsignatures\//i.test(name)||/vbaProject\.bin$/i.test(name)))throw new Error('Signed or macro-enabled presentations are not supported');
  const presentation=await zip.file('ppt/presentation.xml').async('string');if(/<(?:[\w.-]+:)?(?:modifyVerifier|documentProtection)\b/i.test(presentation))throw new Error('Protected presentations are not supported');
  const xml=await zip.file(file).async('string');if(!/xmlns:a=["']http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main["']/.test(xml)||/<!--[\s\S]*?<a:r[\s\S]*?-->|<!\[CDATA\[[\s\S]*?<a:r[\s\S]*?\]\]>/.test(xml))throw new Error('Unsupported slide XML');
  const parser=new XMLParser({parseTagValue:false,trimValues:false});
  const runs=[...xml.matchAll(/<a:r(?:\s[^>]*)?>[\s\S]*?<\/a:r\s*>/g)].map(run=>{const texts=[...run[0].matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t\s*>/g)];if(texts.length!==1)return null;const text=parser.parse(`<t>${texts[0][1]}</t>`).t;return {run,text:typeof text==='string'?text:'',textMatch:texts[0]};});
  if(runs.length>50000)throw new Error('Slide exceeds 50,000 text runs');return {zip,file,xml,runs};
}
async function listPptxRuns(bytes,slide){const {runs}=await readSlide(bytes,slide);return runs.map((entry,index)=>entry && entry.text ? {index,text:entry.text}:null).filter(Boolean);}
async function editPptxRun(bytes,{slide,index,oldText,newText}){
  if(typeof newText!=='string'||/[\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(newText))throw new Error('Replacement must be a single line of valid XML text');
  const {zip,file,xml,runs}=await readSlide(bytes,slide);const selected=Number.isInteger(index)&&runs[index];if(!selected||selected.text!==oldText)throw new Error('Selected text run changed; retry');
  const tag=selected.textMatch[0],opening=tag.match(/^<a:t\b([^>]*)>/);if(!opening)throw new Error('Unsupported PowerPoint text run');
  const attrs=opening[1].replace(/\s+xml:space\s*=\s*(["'])[^"']*\1/g,'');const value=newText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const replacement=`<a:t${attrs} xml:space="preserve">${value}</a:t>`;const offset=selected.run.index+selected.textMatch.index;const updated=xml.slice(0,offset)+replacement+xml.slice(offset+tag.length);
  if(XMLValidator.validate(updated)!==true)throw new Error('Edited PowerPoint XML did not validate');zip.file(file,updated);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={listPptxRuns,editPptxRun};
