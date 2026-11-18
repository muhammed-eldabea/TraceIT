'use strict';
const ExcelJS = require('exceljs');
function cellText(cell, diagnostics, sheet) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (Array.isArray(value.richText)) return value.richText.map(run => run.text || '').join('');
    if ('formula' in value || 'sharedFormula' in value) {
      if (value.result == null) { diagnostics.push(`${sheet}!${cell.address}: formula has no cached value`); return ''; }
      return String(value.result);
    }
    if ('text' in value) return String(value.text);
    if ('error' in value) { diagnostics.push(`${sheet}!${cell.address}: ${value.error}`); return String(value.error); }
    return '';
  }
  return value instanceof Date ? value.toISOString() : String(value);
}
async function extractXlsx(bytes, options = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const diagnostics = [], lines = [], lineLocations = [], sheets = options.sheet ? workbook.worksheets.filter(sheet => sheet.name === options.sheet) : workbook.worksheets;
  if (options.sheet && !sheets.length) throw new Error(`Worksheet not found: ${options.sheet}`);
  for (const sheet of sheets) {
    if (sheet.rowCount > 100000 || sheet.columnCount > 1000) throw new Error(`Worksheet ${sheet.name} exceeds 100000 rows or 1000 columns`);
    sheet.eachRow({includeEmpty:false}, (row, number) => {
      const values = [];
      for (let col = 1; col <= row.cellCount; col++) values.push(cellText(row.getCell(col),diagnostics,sheet.name).replace(/[\t\r\n]+/g,' '));
      lines.push(`${sheet.name.replace(/[\t\r\n]+/g,' ')}\t${number}\t${values.join('\t')}`);
      lineLocations.push({sheet:sheet.name,row:number});
    });
  }
  return {text:lines.join('\n'), lineLocations, diagnostics};
}
async function viewXlsx(bytes) {
  const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(bytes));
  const diagnostics=[], sheets=[]; let totalCells=0;
  for(const sheet of workbook.worksheets) {
    if(sheet.rowCount>100000 || sheet.columnCount>1000)throw new Error(`Worksheet ${sheet.name} exceeds 100000 rows or 1000 columns`);
    const rows=[];
    sheet.eachRow({includeEmpty:false},(row,number)=>{
      totalCells+=row.cellCount; if(totalCells>1000000)throw new Error('Workbook view exceeds one million cells');
      const cells=[];for(let col=1;col<=row.cellCount;col++)cells.push(cellText(row.getCell(col),diagnostics,sheet.name));
      rows.push({number,cells});
    });
    sheets.push({name:sheet.name,rows});
  }
  return {sheets,diagnostics};
}
module.exports = {extractXlsx,viewXlsx};
