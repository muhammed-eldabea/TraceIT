'use strict';
const {Worker}=require('worker_threads');
const path=require('path');
function runWorker(task,timeoutMs) {
  return new Promise((resolve,reject)=>{
    let done=false;
    const worker=new Worker(path.join(__dirname,'analysisWorker.js'),{workerData:task,resourceLimits:{maxOldGenerationSizeMb:512}});
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);
      worker.terminate().catch(()=>{});
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error(['extract','edit-xlsx','edit-docx','list-docx-runs','list-pptx-runs','edit-pptx'].includes(task.task) ? 'Document extraction timed out; reduce input size or review the document.' : 'Analysis timed out. Check the regular expressions and reduce input size.')),timeoutMs);
    worker.once('message',message=>message && message.ok ? finish(null,message.result) : finish(new Error(message && message.error || 'Analysis worker failed')));
    worker.once('error',error=>finish(new Error(`Analysis worker failed: ${error.message}`)));
    worker.once('exit',code=>{if(!done)finish(new Error(`Analysis worker exited before returning a result (${code})`));});
  });
}
function analyzeInWorker(config,files,timeoutMs=30000) {
  // VS Code Uri instances are retained on the host for navigation, not sent to worker threads.
  const transferable=files.map(({uri,...file})=>file);
  return runWorker({task:'analyze',config,files:transferable},timeoutMs);
}
function matchInWorker(pattern,text,timeoutMs=5000,all=false) { return runWorker({task:'match',pattern,text,all},timeoutMs); }
function extractInWorker(format,bytes,options={},timeoutMs=30000) {
  if (!['docx','docx-html','xlsx','xlsx-view','pdf','reqifz','pptx','odt'].includes(format)) return Promise.reject(new Error('Unsupported document extraction format'));
  if (bytes.length>20*1024*1024) return Promise.reject(new Error('Document exceeds the 20 MB size limit'));
  return runWorker({task:'extract',format,bytes,options:{sheet:options.sheet}},timeoutMs);
}
function editWorkbookInWorker(bytes,edit,timeoutMs=30000) {
  if(bytes.length>20*1024*1024)return Promise.reject(new Error('Document exceeds the 20 MB size limit'));
  return runWorker({task:'edit-xlsx',bytes,edit},timeoutMs);
}
function editWordInWorker(bytes,edit,timeoutMs=30000) {
  if(bytes.length>20*1024*1024)return Promise.reject(new Error('Document exceeds the 20 MB size limit'));
  return runWorker({task:'edit-docx',bytes,edit},timeoutMs);
}
function listWordRunsInWorker(bytes,timeoutMs=30000) {
  if(bytes.length>20*1024*1024)return Promise.reject(new Error('Document exceeds the 20 MB size limit'));
  return runWorker({task:'list-docx-runs',bytes},timeoutMs);
}
function listPptxRunsInWorker(bytes,slide,timeoutMs=30000){if(bytes.length>20*1024*1024)return Promise.reject(new Error('Document exceeds the 20 MB size limit'));return runWorker({task:'list-pptx-runs',bytes,slide},timeoutMs);}
function editPptxInWorker(bytes,edit,timeoutMs=30000){if(bytes.length>20*1024*1024)return Promise.reject(new Error('Document exceeds the 20 MB size limit'));return runWorker({task:'edit-pptx',bytes,edit},timeoutMs);}
module.exports={analyzeInWorker,matchInWorker,extractInWorker,editWorkbookInWorker,editWordInWorker,listWordRunsInWorker,listPptxRunsInWorker,editPptxInWorker};
