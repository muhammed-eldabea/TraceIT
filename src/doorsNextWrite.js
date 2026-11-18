'use strict';
const {SaxesParser}=require('saxes');const {parseRdf,validateConfigurationContext}=require('./oslc');const {extractRdfLiteralText}=require('./xmlLiteral');
const RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#',DC='http://purl.org/dc/terms/',XML='http://www.w3.org/XML/1998/namespace';
function connection(credentials,uri,context){
 const url=new URL(uri);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.origin!==credentials.origin)throw new Error('DOORS Next resource URL must be HTTPS on the configured origin without query or fragment');
 const auth=credentials.kind==='basic'?`Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`,'utf8').toString('base64')}`:credentials.kind==='bearer'?`Bearer ${credentials.secret}`:null;if(!auth||!credentials.secret||(credentials.kind==='basic'&&!credentials.username))throw new Error('Invalid DOORS Next credentials');
 const headers={Authorization:auth,Accept:'application/rdf+xml','OSLC-Core-Version':'2.0'};if(context!==undefined&&context!=='')headers['Configuration-Context']=validateConfigurationContext(context);return {url:url.toString(),headers};
}
function replaceTitle(xml,uri,newTitle){
 let depth=0,subjectDepth=0,titleDepth=0,subjectCount=0,titleCount=0,start,end,nested=false,content='';const parser=new SaxesParser({xmlns:true});
 parser.on('opentag',tag=>{depth++;if(Object.values(tag.attributes).some(attr=>attr.uri===XML&&attr.local==='base'))throw new Error('RDF xml:base is not supported for editing');if(titleDepth && depth>titleDepth)nested=true;
   const about=Object.values(tag.attributes).find(attr=>attr.uri===RDF&&attr.local==='about');if(about && new URL(about.value,uri).toString()===uri){subjectCount++;if(subjectDepth)throw new Error('Ambiguous RDF subject');subjectDepth=depth;}
   if(subjectDepth && depth===subjectDepth+1 && tag.uri===DC && tag.local==='title'){titleCount++;if(tag.isSelfClosing)throw new Error('Empty self-closing RDF titles are not supported');titleDepth=depth;start=parser.position;}
 });
 parser.on('text',text=>{if(titleDepth)content+=text;});parser.on('cdata',()=>{if(titleDepth)nested=true;});parser.on('comment',()=>{if(titleDepth)nested=true;});parser.on('processinginstruction',()=>{if(titleDepth)nested=true;});
 parser.on('closetag',()=>{if(titleDepth===depth){end=xml.lastIndexOf('</',parser.position);titleDepth=0;}if(subjectDepth===depth)subjectDepth=0;depth--;});
 parser.write(xml).close();if(subjectCount!==1||titleCount!==1||start===undefined||end===undefined||nested)throw new Error('RDF title is ambiguous or contains unsupported markup');
 const escaped=newTitle.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return {body:xml.slice(0,start)+escaped+xml.slice(end),original:content};
}
async function prepareDoorsTitleUpdate(source,credentials,{uri,expectedTitle,newTitle},fetchFn=fetch){
 if(typeof expectedTitle!=='string'||typeof newTitle!=='string'||!newTitle.trim()||newTitle.length>4096||/[\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(newTitle))throw new Error('Enter a nonempty single-line title of at most 4096 characters');
 const {url,headers}=connection(credentials,uri,source.configurationContext);const response=await fetchFn(url,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`DOORS Next resource request failed (HTTP ${response.status})`);const etag=response.headers?.get('etag');if(!etag||!/^"[\x21\x23-\x7e]*"$/.test(etag))throw new Error('DOORS Next did not provide a strong ETag');
 const xml=await response.text();if(xml.length>20*1024*1024||/<!DOCTYPE/i.test(xml))throw new Error('Unsupported or oversized DOORS Next RDF');const quads=await parseRdf(xml,url);
 if(quads.some(q=>q.predicate.value==='http://open-services.net/ns/core#nextPage'))throw new Error('Paged RDF resources cannot be updated safely');
 const titles=quads.filter(q=>q.subject.termType==='NamedNode'&&q.subject.value===url&&q.predicate.value===DC+'title'&&q.object.termType==='Literal');if(titles.length!==1)throw new Error('DOORS Next resource has an ambiguous or missing title');
 const replacement=replaceTitle(xml,url,newTitle);if(replacement.original!==expectedTitle)throw new Error('The DOORS Next title changed since analysis; refresh and retry');
 return {uri:url,context:source.configurationContext,etag,body:replacement.body,expectedTitle,newTitle};
}
async function applyDoorsTitleUpdate(credentials,plan,fetchFn=fetch){
 const {url,headers}=connection(credentials,plan.uri,plan.context);if(!/^"[\x21\x23-\x7e]*"$/.test(plan.etag)||typeof plan.body!=='string')throw new Error('Invalid DOORS Next update plan');
 let response;try{response=await fetchFn(url,{method:'PUT',headers:{...headers,'Content-Type':'application/rdf+xml; charset=utf-8','If-Match':plan.etag},body:plan.body,redirect:'manual',signal:AbortSignal.timeout(30000)});}catch(error){throw new Error(`DOORS Next update outcome is unknown; refresh before retrying (${error.message})`);}
 if(!response.ok)throw new Error(response.status>=500?`DOORS Next update outcome is unknown (HTTP ${response.status}); refresh before retrying`:`DOORS Next update was rejected (HTTP ${response.status}); refresh before retrying`);return {updated:true};
}
function primarySegments(xml,uri){
 let depth=0,subjectDepth=0,propertyDepth=0,subjectCount=0,propertyCount=0,lastMarkupEnd=0;const segments=[];const parser=new SaxesParser({xmlns:true});
 parser.on('opentag',tag=>{depth++;if(Object.values(tag.attributes).some(a=>a.uri===XML&&a.local==='base'))throw new Error('RDF xml:base is not supported for editing');
   if(!propertyDepth){const about=Object.values(tag.attributes).find(a=>a.uri===RDF&&a.local==='about');if(about&&new URL(about.value,uri).toString()===uri){subjectCount++;if(subjectDepth)throw new Error('Ambiguous RDF subject');subjectDepth=depth;}
     if(subjectDepth&&depth===subjectDepth+1&&tag.uri==='http://jazz.net/ns/rm#'&&tag.local==='primaryText') {propertyCount++;const parseType=Object.values(tag.attributes).find(a=>a.uri===RDF&&a.local==='parseType');if(!parseType||parseType.value!=='Literal'||tag.isSelfClosing)throw new Error('Only RDF XML-literal primary text is supported');propertyDepth=depth;}}
   lastMarkupEnd=parser.position;
 });
 parser.on('text',text=>{if(!propertyDepth||!text.trim())return;const end=parser.position-1,start=lastMarkupEnd,raw=xml.slice(start,end);if(end<start||raw.includes('<'))throw new Error('Unsupported primary text structure');segments.push({index:segments.length,text,start,end,raw});if(segments.length>50000)throw new Error('Primary text has too many segments');});
 const unsupported=()=>{if(propertyDepth)throw new Error('Comments, CDATA, and processing instructions inside primary text are unsupported');};parser.on('cdata',unsupported);parser.on('comment',unsupported);parser.on('processinginstruction',unsupported);
 parser.on('closetag',()=>{if(propertyDepth===depth)propertyDepth=0;if(subjectDepth===depth)subjectDepth=0;depth--;lastMarkupEnd=parser.position;});parser.write(xml).close();
 if(subjectCount!==1||propertyCount!==1)throw new Error('RDF primary text is ambiguous or missing');return segments;
}
async function prepareDoorsPrimaryTextUpdate(source,credentials,{uri,expectedText},fetchFn=fetch){
 if(typeof expectedText!=='string')throw new Error('Invalid expected primary text');const {url,headers}=connection(credentials,uri,source.configurationContext);
 const response=await fetchFn(url,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`DOORS Next resource request failed (HTTP ${response.status})`);
 const etag=response.headers?.get('etag');if(!etag||!/^"[\x21\x23-\x7e]*"$/.test(etag))throw new Error('DOORS Next did not provide a strong ETag');
 const xml=await response.text();if(xml.length>20*1024*1024||/<!DOCTYPE/i.test(xml))throw new Error('Unsupported or oversized DOORS Next RDF');const quads=await parseRdf(xml,url);
 if(quads.some(q=>q.predicate.value==='http://open-services.net/ns/core#nextPage'))throw new Error('Paged RDF resources cannot be updated safely');
 const properties=quads.filter(q=>q.subject.termType==='NamedNode'&&q.subject.value===url&&q.predicate.value==='http://jazz.net/ns/rm#primaryText'&&q.object.termType==='Literal');if(properties.length!==1)throw new Error('DOORS Next primary text is ambiguous or missing');
 const actual=extractRdfLiteralText(xml,url).get('http://jazz.net/ns/rm#primaryText');if(actual===undefined||actual!==expectedText)throw new Error('The DOORS Next primary text changed since analysis; refresh and retry');
 return {uri:url,context:source.configurationContext,etag,xml,segments:primarySegments(xml,url)};
}
function buildDoorsPrimaryTextUpdate(plan,index,oldText,newText){
 if(!Number.isInteger(index)||typeof oldText!=='string'||typeof newText!=='string'||newText.length>1000000||/[\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(newText))throw new Error('Replacement must be a single line of valid XML text');
 const segment=plan && Array.isArray(plan.segments) && plan.segments[index];if(!segment||segment.index!==index||segment.text!==oldText||typeof plan.xml!=='string'||plan.xml.slice(segment.start,segment.end)!==segment.raw)throw new Error('The selected primary text segment changed; retry');
 const escaped=newText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');const body=plan.xml.slice(0,segment.start)+escaped+plan.xml.slice(segment.end);
 const validator=new SaxesParser({xmlns:true});validator.write(body).close();return {uri:plan.uri,context:plan.context,etag:plan.etag,body};
}
module.exports={prepareDoorsTitleUpdate,applyDoorsTitleUpdate,prepareDoorsPrimaryTextUpdate,buildDoorsPrimaryTextUpdate};
