'use strict';
const assert=require('node:assert/strict');const ExcelJS=require('exceljs');const JSZip=require('jszip');const {editTextCell}=require('../src/xlsxEdit');
(async()=>{
 const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Requirements');ws.getCell('A1').value='REQ-1';ws.getCell('B1').value='Original';ws.getCell('B1').font={bold:true};ws.getCell('C1').value={formula:'1+1',result:2};ws.getCell('D1').value={richText:[{text:'Rich',font:{bold:true}}]};ws.mergeCells('E1:F1');ws.getCell('E1').value='Merged';
 const input=Buffer.from(await wb.xlsx.writeBuffer()), output=await editTextCell(input,{sheet:'Requirements',address:'B1',value:'New <text> & more'});
 const verify=new ExcelJS.Workbook();await verify.xlsx.load(output);const sheet=verify.getWorksheet('Requirements');assert.equal(sheet.getCell('B1').value,'New <text> & more');assert.equal(sheet.getCell('B1').font.bold,true);assert.equal(sheet.getCell('A1').value,'REQ-1');assert.equal(sheet.getCell('C1').value.formula,'1+1');
 const oldZip=await JSZip.loadAsync(input),newZip=await JSZip.loadAsync(output);
 for(const name of Object.keys(oldZip.files).filter(x=>!oldZip.files[x].dir && x!=='xl/worksheets/sheet1.xml'))assert.deepEqual(await oldZip.file(name).async('nodebuffer'),await newZip.file(name).async('nodebuffer'),name);
 await assert.rejects(editTextCell(input,{sheet:'Requirements',address:'C1',value:'x'}),/Only existing plain-text/);
 await assert.rejects(editTextCell(input,{sheet:'Requirements',address:'D1',value:'x'}),/Only existing plain-text/);
 await assert.rejects(editTextCell(input,{sheet:'Requirements',address:'E1',value:'x'}),/Merged/);
 await assert.rejects(editTextCell(input,{sheet:'Missing',address:'A1',value:'x'}),/Worksheet not found/);
 await assert.rejects(editTextCell(input,{sheet:'Requirements',address:'B1',value:'bad\u0000'}),/unsupported characters/);
 const signed=await JSZip.loadAsync(input);signed.file('_xmlsignatures/sig1.xml','signature');await assert.rejects(editTextCell(await signed.generateAsync({type:'nodebuffer'}),{sheet:'Requirements',address:'B1',value:'x'}),/Signed/);
 console.log('Workbook text edit tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
