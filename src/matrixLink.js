'use strict';
function validateMatrixRequest(entry,request){
  if(!request || !request.from || !request.to || ![request.from.source,request.from.id,request.to.source,request.to.id,request.type].every(x=>typeof x==='string'&&x.trim()))throw new Error('Invalid matrix link request');
  if(!(entry.config.links || []).some(rule=>rule.from===request.from.source&&rule.to===request.to.source&&(rule.type||'references')===request.type))throw new Error('The matrix rule changed; refresh and retry');
  const find=endpoint=>entry.result.artifacts.filter(a=>a.source===endpoint.source&&a.id===endpoint.id);
  const from=find(request.from),to=find(request.to);
  if(from.length!==1||to.length!==1)throw new Error('A matrix artifact is missing or ambiguous; refresh and resolve duplicate IDs');
  return {from:from[0],to:to[0]};
}
function matrixLink(entry,request){
  const {from,to}=validateMatrixRequest(entry,request);
  if(entry.result.links.some(link=>link.from===from&&link.to===to&&link.type===request.type))throw new Error('This link already exists');
  return {from:{source:request.from.source,id:request.from.id},to:{source:request.to.source,id:request.to.id},type:request.type};
}
function matrixUnlink(entry,request){
  validateMatrixRequest(entry,request);
  const matches=link=>link.from.source===request.from.source&&link.from.id===request.from.id&&link.to.source===request.to.source&&link.to.id===request.to.id&&link.type===request.type;
  const links=entry.config.manualLinks || [];
  if(links.filter(matches).length!==1)throw new Error('The manual link no longer exists or is ambiguous');
  return links.filter(link=>!matches(link));
}
module.exports={matrixLink,matrixUnlink};
