'use strict';
async function updateCodebeamerField(credentials,request,mode,fetchFn=fetch){
 const {itemId,trackerId,expectedVersion,expectedText,newText,expectedFormat,fieldId,fieldName}=request || {};
 if(!['name','description'].includes(mode)||!/^\d+$/.test(String(itemId))||!/^\d+$/.test(String(trackerId))||!/^\d+$/.test(String(fieldId))||!Number.isSafeInteger(Number(fieldId))||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||typeof expectedText!=='string'||typeof newText!=='string'||(mode==='name'&&(!newText.trim()||newText.length>4096))||(mode==='description'&&(expectedText.length>1000000||newText.length>1000000||!['Wiki','PlainText'].includes(expectedFormat)))||typeof fieldName!=='string'||!fieldName.trim())throw new Error('Invalid Codebeamer field update request');
 const base=new URL(credentials.baseUrl);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('Codebeamer URL must be HTTPS without credentials, query, or fragment');
 const auth=credentials.kind==='basic'?`Basic ${Buffer.from(`${credentials.username}:${credentials.secret}`,'utf8').toString('base64')}`:credentials.kind==='bearer'?`Bearer ${credentials.secret}`:null;if(!auth||!credentials.secret||(credentials.kind==='basic'&&!credentials.username))throw new Error('Invalid Codebeamer credentials');
 const prefix=`${base.pathname.replace(/\/$/,'')}/api/v3/`,endpoint=part=>new URL(prefix+part,base.origin).toString();
 const send=async(part,method='GET',body)=>fetchFn(endpoint(part),{method,headers:{Authorization:auth,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
 const existing=await send(`items/${itemId}/lock`);if(!existing.ok)throw new Error(`Could not inspect Codebeamer lock (HTTP ${existing.status})`);if((await existing.text()).trim())throw new Error('The Codebeamer item is already locked');
 const lockStarted=performance.now();
 let acquired;try{acquired=await send(`items/${itemId}/lock`,'PUT',{duration:'5m',hard:false});}catch(cause){throw new Error(`Lock acquisition outcome is unknown; a temporary lock may remain for up to five minutes (${cause.message})`);}
 if(!acquired.ok)throw new Error(`Could not acquire Codebeamer lock (HTTP ${acquired.status})`);
 let outcome,error;
 try{
  const itemResponse=await send(`items/${itemId}`);if(!itemResponse.ok)throw new Error(`Could not read Codebeamer item (HTTP ${itemResponse.status})`);const item=await itemResponse.json();
  if(!item||String(item.id)!==String(itemId)||String(item.tracker?.id)!==String(trackerId)||item.version!==expectedVersion||item[mode]!==expectedText||(mode==='description'&&item.descriptionFormat!==expectedFormat))throw new Error('The Codebeamer item changed since analysis; refresh and retry');
  const fieldResponse=await send(`trackers/${trackerId}/fields/${fieldId}`);if(!fieldResponse.ok)throw new Error(`Could not read Codebeamer field definition (HTTP ${fieldResponse.status})`);const field=await fieldResponse.json();
  if(!field||String(field.id)!==String(fieldId)||field.name!==fieldName||field.hidden===true||field.valueModel!==(mode==='name'?'TextFieldValue':'WikiTextFieldValue')||field.trackerItemField!==mode)throw new Error('The selected field is not a supported item text field');
  if(performance.now()-lockStarted>=240000)throw new Error('The temporary lock may have expired; no update was sent');
  let response;try{response=await send(`items/${itemId}/fields`,'PUT',{fieldValues:[{fieldId:Number(fieldId),type:mode==='name'?'TextFieldValue':'WikiTextFieldValue',name:fieldName,value:newText}]});}catch(cause){throw new Error(`Codebeamer update outcome is unknown; refresh before retrying (${cause.message})`);}
  if(!response.ok)throw new Error(response.status>=500 ? `Codebeamer update outcome is unknown (HTTP ${response.status}); refresh before retrying` : `Codebeamer update was rejected (HTTP ${response.status}); refresh before retrying`);outcome={updated:true};
 }catch(cause){error=cause;}
 if(performance.now()-lockStarted>=240000)throw new Error(`${outcome?'Update succeeded':'Update did not complete'}; the lock may have expired and was not released automatically. Refresh and check the item.${error ? ` Original error: ${error.message}` : ''}`);
 try{const released=await send(`items/${itemId}/lock`,'DELETE');if(!released.ok)throw new Error(`HTTP ${released.status}`);}catch(cause){const prefix=outcome?'Update succeeded, but':'Could not complete update and';throw new Error(`${prefix} lock release failed (${cause.message}). The temporary lock may remain until it expires.${error ? ` Original error: ${error.message}` : ''}`);}
 if(error)throw error;return outcome;
}
function updateCodebeamerName(credentials,request,fetchFn=fetch){return updateCodebeamerField(credentials,{...request,expectedText:request.expectedName,newText:request.newName},'name',fetchFn);}
function updateCodebeamerDescription(credentials,request,fetchFn=fetch){return updateCodebeamerField(credentials,request,'description',fetchFn);}
module.exports={updateCodebeamerName,updateCodebeamerDescription};
