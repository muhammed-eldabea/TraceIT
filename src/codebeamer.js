'use strict';

// Codebeamer Swagger v2 item query; credentials are supplied by the caller.
async function queryItems(source, credentials, fetchFn = fetch) {
  const base = new URL(credentials.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Codebeamer URL must be HTTPS without credentials, query, or fragment');
  if (typeof source.query !== 'string' || !source.query.trim()) throw new Error('Codebeamer source needs a cbQL query');
  const version=source.apiVersion || 'v2';
  if(!['v2','v3'].includes(version)) throw new Error('Unsupported Codebeamer API version; choose v2 or v3');
  const endpoint = new URL(`${base.pathname.replace(/\/$/, '')}/api/${version==='v3'?'v3/items/query':'v2/item'}`, base.origin);
  const auth = credentials.kind === 'basic' ? `Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`, 'utf8').toString('base64')}` : credentials.kind === 'bearer' ? `Bearer ${credentials.secret}` : null;
  if (!auth || !credentials.secret || (credentials.kind === 'basic' && !credentials.username)) throw new Error('Invalid Codebeamer credentials');
  let page = 1, expected, items = [];
  while (true) {
    endpoint.search = new URLSearchParams({page:String(page), pageSize:'100', queryString:source.query}).toString();
    const response = await fetchFn(endpoint.toString(), {headers:{Authorization:auth, Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Codebeamer query failed (HTTP ${response.status}); check authentication, server URL, API version, and query`);
    const body = await response.json();
    if (!Array.isArray(body.items) || !Number.isInteger(body.total) || body.total < 0) throw new Error('Codebeamer returned an unexpected response; no partial data imported');
    if (expected === undefined) expected = body.total;
    else if (body.total !== expected) throw new Error('Codebeamer results changed during pagination; refresh again');
    if (body.items.some(item => item.id == null || typeof item.name !== 'string')) throw new Error('Codebeamer returned an item without id or name');
    items.push(...body.items);
    if (items.length > expected) throw new Error('Codebeamer returned more items than expected');
    if (items.length === expected) break;
    if (!body.items.length || page >= 10000) throw new Error('Codebeamer returned incomplete pagination; no partial data imported');
    page++;
  }
  if (new Set(items.map(x => String(x.id))).size !== items.length) throw new Error('Codebeamer returned duplicate item IDs; refresh again');
  return items.map(item => ({ id:String(item.id), externalId:`codebeamer:item:${item.id}`, title:item.name, text:typeof item.description === 'string' ? item.description : '', url:new URL(`${base.pathname.replace(/\/$/, '')}/issue/${encodeURIComponent(item.id)}`, base.origin).toString(), trackerId:item.tracker && item.tracker.id != null ? String(item.tracker.id) : undefined, descriptionAvailable:typeof item.description==='string', attributes:{type:item.type,status:item.status,version:item.version,tracker:item.tracker,priority:item.priority,assignedTo:item.assignedTo,descriptionFormat:item.descriptionFormat,modifiedAt:item.modifiedAt,customFields:item.customFields}, references:[] }));
}
async function queryTrackerFields(credentials,trackerId,fieldId,fetchFn=fetch) {
  if(!/^\d+$/.test(String(trackerId)) || (fieldId!==undefined && !/^\d+$/.test(String(fieldId))))throw new Error('Codebeamer tracker and field IDs must be numeric');
  const base=new URL(credentials.baseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('Codebeamer URL must be HTTPS without credentials, query, or fragment');
  const auth=credentials.kind==='basic'?`Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`,'utf8').toString('base64')}`:credentials.kind==='bearer'?`Bearer ${credentials.secret}`:null;
  if(!auth||!credentials.secret||(credentials.kind==='basic'&&!credentials.username))throw new Error('Invalid Codebeamer credentials');
  const suffix=fieldId===undefined?'':`/${fieldId}`;
  const endpoint=new URL(`${base.pathname.replace(/\/$/,'')}/api/v3/trackers/${trackerId}/fields${suffix}`,base.origin);
  const response=await fetchFn(endpoint.toString(),{headers:{Authorization:auth,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Codebeamer field discovery failed (HTTP ${response.status}); check v3 API support and permissions`);
  const data=await response.json();
  if(fieldId===undefined){if(!Array.isArray(data)||data.some(field=>!field || !/^\d+$/.test(String(field.id)) || typeof field.name!=='string'))throw new Error('Unexpected Codebeamer field list');}
  else if(!data || typeof data!=='object' || Array.isArray(data) || String(data.id)!==String(fieldId) || typeof data.name!=='string')throw new Error('Unexpected Codebeamer field definition');
  return data;
}
module.exports = { queryItems,queryTrackerFields };

