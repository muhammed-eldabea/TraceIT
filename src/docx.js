'use strict';
const mammoth = require('mammoth');
const sanitizeHtml = require('sanitize-html');
async function extractDocx(bytes) {
  const result = await mammoth.extractRawText({buffer:Buffer.from(bytes)});
  return {text:result.value, diagnostics:result.messages.map(message => `Word import: ${message.message}`)};
}
function sanitizeWordHtml(html) {
  return sanitizeHtml(html, {
    allowedTags:['p','h1','h2','h3','h4','h5','h6','strong','em','b','i','u','s','sup','sub','br','ul','ol','li','blockquote','pre','code','table','thead','tbody','tfoot','tr','th','td','img','a'],
    allowedAttributes:{img:['src','alt'],th:['colspan','rowspan'],td:['colspan','rowspan']},
    allowedSchemes:[], allowedSchemesByTag:{img:['data']}, allowProtocolRelative:false,
    exclusiveFilter:frame=>frame.tag==='img' && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(frame.attribs.src || '')
  });
}
async function convertDocxHtml(bytes) {
  const result=await mammoth.convertToHtml({buffer:Buffer.from(bytes)});
  return {html:sanitizeWordHtml(result.value),diagnostics:result.messages.map(message=>message.message)};
}
module.exports = { extractDocx, sanitizeWordHtml, convertDocxHtml };
