'use strict';
const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {extractInWorker,analyzeInWorker}=require('../src/workerRunner');
const content=`<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:text><text:h>REQ-1: System</text:h><text:p>First <text:span>bold</text:span><text:s text:c="2"/>text<text:tab/>end<text:line-break/>next</text:p><office:annotation><text:p>Do not import comment</text:p></office:annotation><table:table><table:table-row><table:table-cell><text:p>TEST-1: verifies REQ-1</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>`;
async function archive(xml=content,mime='application/vnd.oasis.opendocument.text'){const zip=new JSZip();zip.file('mimetype',mime);zip.file('content.xml',xml);return zip.generateAsync({type:'nodebuffer'});}
(async()=>{
 const extracted=await extractInWorker('odt',await archive());
 assert.equal(extracted.text,'REQ-1: System\nFirst bold  text\tend\nnext\nTEST-1: verifies REQ-1');
 assert.doesNotMatch(extracted.text,/Do not import comment/);
 const config={sources:[{name:'doc',format:'odt',include:'*.odt',artifact:'^(?<id>REQ-[0-9]+): (?<title>.+)$'}],links:[]};
 const result=await analyzeInWorker(config,[{source:'doc',path:'spec.odt',text:extracted.text}]);assert.equal(result.artifacts[0].id,'REQ-1');
 await assert.rejects(extractInWorker('odt',await archive(content,'application/vnd.oasis.opendocument.spreadsheet')),/OpenDocument Text/);
 await assert.rejects(extractInWorker('odt',await archive('<!DOCTYPE x><x/>')),/DOCTYPE|Invalid/);
 console.log('OpenDocument Text extraction tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