// REST v1 association schema per PTC's documented from/to/type properties.
async function queryAssociations(source, credentials, items, fetchFn = fetch) {
  const base = new URL(credentials.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Codebeamer URL must be HTTPS without embedded credentials');
  const auth = credentials.kind === 'basic' ? `Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`, 'utf8').toString('base64')}` : credentials.kind === 'bearer' ? `Bearer ${credentials.secret}` : null;
  if (!auth || !credentials.secret || (credentials.kind === 'basic' && !credentials.username)) throw new Error('Invalid Codebeamer credentials');
  if(source.associationApi && !['v1','v3'].includes(source.associationApi)) throw new Error('Unsupported Codebeamer association API; choose v1 or v3');
  if(source.associationApi==='v3') return queryV3Associations(base,auth,items,fetchFn);
  const relations = [], seen = new Set();
  for (const item of items) {
    if (!/^\d+$/.test(item.id)) throw new Error('Codebeamer association query requires numeric item IDs');
    const endpoint = new URL(`${base.pathname.replace(/\/$/, '')}/rest/item/${item.id}/associations`, base.origin);
    // Include links pointing to the item, including those from outside the query.
    endpoint.searchParams.set('inout','true');
    const response = await fetchFn(endpoint.toString(), {headers:{Authorization:auth,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Codebeamer association query failed (HTTP ${response.status}); no partial associations imported`);
    const body = await response.json();
    const entries = Array.isArray(body) ? body : body && body.associations;
    if (!Array.isArray(entries) || (body && !Array.isArray(body) && (body.next || body.nextPage || (Number.isInteger(body.total) && body.total !== entries.length)))) throw new Error('Unsupported or incomplete Codebeamer association response');
    for (const association of entries) {
      if (!association || typeof association.from !== 'string' || typeof association.type !== 'string' || (typeof association.to !== 'string' && typeof association.url !== 'string')) throw new Error('Unexpected Codebeamer association structure');
      const parseItem = value => { const match = /^\/item\/(\d+)$/.exec(value || ''); return match ? match[1] : null; };
      const from = parseItem(association.from), to = parseItem(association.to);
      const type = association.type.replace(/^\/association\/type\//,'');
      if (!from) throw new Error('Unexpected Codebeamer association source');
      const target = to || association.to || association.url;
      const key = JSON.stringify([from,target,type]);
      if (!seen.has(key)) { relations.push({from:`codebeamer:item:${from}`,to:to ? `codebeamer:item:${to}` : target,type,originalPredicate:association.type}); seen.add(key); }
    }
  }
  return relations;
}
module.exports.queryAssociations = queryAssociations;

// V3 lists association IDs per item; resolve each ID to obtain endpoints and type.
async function queryV3Associations(base,auth,items,fetchFn) {
  const ids=new Set(), relations=[], prefix=base.pathname.replace(/\/$/,'');
  relations.diagnostics=[];
  const get=async pathname=>{
    const url=new URL(`${prefix}/api/v3/${pathname}`,base.origin);
    const response=await fetchFn(url.toString(),{headers:{Authorization:auth,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Codebeamer v3 association request failed (HTTP ${response.status}); no partial associations imported`);
    return response.json();
  };
  for(const item of items) {
    if(!/^\d+$/.test(String(item.id)))throw new Error('Codebeamer association query requires numeric item IDs');
    const body=await get(`items/${item.id}/relations`);
    if(!body || !Array.isArray(body.incomingAssociations) || !Array.isArray(body.outgoingAssociations))throw new Error('Unsupported Codebeamer v3 relations response');
    if(body.isLastPage===false || body.nextPage || body.next)throw new Error('Incomplete Codebeamer v3 relations pagination; no partial associations imported');
    if([body.upstreamReferences,body.downstreamReferences].some(value=>Array.isArray(value) && value.length))relations.diagnostics.push(`Item ${item.id}: Codebeamer tracker references are not imported; coverage may be incomplete`);
    for(const entry of [...body.incomingAssociations,...body.outgoingAssociations]) {
      if(!entry || !/^\d+$/.test(String(entry.id)))throw new Error('Invalid Codebeamer v3 association ID');
      ids.add(String(entry.id));
    }
  }
  for(const id of ids) {
    const entry=await get(`associations/${id}`);
    const from=entry && entry.from, to=entry && entry.to, type=entry && entry.type && entry.type.name;
    if(!from || from.type!=='TrackerItemReference' || !/^\d+$/.test(String(from.id)) || typeof type!=='string' || !type)throw new Error('Unsupported Codebeamer v3 association details');
    let target;
    if(to && to.type==='TrackerItemReference' && /^\d+$/.test(String(to.id)))target=`codebeamer:item:${to.id}`;
    else if(typeof entry.url==='string' && entry.url)target=entry.url;
    else throw new Error('Unsupported Codebeamer v3 association target');
    relations.push({from:`codebeamer:item:${from.id}`,to:target,type,originalPredicate:type});
  }
  return relations;
}
