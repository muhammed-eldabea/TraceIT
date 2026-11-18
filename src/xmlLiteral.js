'use strict';
const {XMLParser,XMLValidator}=require('fast-xml-parser');
function xmlLiteralText(value){
  if(typeof value!=='string'||/<!DOCTYPE/i.test(value))throw new Error('Unsupported RDF XML literal');
  const wrapped=`<root>${value}</root>`;if(XMLValidator.validate(wrapped)!==true)throw new Error('Invalid RDF XML literal');
  const tree=new XMLParser({preserveOrder:true,removeNSPrefix:true,parseTagValue:false,trimValues:false}).parse(wrapped);
  const parts=[],stack=tree.slice().reverse().map(node=>({node}));
  while(stack.length){const entry=stack.pop();if(entry.break){parts.push('\n');continue;}const node=entry.node;if(!node||typeof node!=='object')continue;
    if(Object.hasOwn(node,'#text')){parts.push(String(node['#text']).replace(/\s+/g,' '));continue;}
    const key=Object.keys(node).find(k=>k!==':@');if(!key)continue;const block=/^(?:p|div|li|tr|h[1-6]|br)$/i.test(key);
    if(block){parts.push('\n');stack.push({break:true});}const children=node[key];if(Array.isArray(children))for(let i=children.length-1;i>=0;i--)stack.push({node:children[i]});
  }
  return parts.join('').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim();
}
module.exports={xmlLiteralText};

// Read parseType="Literal" directly from the original RDF/XML. The RDF parser's
// reconstructed lexical form may contain decoded bare < and & characters.
function extractRdfLiteralText(xml,subjectUri){
  const {SaxesParser}=require('saxes');const rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#',xmlNs='http://www.w3.org/XML/1998/namespace';
  const wanted=new Set(['http://purl.org/dc/terms/title','http://purl.org/dc/terms/description','http://jazz.net/ns/rm#primaryText']);
  const result=new Map(),subjects=[],bases=[subjectUri],parser=new SaxesParser({xmlns:true});let depth=0,capture;
  const attr=(tag,uri,local)=>Object.values(tag.attributes).find(a=>a.uri===uri&&a.local===local)?.value;
  const block=tag=>/^(?:p|div|li|tr|h[1-6]|br)$/i.test(tag.local);
  parser.on('opentag',tag=>{depth++;const base=attr(tag,xmlNs,'base');bases.push(base?new URL(base,bases[bases.length-1]).toString():bases[bases.length-1]);
    if(capture){if(block(tag))capture.parts.push('\n');return;}
    const about=attr(tag,rdf,'about');if(about!==undefined)subjects.push({depth,uri:new URL(about,bases[bases.length-1]).toString()});
    const owner=subjects[subjects.length-1],property=tag.uri+tag.local;
    if(owner && owner.uri===subjectUri && depth===owner.depth+1 && wanted.has(property) && attr(tag,rdf,'parseType')==='Literal')capture={depth,property,parts:[]};
  });
  const append=value=>{if(capture)capture.parts.push(String(value).replace(/\s+/g,' '));};parser.on('text',append);parser.on('cdata',append);
  parser.on('closetag',tag=>{if(capture){if(depth===capture.depth){if(!result.has(capture.property))result.set(capture.property,capture.parts.join('').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim());capture=undefined;}else if(block(tag))capture.parts.push('\n');}if(subjects.length&&subjects[subjects.length-1].depth===depth)subjects.pop();bases.pop();depth--;});
  parser.write(xml).close();return result;
}
module.exports.extractRdfLiteralText=extractRdfLiteralText;
