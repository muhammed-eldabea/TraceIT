'use strict';
(async()=>{
  const vscode=acquireVsCodeApi();
  const status=document.getElementById('status'), canvas=document.getElementById('page'), label=document.getElementById('page-label'), zoomLabel=document.getElementById('zoom-label');
  const previous=document.getElementById('previous'), next=document.getElementById('next'), zoomIn=document.getElementById('zoom-in'), zoomOut=document.getElementById('zoom-out');
  let pdf, loading=false, pageNumber=1, scale=1, renderToken=0, activeRender;
  async function render() {
    if(!pdf)return;
    const token=++renderToken;
    if(activeRender) { activeRender.cancel(); activeRender=null; }
    const page=await pdf.getPage(pageNumber); if(token!==renderToken)return;
    const viewport=page.getViewport({scale});
    if(viewport.width*viewport.height>16000000)throw new Error('Page is too large at this zoom level');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    label.textContent=`Page ${pageNumber} of ${pdf.numPages}`;zoomLabel.textContent=`${Math.round(scale*100)}%`;
    previous.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;zoomOut.disabled=scale<=0.5;zoomIn.disabled=scale>=2;
    status.textContent='Rendering page…';
    const task=page.render({canvasContext:canvas.getContext('2d'),viewport});activeRender=task;
    try { await task.promise; if(token===renderToken){status.textContent='';vscode.postMessage({type:'rendered',page:pageNumber});} }
    catch(error){if(error.name!=='RenderingCancelledException')throw error;}
    finally {if(activeRender===task)activeRender=null;}
  }
  function schedule(){render().catch(error=>{status.textContent=`Could not render page: ${error.message}`;vscode.postMessage({type:'error',message:error.message});});}
  previous.addEventListener('click',()=>{if(pageNumber>1){pageNumber--;schedule();}});
  next.addEventListener('click',()=>{if(pdf && pageNumber<pdf.numPages){pageNumber++;schedule();}});
  zoomOut.addEventListener('click',()=>{scale=Math.max(.5,scale-.25);schedule();});
  zoomIn.addEventListener('click',()=>{scale=Math.min(2,scale+.25);schedule();});
  window.addEventListener('message',async event=>{
    if(!event.data || event.data.type!=='document' || loading || pdf)return;
    loading=true;
    try {
      const pdfjs=await import(document.querySelector('meta[name="pdf-library"]').content);
      const workerResponse=await fetch(document.querySelector('meta[name="pdf-worker"]').content);
      if(!workerResponse.ok)throw new Error('PDF worker could not be loaded');
      const workerUrl=URL.createObjectURL(new Blob([await workerResponse.text()],{type:'text/javascript'}));
      pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      const decoded=atob(event.data.data), data=new Uint8Array(decoded.length);
      for(let i=0;i<decoded.length;i++)data[i]=decoded.charCodeAt(i);
      pdf=await pdfjs.getDocument({data,isEvalSupported:false,useSystemFonts:true}).promise;
      pageNumber=Math.max(1,Math.min(pdf.numPages,Number(event.data.page)||1));
      zoomIn.disabled=false;zoomOut.disabled=false;schedule();
    } catch(error) {status.textContent=`Could not open PDF: ${error.message}`;vscode.postMessage({type:'error',message:error.message});}
  });
  vscode.postMessage({type:'ready'});
})().catch(error=>{document.getElementById('status').textContent=`Could not start PDF viewer: ${error.message}`;});
