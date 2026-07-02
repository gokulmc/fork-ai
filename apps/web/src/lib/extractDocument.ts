// Client-side text extraction for the document-upload feature. PDFs are parsed
// with pdfjs-dist (dynamically imported). For scanned/image PDFs or direct
// image uploads, Tesseract.js runs OCR — also lazy-loaded so neither library
// costs anything on the happy path.

import type { PDFDocumentProxy } from 'pdfjs-dist';

const MAX_CHARS = 40_000;
const MAX_PAGES = 50;
const MAX_OCR_PAGES = 10;

export interface ExtractResult {
  text: string;
  truncated: boolean;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isText(file: File): boolean {
  return file.type.startsWith('text/') || /\.(txt|md|markdown|text)$/i.test(file.name);
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/') ||
    /\.(jpe?g|png|gif|bmp|webp|tiff?|avif|heic)$/i.test(file.name);
}

function capText(raw: string): ExtractResult {
  const text = raw.trim();
  return text.length > MAX_CHARS
    ? { text: text.slice(0, MAX_CHARS), truncated: true }
    : { text, truncated: false };
}

// Shared OCR helper — accepts canvases (from scanned PDF pages) or File/Blob
// (for direct image uploads). One Tesseract worker is created per call and
// terminated when done so memory is freed after each extraction.
async function runOcr(
  inputs: Array<HTMLCanvasElement | File | Blob>,
  onProgress?: (msg: string, pct: number) => void,
): Promise<ExtractResult> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  let text = '';
  try {
    for (let i = 0; i < inputs.length; i++) {
      const label = inputs.length > 1 ? `page ${i + 1} / ${inputs.length}` : 'image';
      onProgress?.(`OCR ${label}…`, i / inputs.length);
      const { data } = await worker.recognize(inputs[i]);
      text += data.text + '\n';
      if (text.length > MAX_CHARS) break;
    }
  } finally {
    await worker.terminate();
  }
  return capText(text);
}

async function ocrPdf(
  pdf: PDFDocumentProxy,
  onProgress?: (msg: string, pct: number) => void,
): Promise<ExtractResult> {
  const pageCount = Math.min(pdf.numPages, MAX_OCR_PAGES);
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    canvases.push(canvas);
  }
  const result = await runOcr(canvases, onProgress);
  return { text: result.text, truncated: result.truncated || pdf.numPages > MAX_OCR_PAGES };
}

async function extractPdf(
  file: File,
  onProgress?: (msg: string, pct: number) => void,
): Promise<ExtractResult> {
  // pdfjs-dist/webpack.mjs is the bundler entry: sets up the module worker
  // automatically via new Worker(new URL(...), { type:'module' }).
  // pdfjs-dist is pinned to 5.4.624: from 5.5 getTextContent() iterates a
  // ReadableStream with for-await, which NO released Safari supports — every
  // PDF upload from Safari throws "undefined is not a function (near 't of e')".
  const pdfjs = await import('pdfjs-dist/webpack.mjs');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);

  let text = '';
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ') + '\n';
    if (text.length > MAX_CHARS) break;
  }

  const capped = capText(text);
  if (capped.text.length >= 200) {
    return { text: capped.text, truncated: capped.truncated || pdf.numPages > MAX_PAGES };
  }

  // No usable text layer — scanned or image-based PDF. Fall back to Tesseract.
  onProgress?.('Detected scanned PDF, starting OCR…', 0);
  return ocrPdf(pdf, onProgress);
}

export async function extractText(
  file: File,
  onProgress?: (msg: string, pct: number) => void,
): Promise<ExtractResult> {
  if (isPdf(file)) return extractPdf(file, onProgress);
  if (isText(file)) return capText(await file.text());
  if (isImage(file)) {
    onProgress?.('OCR image…', 0);
    return runOcr([file], onProgress);
  }
  throw new Error('Unsupported file — upload a PDF, image, or text file');
}
