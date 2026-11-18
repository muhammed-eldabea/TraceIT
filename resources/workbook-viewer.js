'use strict';
(()=>{
  const vscode=acquireVsCodeApi(), sheetSelect=document.getElementById('sheet'),previous=document.getElementById('previous'),next=document.getElementById('next'),page=document.getElementById('page'),status=document.getElementById('status'),head=document.getElementById('head'),body=document.getElementById('body');
  let model, offset=0, selectedRow, selectedCell;
  const size=100;
  function columnName(number){let name='';for(let n=number;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
  function render(){
    const sheet=model.sheets[Number(sheetSelect.value)];head.replaceChildren();body.replaceChildren();
    if(!sheet){status.textContent='This workbook has no worksheets.';page.textContent='Rows —';previous.disabled=true;next.disabled=true;vscode.postMessage({type:'rendered',sheet:null,row:null});return;}
    const subset=sheet.rows.slice(offset,offset+size), columnCount=subset.reduce((max,row)=>Math.max(max,row.cells.length),0);
    const header=document.createElement('tr');const blank=document.createElement('th');blank.textContent='Row';blank.className='row-number';header.appendChild(blank);
    for(let col=1;col<=columnCount;col++){const th=document.createElement('th');th.textContent=columnName(col);th.scope='col';header.appendChild(th);}head.appendChild(header);
    for(const row of subset){const tr=document.createElement('tr');if(row.number===selectedRow)tr.className='highlight';const th=document.createElement('th');th.scope='row';th.className='row-number';th.textContent=String(row.number);tr.appendChild(th);for(let col=0;col<columnCount;col++){const td=document.createElement('td');td.textContent=row.cells[col] || '';const address=columnName(col+1)+row.number;td.tabIndex=0;td.setAttribute('role','button');td.setAttribute('aria-label',`${address}: ${td.textContent}`);td.addEventListener('click',()=>selectCell(td,address));td.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCell(td,address);}});tr.appendChild(td);}body.appendChild(tr);}
    const highlighted=body.querySelector('.highlight'); if(highlighted && typeof highlighted.scrollIntoView==='function')highlighted.scrollIntoView({block:'center'});
    previous.disabled=offset===0;next.disabled=offset+size>=sheet.rows.length;
    page.textContent=sheet.rows.length?`Rows ${offset+1}–${Math.min(offset+size,sheet.rows.length)} of ${sheet.rows.length} populated rows`:'No populated rows';
    status.textContent=`Read-only workbook view. Formula cells show saved values; the workbook is not recalculated.${model.diagnostics.length ? ` ${model.diagnostics.length} formula or cell issue(s) reported.` : ''}`;
    vscode.postMessage({type:'rendered',sheet:sheet.name,row:selectedRow || null});
  }
  function selectCell(td,address){const old=body.querySelector('.selected-cell');if(old)old.classList.remove('selected-cell');td.classList.add('selected-cell');selectedCell=address;status.textContent=`Selected ${address}. Choose Edit text cell in copy to update it.`;}
  document.getElementById('edit').addEventListener('click',()=>{const sheet=model && model.sheets[Number(sheetSelect.value)];if(sheet)vscode.postMessage({type:'edit',sheet:sheet.name,address:selectedCell});});
  sheetSelect.addEventListener('change',()=>{offset=0;selectedRow=undefined;selectedCell=undefined;render();});
  previous.addEventListener('click',()=>{offset=Math.max(0,offset-size);selectedRow=undefined;selectedCell=undefined;render();});
  next.addEventListener('click',()=>{offset+=size;selectedRow=undefined;selectedCell=undefined;render();});
  window.addEventListener('message',event=>{
    if(!event.data || event.data.type!=='workbook' || model)return;
    try {model=event.data.model;for(const [index,sheet] of model.sheets.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=sheet.name;sheetSelect.appendChild(option);}
      const requested=event.data.location;let index=requested?model.sheets.findIndex(sheet=>sheet.name===requested.sheet):-1;if(index<0)index=0;sheetSelect.value=String(index);
      const sheet=model.sheets[index];if(sheet && requested && requested.sheet===sheet.name && Number.isInteger(requested.row)){selectedRow=requested.row;const rowIndex=sheet.rows.findIndex(row=>row.number>=requested.row);if(rowIndex>=0)offset=Math.floor(rowIndex/size)*size;}
      render();
    }catch(error){status.textContent=`Could not display workbook: ${error.message}`;vscode.postMessage({type:'error',message:error.message});}
  });
  vscode.postMessage({type:'ready'});
})();
