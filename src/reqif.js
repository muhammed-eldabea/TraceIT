'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const valueText = value => {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value).filter(([k]) => !k.startsWith('@_')).flatMap(([, v]) => list(v).map(valueText)).filter(Boolean).join(' ');
};
function orderedXhtmlValues(text) {
  const tree=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,preserveOrder:true,parseTagValue:false,trimValues:false,transformTagName:name=>name.replace(/-/g,'_')}).parse(text);
  const child=(nodes,key)=>nodes && nodes.find(node=>Array.isArray(node[key]))?.[key];
  const content=child(child(child(tree,'REQ_IF'),'CORE_CONTENT'),'REQ_IF_CONTENT');
  const objects=child(content,'SPEC_OBJECTS') || [];
  const render=nodes=>{
    const parts=[],stack=(nodes || []).slice().reverse().map(node=>({node}));
    while(stack.length){const entry=stack.pop();if(entry.break){parts.push('\n');continue;}const node=entry.node;if(!node||typeof node!=='object')continue;
      if(Object.hasOwn(node,'#text')){parts.push(String(node['#text']).replace(/\s+/g,' '));continue;}
      const key=Object.keys(node).find(k=>k!==':@');if(!key)continue;
      const block=/^(?:p|div|li|tr|h[1-6]|br)$/i.test(key);
      if(block)parts.push('\n');if(block)stack.push({break:true});
      const children=node[key];if(Array.isArray(children))for(let i=children.length-1;i>=0;i--)stack.push({node:children[i]});
    }
    return parts.join('').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim();
  };
  const objectValues=objects.filter(node=>Array.isArray(node.SPEC_OBJECT)).map(object=>{
    const values=child(object.SPEC_OBJECT,'VALUES') || [];
    return values.filter(node=>Array.isArray(node.ATTRIBUTE_VALUE_XHTML)).map(node=>render(child(node.ATTRIBUTE_VALUE_XHTML,'THE_VALUE')));
  });
  const relationValues=(child(content,'SPEC_RELATIONS') || []).filter(node=>Array.isArray(node.SPEC_RELATION)).map(relation=>{
    const values=child(relation.SPEC_RELATION,'VALUES') || [];
    return values.filter(node=>Array.isArray(node.ATTRIBUTE_VALUE_XHTML)).map(node=>render(child(node.ATTRIBUTE_VALUE_XHTML,'THE_VALUE')));
  });
  const defaults=new Map();
  for(const type of (child(content,'SPEC_TYPES') || []).filter(node=>Array.isArray(node.SPEC_OBJECT_TYPE) || Array.isArray(node.SPEC_RELATION_TYPE))) {
    const typeKind=Array.isArray(type.SPEC_OBJECT_TYPE)?'SPEC_OBJECT_TYPE':'SPEC_RELATION_TYPE';
    const typeId=type[':@'] && type[':@']['@_IDENTIFIER'];
    for(const definition of child(type[typeKind],'SPEC_ATTRIBUTES') || []) {
      if(!Array.isArray(definition.ATTRIBUTE_DEFINITION_XHTML))continue;
      const id=definition[':@'] && definition[':@']['@_IDENTIFIER'];
      const value=child(child(definition.ATTRIBUTE_DEFINITION_XHTML,'DEFAULT_VALUE'),'ATTRIBUTE_VALUE_XHTML');
      if(typeId && id && value)defaults.set(JSON.stringify([typeKind,String(typeId),String(id)]),render(child(value,'THE_VALUE')));
    }
  }
  return {objectValues,relationValues,defaults};
}
function parseReqif(text, source, path, options = {}) {
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`Invalid ReqIF XML: ${valid.err.msg}`);
  const parsed = new XMLParser({ ignoreAttributes:false, removeNSPrefix:true, allowBooleanAttributes:true, parseTagValue:false, transformTagName: name => name.replace(/-/g, '_') }).parse(text);
  const content = parsed.REQ_IF && parsed.REQ_IF.CORE_CONTENT && parsed.REQ_IF.CORE_CONTENT.REQ_IF_CONTENT;
  if (!content) throw new Error('Not a ReqIF document: REQ-IF-CONTENT is missing');
  const artifacts = [], diagnostics = [], map = new Map(), definitions = new Map(), objectDefaults = new Map(), relationDefaults = new Map(), relationTypes = new Map(), enumValues = new Map();
  for (const datatype of list(content.DATATYPES && content.DATATYPES.DATATYPE_DEFINITION_ENUMERATION)) {
    for (const value of list(datatype && datatype.SPECIFIED_VALUES && datatype.SPECIFIED_VALUES.ENUM_VALUE)) {
      if(value && value['@_IDENTIFIER']) {const id=String(value['@_IDENTIFIER']);if(enumValues.has(id))diagnostics.push(`${path}: duplicate ReqIF enumeration ID ${id}`);else enumValues.set(id,String(value['@_LONG-NAME'] || id));}
    }
  }
  const types = content.SPEC_TYPES || {};
  for(const type of list(types.SPEC_RELATION_TYPE))if(type && type['@_IDENTIFIER']){const id=String(type['@_IDENTIFIER']);if(relationTypes.has(id))diagnostics.push(`${path}: duplicate ReqIF relation type ID ${id}`);else relationTypes.set(id,String(type['@_LONG-NAME'] || id));}
  for (const group of Object.values(types)) for (const type of list(group)) {
    for (const definitionsByType of Object.values((type && type.SPEC_ATTRIBUTES) || {})) for (const definition of list(definitionsByType)) {
      if (definition && definition['@_IDENTIFIER']) definitions.set(String(definition['@_IDENTIFIER']), String(definition['@_LONG-NAME'] || definition['@_IDENTIFIER']));
    }
  }
  for (const [groupName,defaultsMap] of [['SPEC_OBJECT_TYPE',objectDefaults],['SPEC_RELATION_TYPE',relationDefaults]]) for (const type of list(types[groupName])) {
    if (!type || !type['@_IDENTIFIER']) continue;
    const defaults=[];
    for (const group of Object.values(type.SPEC_ATTRIBUTES || {})) for (const definition of list(group)) {
      if (!definition || !definition['@_IDENTIFIER'] || !definition.DEFAULT_VALUE) continue;
      const entry=Object.entries(definition.DEFAULT_VALUE).find(([key])=>key.startsWith('ATTRIBUTE_VALUE_'));
      if (entry) defaults.push({ref:String(definition['@_IDENTIFIER']),kind:entry[0],value:entry[1]});
    }
    defaultsMap.set(String(type['@_IDENTIFIER']),defaults);
  }
  const xhtml=/<(?:[\w.-]+:)?ATTRIBUTE-VALUE-XHTML\b/i.test(text) ? orderedXhtmlValues(text) : {objectValues:[],relationValues:[],defaults:new Map()};
  let objectIndex=0;
  for (const object of list(content.SPEC_OBJECTS && content.SPEC_OBJECTS.SPEC_OBJECT)) {
    const xhtmlValues=xhtml.objectValues[objectIndex++] || [];let xhtmlIndex=0;
    const internalId = object['@_IDENTIFIER'];
    if (!internalId) { diagnostics.push(`${path}: ReqIF object missing IDENTIFIER`); continue; }
    const attributes = {}, extracts = [], explicitDefinitions = new Set();
    const addAttribute=(name,ref,raw)=>{
      if (!raw) return;
      extracts.push(raw);if(!name)return;
      let key=name;
      if (Object.hasOwn(attributes,key)) {
        diagnostics.push(`${path}: ${internalId} has duplicate ReqIF attribute name ${name}; values were retained with distinct keys`);
        const base=`${name} [${ref || 'unknown definition'}]`;key=base;
        let suffix=2;while(Object.hasOwn(attributes,key))key=`${base} (${suffix++})`;
      }
      Object.defineProperty(attributes,key,{value:raw,enumerable:true,configurable:true,writable:true});
    };
    for (const [valueType,group] of Object.entries(object.VALUES || {})) for (const value of list(group)) {
      if (!value || typeof value !== 'object') continue;
      const refs = Object.values(value.DEFINITION || {});
      const ref = refs.length ? valueText(refs[0]) : '';
      if(ref)explicitDefinitions.add(ref);
      const name = definitions.get(ref) || ref;
      const enumRefs=list(value.VALUES && value.VALUES.ENUM_VALUE_REF).map(String);
      const orderedXhtml=valueType==='ATTRIBUTE_VALUE_XHTML' ? xhtmlValues[xhtmlIndex++] : undefined;
      const raw = orderedXhtml!==undefined ? orderedXhtml : enumRefs.length ? enumRefs.map(id=>{if(!enumValues.has(id))diagnostics.push(`${path}: unknown ReqIF enumeration value ${id}`);return enumValues.get(id) || id;}).join(', ') : value['@_THE-VALUE'] != null ? String(value['@_THE-VALUE']) : valueText(value.THE_VALUE);
      addAttribute(name,ref,raw);
    }
    const objectType=valueText(object.TYPE && object.TYPE.SPEC_OBJECT_TYPE_REF);
    for (const {ref,kind,value} of objectDefaults.get(objectType) || []) {
      if(explicitDefinitions.has(ref))continue;
      if(kind==='ATTRIBUTE_VALUE_XHTML'){
        const key=JSON.stringify(['SPEC_OBJECT_TYPE',objectType,ref]);
        if(!xhtml.defaults.has(key))diagnostics.push(`${path}: ${internalId} has an unreadable ReqIF XHTML default for ${ref}`);
        else addAttribute(definitions.get(ref) || ref,ref,xhtml.defaults.get(key));
        continue;
      }
      const enumRefs=list(value && value.VALUES && value.VALUES.ENUM_VALUE_REF).map(String);
      const raw=enumRefs.length ? enumRefs.map(id=>{if(!enumValues.has(id))diagnostics.push(`${path}: unknown ReqIF enumeration value ${id}`);return enumValues.get(id)||id;}).join(', ') : value && value['@_THE-VALUE'] != null ? String(value['@_THE-VALUE']) : '';
      addAttribute(definitions.get(ref) || ref,ref,raw);
    }
    const pick = (option, fallback) => {
      if (!option) return fallback;
      if (!Object.hasOwn(attributes,option)) diagnostics.push(`${path}: ${internalId} has no populated attribute '${option}'`);
      return Object.hasOwn(attributes,option) ? attributes[option] : fallback;
    };
    const id = String(pick(options.idAttribute, internalId));
    const title = String(pick(options.titleAttribute, object['@_LONG-NAME'] || extracts[0] || id));
    const body = String(pick(options.textAttribute, extracts.join('\n')));
    const escaped = String(internalId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\bIDENTIFIER\\s*=\\s*(["'])${escaped}\\1`).exec(text);
    const line = match ? text.slice(0, match.index).split('\n').length : 1;
    const artifact = { id, externalId:String(internalId), title, source, path, line, text: body, attributes, references: [] };
    const key = String(internalId);
    if (map.has(key)) { map.set(key, null); diagnostics.push(`${path}: duplicate ReqIF object ID ${key}`); }
    else map.set(key, artifact);
    artifacts.push(artifact);
  }
  let hierarchyCount=0;
  for(const specification of list(content.SPECIFICATIONS && content.SPECIFICATIONS.SPECIFICATION)) {
    const name=String(specification['@_LONG-NAME'] || specification['@_IDENTIFIER'] || 'Specification');
    const root=list(specification.CHILDREN && specification.CHILDREN.SPEC_HIERARCHY);
    const stack=root.slice().reverse().map(node=>({node,ancestors:[]}));
    while(stack.length){
      if(++hierarchyCount>100000)throw new Error('ReqIF hierarchy exceeds 100,000 nodes');
      const {node,ancestors}=stack.pop();if(!node || typeof node!=='object')continue;
      if(ancestors.length>500)throw new Error('ReqIF hierarchy exceeds 500 levels');
      const ref=valueText(node.OBJECT && node.OBJECT.SPEC_OBJECT_REF), artifact=map.get(ref);
      if(!artifact)diagnostics.push(`${path}: ReqIF hierarchy references missing or ambiguous object ${ref || '(empty)'}`);
      else {if(!artifact.hierarchy)artifact.hierarchy=[];artifact.hierarchy.push({specification:name,ancestors,nodeId:String(node['@_IDENTIFIER'] || '')});}
      const next=ancestors.concat(artifact ? artifact.id : ref || '(missing)');
      for(const child of list(node.CHILDREN && node.CHILDREN.SPEC_HIERARCHY).slice().reverse())stack.push({node:child,ancestors:next});
    }
  }
  const relations = [];
  let relationIndex=0;
  for (const relation of list(content.SPEC_RELATIONS && content.SPEC_RELATIONS.SPEC_RELATION)) {
    const relationXhtml=xhtml.relationValues[relationIndex++] || [];let xhtmlIndex=0;
    const from = valueText(relation.SOURCE && relation.SOURCE.SPEC_OBJECT_REF);
    const to = valueText(relation.TARGET && relation.TARGET.SPEC_OBJECT_REF);
    if (!map.get(from) || !map.get(to)) diagnostics.push(`${path}: unresolved or ambiguous ReqIF relation ${from} → ${to}`);
    else {
      const typeId=valueText(relation.TYPE && relation.TYPE.SPEC_RELATION_TYPE_REF);
      if(typeId && !relationTypes.has(typeId))diagnostics.push(`${path}: unknown ReqIF relation type ${typeId}`);
      const attributes={},explicitDefinitions=new Set();
      const addAttribute=(name,ref,raw)=>{
        if(!name || !raw)return;
        let key=name;if(Object.hasOwn(attributes,key)){diagnostics.push(`${path}: duplicate ReqIF relation attribute name ${name}`);const base=`${name} [${ref || 'unknown definition'}]`;key=base;let suffix=2;while(Object.hasOwn(attributes,key))key=`${base} (${suffix++})`;}
        Object.defineProperty(attributes,key,{value:raw,enumerable:true,configurable:true,writable:true});
      };
      for(const [kind,group] of Object.entries(relation.VALUES || {}))for(const value of list(group)){
        if(!value || typeof value!=='object')continue;
        const ref=valueText(Object.values(value.DEFINITION || {})[0]), name=definitions.get(ref) || ref;
        if(ref)explicitDefinitions.add(ref);
        if(kind==='ATTRIBUTE_VALUE_XHTML'){const raw=relationXhtml[xhtmlIndex++];if(raw===undefined)diagnostics.push(`${path}: ReqIF relation ${relation['@_IDENTIFIER'] || '(unnamed)'} has an unreadable XHTML attribute ${name}`);else addAttribute(name,ref,raw);continue;}
        const enumRefs=list(value.VALUES && value.VALUES.ENUM_VALUE_REF).map(String);
        const raw=enumRefs.length ? enumRefs.map(id=>{if(!enumValues.has(id))diagnostics.push(`${path}: unknown ReqIF enumeration value ${id}`);return enumValues.get(id)||id;}).join(', ') : value['@_THE-VALUE'] != null ? String(value['@_THE-VALUE']) : '';
        addAttribute(name,ref,raw);
      }
      for(const {ref,kind,value} of relationDefaults.get(typeId) || []){
        if(explicitDefinitions.has(ref))continue;
        if(kind==='ATTRIBUTE_VALUE_XHTML'){const key=JSON.stringify(['SPEC_RELATION_TYPE',typeId,ref]);if(!xhtml.defaults.has(key))diagnostics.push(`${path}: ReqIF relation ${relation['@_IDENTIFIER'] || '(unnamed)'} has an unreadable XHTML default ${ref}`);else addAttribute(definitions.get(ref)||ref,ref,xhtml.defaults.get(key));continue;}
        const enumRefs=list(value && value.VALUES && value.VALUES.ENUM_VALUE_REF).map(String);
        const raw=enumRefs.length ? enumRefs.map(id=>{if(!enumValues.has(id))diagnostics.push(`${path}: unknown ReqIF enumeration value ${id}`);return enumValues.get(id)||id;}).join(', ') : value && value['@_THE-VALUE'] != null ? String(value['@_THE-VALUE']) : '';
        addAttribute(definitions.get(ref)||ref,ref,raw);
      }
      relations.push({from:map.get(from),to:map.get(to),type:relationTypes.get(typeId) || relation['@_LONG-NAME'] || typeId || 'ReqIF relation',line:map.get(from).line,...(Object.keys(attributes).length ? {attributes} : {})});
    }
  }
  return { artifacts, relations, diagnostics };
}
module.exports = { parseReqif };
