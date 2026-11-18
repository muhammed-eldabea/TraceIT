'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { extractDocx } = require('../src/docx');
const { analyze } = require('../src/engine');
(async () => {
 const zip = new JSZip();
 zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
 zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
 zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>REQ-</w:t></w:r><w:r><w:t>001: Login</w:t></w:r></w:p><w:p><w:r><w:t>The user shall sign in.</w:t></w:r></w:p></w:body></w:document>`);
 const extracted = await extractDocx(await zip.generateAsync({type:'nodebuffer'}));
 assert.match(extracted.text,/REQ-001: Login/);
 const result = analyze({sources:[{name:'word',format:'docx',include:'*.docx',artifact:'^(?<id>REQ-[0-9]+): (?<title>.+)$'}]},[{source:'word',path:'requirements.docx',text:extracted.text,viewUri:'reqtrace-docx:/x'}]);
 assert.equal(result.artifacts[0].id,'REQ-001');
 assert.equal(result.artifacts[0].viewUri,'reqtrace-docx:/x');
 assert.match(result.artifacts[0].text,/shall sign in/);
 console.log('Word extraction tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
