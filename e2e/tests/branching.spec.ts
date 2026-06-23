import { test, expect } from '@playwright/test';
import { deferred } from '../fixtures/mock-api';
import { baseApi, gotoWorkspace, askAiFromSelection, selectSectionText } from '../fixtures/app';
import { fullSession, deeperNode, askNode, SID, ROOT_ID } from '../fixtures/data';

test.describe('Branching — Go deeper & Ask AI', () => {
  test('Go deeper creates a child node and navigates to it', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, deeperNode());
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
    await expect(page.locator('.section-body[data-section-id="d1"]')).toContainText('P680');
    // Breadcrumb walks the parent chain
    await expect(page.locator('.crumbs .crumb').first()).toHaveText('Photosynthesis Basics');
    // Map now shows both nodes
    await expect(page.locator('.mm-node')).toHaveCount(2);

    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect(call.body).toMatchObject({
      kind: 'DEEPER',
      parentNodeId: ROOT_ID,
      fromSection: 's1',
      query: 'Light reactions',
      model: 'haiku', // default branch model
    });
  });

  test('Ask AI from a highlight creates a branch and stays on the current node', async ({ page }) => {
    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, askNode())
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-branch-1' });
    await gotoWorkspace(page, api);

    await askAiFromSelection(page, 's1', 'What pigments are involved?');

    // Deliberately does NOT auto-navigate — panel stays on the root
    await expect(page.locator('.mm-node')).toHaveCount(2);
    await expect(page.locator('.ws-title')).toHaveText('Photosynthesis Basics');

    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect(call.body).toMatchObject({ kind: 'ASK', parentNodeId: ROOT_ID, fromSection: 's1' });
    expect((call.body as { highlightText: string }).highlightText.length).toBeGreaterThan(3);

    // The source passage gets the reserved branch-glow highlight persisted
    expect(api.callsTo(`POST /sessions/${SID}/highlights`).length).toBe(1);
  });

  test('Ask AI follow-up popup plays the slide-left exit on Branch (desktop), matching mobile', async ({ page }) => {
    // Pre-change desktop kept the popup open while the branch loaded; the first fix
    // closed it instantly. Now desktop plays the same popOutLeft slide-left exit as
    // mobile: the --closing class is applied on submit, then it unmounts after the
    // animation. Gate held in-flight so the close is driven by the exit, not the
    // request finishing (the loading node already shows on the map).
    const gate = deferred();
    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, async () => { await gate.promise; return askNode(); })
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-branch-1' });
    await gotoWorkspace(page, api);

    await askAiFromSelection(page, 's1', 'What pigments are involved?');

    // The slide-left animation runs (it did not instantly vanish)…
    await expect(page.locator('.followup-pop.followup-pop--closing')).toBeVisible();
    await expect(page.locator('.mm-node.loading')).toBeVisible();
    // …then unmounts once popOutLeft completes (~500ms).
    await expect(page.locator('.followup-pop')).toHaveCount(0);

    gate.resolve();
    await expect(page.locator('.mm-node', { hasText: 'Pigments Beyond Chlorophyll' })).toBeVisible();
  });

  test('desktop slide-left exit actually moves the popup left and fades it (not an instant vanish)', async ({ page }) => {
    const gate = deferred();
    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, async () => { await gate.promise; return askNode(); })
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-vis-1' });
    await gotoWorkspace(page, api);

    await selectSectionText(page, 's1', 0, 40);
    await page.locator('.hl-menu--visible button', { hasText: 'Ask AI' }).click();
    const pop = page.locator('.followup-pop');
    await pop.waitFor();
    // hlIn takes 180ms — wait for it to finish so opacityBefore = 1.0 (not mid-open).
    await expect(pop).toHaveCSS('opacity', '1');
    await pop.locator('textarea').fill('What pigments are involved?');

    const before = await pop.boundingBox();
    const opacityBefore = Number(await pop.evaluate(el => getComputedStyle(el).opacity));

    // Freeze popOutLeft ~40% in so the read is deterministic (the popup self-unmounts
    // 500ms after submit, so a live mid-animation read would race that timer).
    await page.addStyleTag({ content:
      '.followup-pop--closing{animation-play-state:paused!important;animation-delay:-.2s!important}' });

    await pop.locator('button.btn-primary').click();
    await page.locator('.followup-pop--closing').waitFor();

    const after = await pop.boundingBox();
    const opacityAfter = Number(await pop.evaluate(el => getComputedStyle(el).opacity));

    expect(after!.x).toBeLessThan(before!.x - 50); // slid left
    expect(opacityAfter).toBeLessThan(opacityBefore); // faded
  });

  test('REGRESSION (1c647ae): opening the Ask-AI node while loading must not blank the panel when the answer lands', async ({ page }) => {
    const gate = deferred();
    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, async () => { await gate.promise; return askNode(); })
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-branch-1' });
    await gotoWorkspace(page, api);

    await askAiFromSelection(page, 's1', 'What pigments are involved?');

    // Click the optimistic loading node on the map while the request is in flight
    const loadingNode = page.locator('.mm-node.loading');
    await expect(loadingNode).toBeVisible();
    await loadingNode.click();
    await expect(page.locator('.ws-title')).toHaveText('What pigments are involved?');

    gate.resolve();
    // Pre-fix: activeId stayed on the deleted temp id → `{active && …}` rendered
    // nothing. Post-fix the panel follows the id swap and fills in.
    await expect(page.locator('.ws-title')).toHaveText('Pigments Beyond Chlorophyll');
    await expect(page.locator('.section-body[data-section-id="a1"]')).toContainText('Carotenoids');
  });

  test('REGRESSION (178c411): Ask-AI questions longer than 500 chars are sent in full and succeed', async ({ page }) => {
    const longQuestion = ('Why does the rate of photosynthesis plateau at high light intensity even when ' +
      'carbon dioxide is abundant, and how do photoprotective mechanisms like non-photochemical ' +
      'quenching interact with the xanthophyll cycle under those conditions? ').repeat(3).trim();
    expect(longQuestion.length).toBeGreaterThan(500);

    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, askNode({ title: 'Light Saturation Explained', query: longQuestion }))
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-branch-1' });
    await gotoWorkspace(page, api);

    await askAiFromSelection(page, 's1', longQuestion);

    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    // The frontend must not truncate; the (mocked, fixed) backend accepts it
    expect((call.body as { query: string }).query).toBe(longQuestion);

    await page.locator('.mm-node', { hasText: 'Light Saturation Explained' }).click();
    await expect(page.locator('.ws-error')).toHaveCount(0);
    await expect(page.locator('.section-body[data-section-id="a1"]')).toBeVisible();
  });

  test('402 on a branch shows the out-of-credit error on the node, not a generic crash', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, 402);
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-error')).toContainText('Out of credit');
  });

  test('failed branch keeps the node in an error state with the server message surfaced', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, 500);
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    // The banner shows the backend's JSON `message` verbatim (the numeric mock
    // sends `e2e mock error 500`); retry flows are covered in error-retry.spec.ts.
    await expect(page.locator('.ws-error')).toContainText('e2e mock error 500');
  });

  test('branching invalidates a stale Notion export (Open in Notion → Save to Notion)', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, deeperNode());
    await gotoWorkspace(page, api, {
      session: fullSession({ notionPageUrl: 'https://www.notion.so/e2e-fake-page' }),
    });

    await expect(page.locator('.mm-copy-btn')).toContainText('Open in Notion');
    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
    // Backend clears notionPageUrl inside createNode; the UI mirrors it instantly
    await expect(page.locator('.mm-copy-btn')).toContainText('Save to Notion');
  });
});
