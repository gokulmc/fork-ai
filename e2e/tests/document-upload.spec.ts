import { test, expect } from '@playwright/test';
import path from 'path';
import { fulfillSse } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import { SID } from '../fixtures/data';

/**
 * Document upload → mind-map (frontend contract).
 *
 * The API is mocked (suite rule: never hit the real NestJS/LLM), but the PDF
 * text extraction runs FOR REAL in the browser via pdfjs-dist on a real sample
 * PDF — so this proves the Landing file button, the in-browser extraction +
 * worker, the submitDocument SSE handling (init → skeleton → node-done → done),
 * and the whole-tree render. Backend orchestration is covered by an apps/api spec.
 */

const SAMPLE_PDF = path.resolve(__dirname, '../fixtures/sample.pdf');

const ROOT = '01ROOTDOC', N1 = '01NQUBIT', N2 = '01NENTANGLE', N3 = '01NALGO', N3A = '01NSHOR', N3B = '01NGROVER';
const T0 = '2026-06-01T10:00:00.000Z';

function docNode(id: string, parentId: string | null, kind: string, title: string, emoji: string, lede: string, body: string) {
  return {
    nodeId: id,
    parentId,
    kind,
    title,
    emoji,
    query: title,
    lede,
    sections: [{ id: `${id}-s1`, heading: '', body }],
    fromSection: null,
    fromText: `brief: ${title}`,
    createdAt: T0,
    model: 'claude-haiku-4-5-20251001',
  };
}

// A 6-node tree: root + 3 children, with 2 grandchildren under one child —
// exactly the shape from the feature brief ("3 to the root, 2 to one child").
function docStreamEvents() {
  return [
    { type: 'init', sessionId: SID, nodeId: ROOT },
    {
      type: 'skeleton',
      nodes: [
        { id: ROOT, parentId: null, kind: 'QUERY', title: 'Quantum Computing', emoji: '⚛️' },
        { id: N1, parentId: ROOT, kind: 'DEEPER', title: 'Qubits & Superposition', emoji: '🔁' },
        { id: N2, parentId: ROOT, kind: 'DEEPER', title: 'Entanglement', emoji: '🔗' },
        { id: N3, parentId: ROOT, kind: 'DEEPER', title: 'Quantum Algorithms', emoji: '🧮' },
        { id: N3A, parentId: N3, kind: 'DEEPER', title: "Shor's Algorithm", emoji: '🔓' },
        { id: N3B, parentId: N3, kind: 'DEEPER', title: "Grover's Algorithm", emoji: '🔎' },
      ],
    },
    { type: 'node-done', node: docNode(ROOT, null, 'QUERY', 'Quantum Computing', '⚛️', 'An overview of quantum computing from the document.', '**Quantum computing** exploits superposition, entanglement, and interference to process information beyond classical limits.') },
    { type: 'node-done', node: docNode(N1, ROOT, 'DEEPER', 'Qubits & Superposition', '🔁', 'Qubits hold superposed states.', 'A **qubit** is a two-level quantum system that can occupy a combination of |0⟩ and |1⟩.') },
    { type: 'node-done', node: docNode(N2, ROOT, 'DEEPER', 'Entanglement', '🔗', 'Entanglement correlates qubits.', 'Entanglement links qubits so the whole cannot be described by its parts.') },
    { type: 'node-done', node: docNode(N3, ROOT, 'DEEPER', 'Quantum Algorithms', '🧮', 'Algorithms exploit interference.', 'Quantum algorithms steer amplitudes so the correct answers interfere constructively.') },
    { type: 'node-done', node: docNode(N3A, N3, 'DEEPER', "Shor's Algorithm", '🔓', 'Shor factors integers fast.', "**Shor's algorithm** factors integers in polynomial time, threatening RSA.") },
    { type: 'node-done', node: docNode(N3B, N3, 'DEEPER', "Grover's Algorithm", '🔎', 'Grover searches in root-N.', "**Grover's algorithm** gives a quadratic speedup for unstructured search.") },
    { type: 'done', sessionId: SID, nodeCount: 6, title: 'Quantum Computing', emoji: '⚛️', lede: 'An overview of quantum computing from the document.' },
  ];
}

test.describe('Document upload → mind-map', () => {
  test('uploads a PDF, extracts its text in-browser, and builds the whole tree', async ({ page }) => {
    const api = baseApi()
      .on('POST /sessions/document/stream', route => void fulfillSse(route, docStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');

    // The file symbol sits in the Landing query box.
    await expect(page.locator('.query-box .qb-file')).toBeVisible();

    // Upload the real sample PDF — pdfjs extracts its text in the browser.
    await page.locator('.query-box input[type="file"]').setInputFiles(SAMPLE_PDF);

    // The whole tree renders: root overview + all 6 nodes. The first render after
    // upload also runs real pdfjs extraction and (in dev) compiles the code-split
    // Section/MindMap chunks, so the first assertion is allowed a generous window.
    await expect(page.locator('.ws-title')).toHaveText('Quantum Computing', { timeout: 120_000 });
    await expect(page.locator('.section-body[data-section-id="01ROOTDOC-s1"]')).toContainText('Quantum computing', { timeout: 30_000 });
    await expect(page.locator('.mm-node')).toHaveCount(6, { timeout: 30_000 });
    await expect(page.locator('.mm-node.root')).toBeVisible();

    // The POST carried the REAL text extracted from the PDF (proves pdfjs ran in-browser).
    const [call] = api.callsTo('POST /sessions/document/stream');
    expect(call).toBeTruthy();
    expect(call.headers['authorization']).toMatch(/^Bearer .+/);
    const body = call.body as { documentText: string; fileName: string };
    expect(body.fileName).toMatch(/\.pdf$/i);
    expect(body.documentText.length).toBeGreaterThan(1000);
    expect(body.documentText).toMatch(/quantum|qubit|entanglement/i);
  });
});
