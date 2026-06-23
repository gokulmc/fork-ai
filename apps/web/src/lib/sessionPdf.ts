import type { ForkNode } from './types';

export async function exportNodePdf(activeNode: ForkNode): Promise<void> {
  const el = document.querySelector('.workspace-inner') as HTMLElement | null;
  if (!el) return;

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim() || '#ffffff';

  const app = document.querySelector('.app') as HTMLElement | null;
  const ws  = document.querySelector('.workspace') as HTMLElement | null;

  // Save inline styles (empty string = not set)
  const prevApp = app ? { height: app.style.height, maxHeight: app.style.maxHeight } : null;
  const prevWs  = ws  ? { overflow: ws.style.overflow, height: ws.style.height, maxHeight: ws.style.maxHeight } : null;
  const prevWsScroll = ws ? ws.scrollTop : 0;

  // Keep .app as display:grid (preserves column layout) — just lift the 100vh height cap.
  // Change .workspace overflow so the grid cell expands to full content height.
  if (app) { app.style.height = 'auto'; app.style.maxHeight = 'none'; }
  if (ws)  { ws.style.overflow = 'visible'; ws.style.height = 'auto'; ws.style.maxHeight = 'none'; ws.scrollTop = 0; }

  // Reading scrollHeight forces a synchronous reflow — no RAF needed.
  const fullHeight = el.scrollHeight;
  const fullWidth  = el.offsetWidth;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: bg,
      width: fullWidth,
      height: fullHeight,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        const cApp = clonedDoc.querySelector('.app') as HTMLElement | null;
        const cWs  = clonedDoc.querySelector('.workspace') as HTMLElement | null;
        if (cApp) { cApp.style.height = 'auto'; cApp.style.maxHeight = 'none'; }
        if (cWs)  { cWs.style.overflow = 'visible'; cWs.style.height = 'auto'; cWs.style.maxHeight = 'none'; cWs.scrollTop = 0; }
        // secAppear animation resets to opacity:0 in the clone — remove the class so all sections render fully opaque.
        clonedDoc.querySelectorAll<HTMLElement>('.section.appear').forEach(s => {
          s.classList.remove('appear');
          s.style.opacity = '1';
          s.style.transform = 'none';
        });
      },
    });
  } finally {
    if (app && prevApp) { app.style.height = prevApp.height; app.style.maxHeight = prevApp.maxHeight; }
    if (ws  && prevWs)  { ws.style.overflow = prevWs.overflow; ws.style.height = prevWs.height; ws.style.maxHeight = prevWs.maxHeight; ws.scrollTop = prevWsScroll; }
  }

  const imgW = canvas.width;
  const imgH = canvas.height;
  const A4_W = 595;
  const A4_H = 842;
  const pdfW = A4_W;
  const pdfH = pdfW * (imgH / imgW);

  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  if (pdfH <= A4_H) {
    const yOffset = (A4_H - pdfH) / 2;
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, yOffset, pdfW, pdfH);
  } else {
    const stripHPx = Math.floor(imgH / Math.ceil(pdfH / A4_H));
    let offsetPx = 0;
    let first = true;
    while (offsetPx < imgH) {
      if (!first) doc.addPage();
      first = false;
      const sliceH = Math.min(stripHPx, imgH - offsetPx);
      const slice = document.createElement('canvas');
      slice.width = imgW; slice.height = sliceH;
      slice.getContext('2d')!.drawImage(canvas, 0, offsetPx, imgW, sliceH, 0, 0, imgW, sliceH);
      doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, sliceH * (pdfW / imgW));
      offsetPx += sliceH;
    }
  }

  const slug = activeNode.title.slice(0, 50).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`${slug}.pdf`);
}
