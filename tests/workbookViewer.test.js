'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');const ExcelJS=require('exceljs');const {extractXlsx,viewXlsx}=require('../src/xlsx');const {analyze}=require('../src/engine');
(async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Requirements');sheet.getRow(120).values=['REQ-120','<img src=x onerror=alert(1)>'];sheet.getRow(122).values=['REQ-122','Next'];book.addWorksheet('Tests').addRow(['TEST-1']);
 const bytes=await book.xlsx.writeBuffer(), extraction=await extractXlsx(bytes,{sheet:'Requirements'}), model=await viewXlsx(bytes);
 assert.deepEqual(extraction.lineLocations[0],{sheet:'Requirements',row:120});
 const source={name:'excel',format:'xlsx',include:'*.xlsx',artifact:'^[^\\t]+\\t[0-9]+\\t(?<id>REQ-[0-9]+)\\t(?<title>.+)$'};
 const result=analyze({sources:[source]},[{source:'excel',path:'req.xlsx',...extraction,originalUri:'file:///req.xlsx',originalFormat:'xlsx'}]);
 assert.deepEqual(result.artifacts[0].workbookLocation,{sheet:'Requirements',row:120});
 const messages=[];const html='<html><body><select id="sheet"></select><button id="edit"></button><button id="previous"></button><button id="next"></button><span id="page"></span><div id="status"></div><table><thead id="head"></thead><tbody id="body"></tbody></table><script>'+fs.readFileSync(require.resolve('../resources/workbook-viewer.js'),'utf8')+'</script></body></html>';
 const dom=new JSDOM(html,{runScripts:'dangerously',beforeParse(window){window.acquireVsCodeApi=()=>({postMessage(value){messages.push(value);}});}});
 dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'workbook',model,location:{sheet:'Requirements',row:120}}}));
 const document=dom.window.document;assert.equal(document.querySelector('#sheet').value,'0');assert.equal(document.querySelector('.highlight th').textContent,'120');assert.equal(document.querySelector('#body img'),null);assert.match(document.querySelector('.highlight').textContent,/<img/);
 document.querySelector('#sheet').value='1';document.querySelector('#sheet').dispatchEvent(new dom.window.Event('change'));assert.match(document.querySelector('#body').textContent,/TEST-1/);
 const cell=document.querySelector('#body td');assert.equal(cell.getAttribute('aria-label'),'A1: TEST-1');cell.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.ok(cell.classList.contains('selected-cell'));document.querySelector('#edit').click();assert.equal(messages.at(-1).type,'edit');assert.equal(messages.at(-1).sheet,'Tests');assert.equal(messages.at(-1).address,'A1');
 assert.equal(messages[0].type,'ready');assert.equal(messages[1].type,'rendered');dom.window.close();
 console.log('Workbook visual viewer tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
