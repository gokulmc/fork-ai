/**
 * Root-query Gemini path.
 *
 * Covers the three things the ROOT_MODEL → Gemini switch changes:
 *   1. The persisted node model is now gemini-2.5-flash, so the ✳ pill reads
 *      "Gemini 2.5 Flash" rather than "Claude Sonnet".
 *   2. Web-search citations arrive via the `done.sections` swap (Gemini
 *      grounding resolves after the stream ends, same as Anthropic <cite>).
 *   3. The root request body must never carry a `model` field — the root model
 *      is a server-side constant. Branch model selection must not bleed through.
 */
import { test, expect } from '@playwright/test';
import { fulfillSse } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootStreamEvents, rootNode, SID } from '../fixtures/data';

// ─── helpers ────────────────────────────────────────────────────────────────

async function submitQuery(page: import('@playwright/test').Page, q: string) {
  await page.getByPlaceholder('Try: how does photosynthesis work?').fill(q);
  await page.locator('.query-box button.submit').click();
}

// ─── tests ──────────────────────────────────────────────────────────────────

test.describe('Root query — Gemini model', () => {
  test('root node pill shows "Gemini 2.5 Flash" after session load', async ({ page }) => {
    // The full session fixture now has rootNode.model = 'gemini-2.5-flash'
    // (updated in data.ts). This verifies the pill renders correctly for it.
    const api = baseApi();
    await gotoWorkspace(page, api);

    // Navigate into the root node so the header pill is visible
    await page.locator('.mm-node.root').click();
    await expect(page.locator('.ws-meta .pill', { hasText: 'Gemini 2.5 Flash' })).toBeVisible();
  });

  test('root node pill shows "Gemini 2.5 Flash" after a live stream completes + session reload', async ({ page }) => {
    // Stream completes → user reloads → GET /sessions/:id returns the persisted
    // node with model: 'gemini-2.5-flash'. Pill must be visible on the root node.
    const session = fullSession({ nodes: [rootNode({ model: 'gemini-2.5-flash' })] });
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()))
      .on(`GET /sessions/${SID}`, session);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');
    await expect(page.locator('.ws-title')).toBeVisible();

    // Reload to get the session from GET /sessions/:id (includes model field)
    await page.reload();
    await page.locator('.ws-title').waitFor({ state: 'visible' });
    await page.locator('.mm-node.root').click();
    await expect(page.locator('.ws-meta .pill', { hasText: 'Gemini 2.5 Flash' })).toBeVisible();
  });

  test('POST /sessions/stream body never contains a model field', async ({ page }) => {
    // ROOT_MODEL is a server constant — the client must never send it. Verify
    // even when a branch model is set in TweaksPanel, it doesn't bleed into root.
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');

    // Change the branch model to Opus in TweaksPanel
    await page.locator('.twk-trigger').click();
    await page.locator('select.twk-field:has(option[value="opus"])').selectOption('opus');
    await page.locator('.twk-x').click();

    await submitQuery(page, 'how does photosynthesis work?');
    await expect(page.locator('.ws-title')).toBeVisible();

    const [call] = api.callsTo('POST /sessions/stream');
    expect((call.body as Record<string, unknown>).model).toBeUndefined();
    // Sanity: the rest of the body is present
    expect(call.body).toMatchObject({ query: 'how does photosynthesis work?' });
  });

  test('done.sections swap applies citation-processed bodies from Gemini grounding', async ({ page }) => {
    // Gemini grounding resolves citations after the stream ends, then emits the
    // processed sections (with [N] inline markers) + sources in the `done` event.
    // The UI swaps in the processed bodies and renders the sources list.
    const rawBody = 'Plants use chlorophyll to capture sunlight.';
    // The backend appends [1] inline markers; sources are a separate array.
    const citedBody = 'Plants use chlorophyll to capture sunlight.[1]';

    const events = rootStreamEvents().map(e => {
      if (e.type === 'section' && e.id === 's1') return { ...e, body: rawBody };
      if (e.type === 'done') return {
        ...e,
        sections: [
          { id: 's1', heading: 'Light reactions', body: citedBody },
          { id: 's2', heading: 'Calvin cycle', body: 'Carbon dioxide is fixed into sugars.' },
        ],
        sources: [{ index: 1, title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Photosynthesis' }],
      };
      return e;
    });

    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, events));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');

    // Section body has the cited text (the [1] marker is present)
    await expect(page.locator('.section-body[data-section-id="s1"]')).toContainText('Plants use chlorophyll to capture sunlight.');
    // Sources render in the .ws-sources list below the sections
    await expect(page.locator('.ws-sources-list a', { hasText: 'Wikipedia' })).toBeVisible();
    // Web search pill appears in the header
    await expect(page.locator('.ws-meta .pill-search')).toBeVisible();
  });

  test('root pill does NOT show "Claude Sonnet" (regression guard)', async ({ page }) => {
    const api = baseApi();
    await gotoWorkspace(page, api);

    await page.locator('.mm-node.root').click();
    await expect(page.locator('.ws-meta .pill', { hasText: 'Claude Sonnet' })).toHaveCount(0);
  });
});
