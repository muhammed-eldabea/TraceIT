'use strict';
const { parentPort, workerData } = require('worker_threads');
async function run() {
  if (workerData.task === 'analyze') return require('./engine').analyze(workerData.config,workerData.files);
  if (workerData.task === 'list-pptx-runs') return require('./pptxEdit').listPptxRuns(Buffer.from(workerData.bytes),workerData.slide);
  if (workerData.task === 'edit-pptx') return require('./pptxEdit').editPptxRun(Buffer.from(workerData.bytes),workerData.edit);
  if (workerData.task === 'list-docx-runs') return require('./docxEdit').listWordRuns(Buffer.from(workerData.bytes));
  if (workerData.task === 'edit-docx') return require('./docxEdit').editWordText(Buffer.from(workerData.bytes),workerData.edit);
  if (workerData.task === 'edit-xlsx') return require('./xlsxEdit').editTextCell(Buffer.from(workerData.bytes),workerData.edit);
  if (workerData.task === 'extract') {
    const bytes=Buffer.from(workerData.bytes);
    if (workerData.format==='odt') return require('./odt').extractOdt(bytes);
    if (workerData.format==='pptx') return require('./pptx').extractPptx(bytes);
    if (workerData.format==='reqifz') return require('./reqifz').extractReqifz(bytes);
    if (workerData.format==='docx-html') return require('./docx').convertDocxHtml(bytes);
    if (workerData.format==='docx') return require('./docx').extractDocx(bytes);
    if (workerData.format==='xlsx-view') return require('./xlsx').viewXlsx(bytes);
    if (workerData.format==='xlsx') return require('./xlsx').extractXlsx(bytes,workerData.options);
    if (workerData.format==='pdf') return require('./pdf').extractPdf(bytes);
    throw new Error('Unsupported document extraction format');
  }
  if (workerData.task === 'match') {
    const regex=new RegExp(workerData.pattern,workerData.all?'g':''), matches=[];
    workerData.text.split(/\r?\n/).forEach((text,line)=>{
      const lineMatches=workerData.all ? text.matchAll(regex) : [regex.exec(text)].filter(Boolean);
      for(const match of lineMatches) {
        if(matches.length>=50000) throw new Error('Pattern matched more than 50,000 lines; narrow the pattern or document');
        matches.push({line,column:match.index,length:match[0].length,text,groups:match.groups});
      }
    });
    return matches;
  }
  throw new Error('Unknown analysis worker task');
}
run().then(result=>parentPort.postMessage({ok:true,result}),error=>parentPort.postMessage({ok:false,error:error.message}));
