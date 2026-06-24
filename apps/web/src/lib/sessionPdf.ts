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

  const prevApp = app ? { height: app.style.height, maxHeight: app.style.maxHeight } : null;
  const prevWs  = ws  ? { overflow: ws.style.overflow, height: ws.style.height, maxHeight: ws.style.maxHeight } : null;
  const prevWsScroll = ws ? ws.scrollTop : 0;

  if (app) { app.style.height = 'auto'; app.style.maxHeight = 'none'; }
  if (ws)  { ws.style.overflow = 'visible'; ws.style.height = 'auto'; ws.style.maxHeight = 'none'; ws.scrollTop = 0; }

  // Measure block-level element tops AFTER layout mutations so positions match
  // what html2canvas will render. body { overflow:hidden } means scrollY = 0,
  // so getBoundingClientRect().top is stable.
  const innerTop = el.getBoundingClientRect().top;
  const domBreaks = new Set<number>();
  el.querySelectorAll<HTMLElement>(
    '.section, .section p, .section li, .section h2, .section h3, ' +
    '.section pre, .section blockquote, .sources, .ws-lede, .inline-callout'
  ).forEach(child => {
    const relTop = child.getBoundingClientRect().top - innerTop;
    if (relTop > 0) domBreaks.add(relTop);
  });

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
        // secAppear has fill-mode:both → sections freeze at opacity:0 in the clone.
        // animation:none inline kills the effect — animation effects sit above inline
        // styles in the cascade, so opacity:1 alone loses to the fill-mode.
        clonedDoc.querySelectorAll<HTMLElement>('.section.appear').forEach(s => {
          s.style.animation = 'none';
          s.style.opacity = '1';
          s.style.transform = 'none';
        });
      },
    });
  } finally {
    if (app && prevApp) { app.style.height = prevApp.height; app.style.maxHeight = prevApp.maxHeight; }
    if (ws  && prevWs)  { ws.style.overflow = prevWs.overflow; ws.style.height = prevWs.height; ws.style.maxHeight = prevWs.maxHeight; ws.scrollTop = prevWsScroll; }
  }

  const A4_W = 595;
  const A4_H = 842;
  const pdfW = A4_W;
  const MARGIN_TOP_PT = 40;
  const scale = canvas.width / fullWidth;   // always 2 with scale:2 above

  const imgW = canvas.width;
  const imgH = canvas.height;
  const pdfH = pdfW * (imgH / imgW);

  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  if (pdfH <= A4_H) {
    // Centre vertically — this already gives natural top/bottom margins for short content.
    const yOffset = (A4_H - pdfH) / 2;
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, yOffset, pdfW, pdfH);
  } else {
    // Convert DOM break positions → canvas pixels.
    // These are the only rows where a page break is safe (right before a block starts).
    const canvasBreaks = Array.from(domBreaks)
      .map(y => Math.round(y * scale))
      .sort((a, b) => a - b);

    // Each page has MARGIN_TOP_PT reserved at the top, so content height per page is reduced.
    const maxStripPx = Math.floor((A4_H - MARGIN_TOP_PT) * imgW / pdfW);

    let offsetPx = 0;
    let first = true;
    while (offsetPx < imgH) {
      if (!first) doc.addPage();
      first = false;

      const idealEnd = Math.min(offsetPx + maxStripPx, imgH);

      // Last safe break candidate that fits within this page's content area.
      let cutY = idealEnd;
      if (idealEnd < imgH) {
        const candidate = canvasBreaks.filter(b => b > offsetPx && b <= idealEnd).at(-1);
        // Fall back to idealEnd only when no break fits (element taller than one full page).
        cutY = candidate ?? idealEnd;
      }

      const sliceH = Math.max(1, cutY - offsetPx);
      const slice = document.createElement('canvas');
      slice.width = imgW; slice.height = sliceH;
      slice.getContext('2d')!.drawImage(canvas, 0, offsetPx, imgW, sliceH, 0, 0, imgW, sliceH);
      // y = MARGIN_TOP_PT pushes every slice down from the page top edge.
      doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MARGIN_TOP_PT, pdfW, sliceH * (pdfW / imgW));
      offsetPx = cutY;
    }
  }

  const slug = activeNode.title.slice(0, 50).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`${slug}.pdf`);
}
