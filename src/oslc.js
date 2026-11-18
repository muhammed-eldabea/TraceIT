'use strict';
const { RdfXmlParser } = require('rdfxml-streaming-parser');
const { Readable } = require('stream');
const {xmlLiteralText,extractRdfLiteralText}=require('./xmlLiteral');
const INVERSE = { affectedBy:'affects', constrainedBy:'constrains', decomposedBy:'decomposes', elaboratedBy:'elaborates', implementedBy:'implements', satisfiedBy:'satisfies', specifiedBy:'specifies', trackedBy:'tracks', validatedBy:'validates' };
const NS = { rdf:'http://www.w3.org/1999/02/22-rdf-syntax-ns#', rdfs:'http://www.w3.org/2000/01/rdf-schema#', dc:'http://purl.org/dc/terms/', oslc:'http://open-services.net/ns/core#', rm:'http://open-services.net/ns/rm#', jazzRm:'http://jazz.net/ns/rm#', ldp:'http://www.w3.org/ns/ldp#' };
async function parseRdf(xml, baseIRI) {
  const parser = new RdfXmlParser({baseIRI});
  const output = Readable.from([xml]).pipe(parser);
  const quads = [];
  for await (const quad of output) quads.push(quad);
  return quads;
}
function validateConfigurationContext(value) {
  if(typeof value!=='string' || /[\x00-\x20\x7f]/.test(value))throw new Error('DOORS Next configuration context must be an HTTPS URL without whitespace');
  let url;try{url=new URL(value);}catch{throw new Error('DOORS Next configuration context must be an HTTPS URL');}
  if(url.protocol!=='https:' || url.username || url.password)throw new Error('DOORS Next configuration context must be an HTTPS URL without credentials');
  return value;
}
async function queryRequirements(source, credentials, fetchFn = fetch) {
  const context=source.configurationContext===undefined || source.configurationContext==='' ? undefined : validateConfigurationContext(source.configurationContext);
  const initial = new URL(source.queryUrl);
  if (initial.protocol !== 'https:' || initial.username || initial.password || initial.hash) throw new Error('OSLC query URL must be HTTPS without embedded credentials or fragment');
  if (!credentials.origin || initial.origin !== credentials.origin) throw new Error('OSLC query origin does not match the configured connection');
  const auth = credentials.kind === 'basic' ? `Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`).toString('base64')}` : credentials.kind === 'bearer' ? `Bearer ${credentials.secret}` : null;
  if (!auth || !credentials.secret || (credentials.kind === 'basic' && !credentials.username)) throw new Error('Invalid DOORS Next credentials');
  const allowed = value => { const url = new URL(value, initial); if (url.protocol !== 'https:' || url.origin !== initial.origin || url.username || url.password) throw new Error('OSLC pagination or resource URL has an unexpected origin'); return url.toString(); };
  const get = async value => {
    const url = allowed(value);
    const headers = {Accept:'application/rdf+xml', Authorization:auth, 'OSLC-Core-Version':'2.0'};
    if (context) headers['Configuration-Context'] = context;
    const response = await fetchFn(url, {headers, redirect:'manual', signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`DOORS Next OSLC request failed (HTTP ${response.status}); check query URL, permissions, and authentication`);
    const body = await response.text();
    if (body.length > 20 * 1024 * 1024) throw new Error('OSLC response exceeds 20 MB');
    return {quads:await parseRdf(body,url),xml:body};
  };
  const quads = [], visited = new Set(), members = new Set();
  let next = initial.toString();
  while (next) {
    next = allowed(next);
    if (visited.has(next) || visited.size >= 10000) throw new Error('OSLC pagination cycle or limit reached');
    visited.add(next);
    const {quads:page} = await get(next); quads.push(...page);
    for (const q of page) if ([NS.rdfs+'member', NS.ldp+'contains'].includes(q.predicate.value) && q.object.termType === 'NamedNode') members.add(q.object.value);
    const nextPages = page.filter(q => q.predicate.value === NS.oslc+'nextPage' && q.object.termType === 'NamedNode');
    if (nextPages.length > 1) throw new Error('OSLC response has multiple next pages');
    next = nextPages.length ? nextPages[0].object.value : null;
  }
  const isRequirement = q => q.predicate.value === NS.rdf+'type' && q.object.value === NS.rm+'Requirement' && q.subject.termType === 'NamedNode';
  for (const q of quads) if (isRequirement(q)) members.add(q.subject.value);
  const items = [], relations = [];
  for (const uri of members) {
    // Query pages can project only a title; retrieve the resource to avoid silently
    // omitting descriptions and trace links. Never fall back to partial query data.
    const detailPages = [], detailVisited = new Set();
    let detailNext = uri;
    while (detailNext) {
      detailNext = allowed(detailNext);
      if (detailVisited.has(detailNext) || detailVisited.size >= 10000) throw new Error('OSLC resource pagination cycle or limit reached');
      detailVisited.add(detailNext);
      const detail = await get(detailNext);
      detailPages.push(detail);
      const responseNodes = new Set(detail.quads.filter(q => q.predicate.value === NS.rdf+'type' && q.object.value === NS.oslc+'ResponseInfo').map(q => q.subject.value));
      const nextPages = detail.quads.filter(q => q.predicate.value === NS.oslc+'nextPage' && q.object.termType === 'NamedNode' && (responseNodes.has(q.subject.value) || q.subject.value === uri));
      if (nextPages.length > 1) throw new Error('OSLC resource response has multiple next pages');
      detailNext = nextPages.length ? nextPages[0].object.value : null;
    }
    const properties = detailPages.flatMap(page => page.quads.filter(q => q.subject.value === uri));
    const getTerm = prop => properties.find(q => q.predicate.value === prop)?.object;
    const getValue = prop => getTerm(prop)?.value;
    const hasXmlLiteral=properties.some(q=>q.object.termType==='Literal'&&q.object.datatype?.value===NS.rdf+'XMLLiteral'&&[NS.dc+'title',NS.dc+'description',NS.jazzRm+'primaryText'].includes(q.predicate.value));
    const literalTexts=new Map();
    if (hasXmlLiteral) for (const page of detailPages) for (const [prop,value] of extractRdfLiteralText(page.xml,uri)) if (!literalTexts.has(prop)) literalTexts.set(prop,value);
    const readable=prop=>{const term=getTerm(prop);return term && term.termType==='Literal' && term.datatype?.value===NS.rdf+'XMLLiteral' ? (literalTexts.has(prop)?literalTexts.get(prop):xmlLiteralText(term.value)) : term?.value;};
    const name = readable(NS.dc+'title');
    if (!name) throw new Error('An OSLC query member has no dcterms:title; cannot import incomplete data');
    const id = getValue(NS.dc+'identifier') || uri;
    const primary=readable(NS.jazzRm+'primaryText'),description=readable(NS.dc+'description');
    const attributes=primary!==undefined && description!==undefined ? {description} : {};
    items.push({id:String(id),title:name,text:primary ?? description ?? '',attributes,url:allowed(uri),externalId:uri,references:[]});
    for (const q of properties) if (q.predicate.value.startsWith(NS.rm) && q.object.termType === 'NamedNode') {
      const predicate = q.predicate.value.slice(NS.rm.length);
      const inverse = INVERSE[predicate];
      relations.push(inverse
        ? {from:q.object.value,to:uri,type:inverse,originalPredicate:predicate}
        : {from:uri,to:q.object.value,type:predicate,originalPredicate:predicate});
    }
  }
  return {items, relations};
}
module.exports = { parseRdf, queryRequirements, validateConfigurationContext };
