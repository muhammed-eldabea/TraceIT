'use strict';
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function renderAttributes(attributes){
  if(!attributes || typeof attributes!=='object' || Array.isArray(attributes))return '';
  const entries=Object.entries(attributes).filter(([,value])=>value!==undefined && value!==null);
  if(!entries.length)return '';
  return `<dl class="artifact-attributes">${entries.map(([key,value])=>{const display=typeof value==='object'?JSON.stringify(value):String(value);return `<dt>${escape(key)}</dt><dd>${escape(display)}</dd>`;}).join('')}</dl>`;
}
module.exports={renderAttributes};
