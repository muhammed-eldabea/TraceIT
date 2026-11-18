'use strict';
const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {sanitizeWordHtml}=require('../src/docx');
const {extractInWorker}=require('../src/workerRunner');
(async()=>{
 const bad='<p onclick="alert(1)">Safe<script>alert(1)</script><a href="javascript:alert(2)">link</a><img src="https://attacker.test/x"><img src="data:image/svg+xml;base64,AAA"><img src="data:image/png;base64,AAA"></p>';
 const safe=sanitizeWordHtml(bad);
 assert.match(safe,/Safe/);assert.doesNotMatch(safe,/script|onclick|javascript:|attacker|svg\+xml/i);assert.match(safe,/data:image\/png;base64/);
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>REQ-1 Bold</w:t></w:r></w:p></w:body></w:document>');
 const result=await extractInWorker('docx-html',await zip.generateAsync({type:'nodebuffer'}));
 assert.match(result.html,/<strong>REQ-1 Bold<\/strong>/);
 console.log('Word visual viewer tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
