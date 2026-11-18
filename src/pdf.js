'use strict';
async function extractPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = require('url').pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:true});
  const document = await task.promise;
  const lines = [], linePages = [], diagnostics = [];
  try {
    if (document.numPages > 2000) throw new Error('PDF exceeds the 2000-page limit');
    for (let number=1; number<=document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const pageLines = []; let current = '', lastY;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform && item.transform[5];
        if (current && Number.isFinite(y) && Number.isFinite(lastY) && Math.abs(y-lastY)>2) { pageLines.push(current.trim()); current=''; }
        if (item.str) { if (current && !/\s$/.test(current) && !/^\s/.test(item.str)) current += ' '; current += item.str; }
        lastY = y;
        if (item.hasEOL && current) { pageLines.push(current.trim()); current=''; }
      }
      if (current) pageLines.push(current.trim());
      lines.push(`[Page ${number}]`); linePages.push(number);
      for (const line of pageLines.filter(Boolean)) { lines.push(line); linePages.push(number); }
      if (!pageLines.some(line => line.trim())) diagnostics.push(`Page ${number}: no extractable text; image-only pages need OCR`);
      page.cleanup();
    }
    return {text:lines.join('\n'), linePages, diagnostics};
  } finally { await document.destroy(); }
}
module.exports = {extractPdf};
