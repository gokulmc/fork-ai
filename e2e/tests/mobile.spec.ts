import { test, expect } from '@playwright/test';
import { fulfillSse, deferred } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, deeperNode, askNode, rootStreamEvents, SID, ROOT_TITLE } from '../fixtures/data';

/**
 * Runs only under the `mobile` project (iPhone 13: 390×664, hasTouch, isMobile).
 * Exercises the narrow-viewport layout: the map lives behind a floating pill,
 * the breadcrumb collapses to the root, Notes is hidden, touch taps select a
 * sentence, and the follow-up popup centres on the visual viewport.
 */

test.describe('Mobile — narrow viewport layout', () => {
  test('mind map is hidden behind the pill; tapping it reveals the map', async ({ page }) => {
    await gotoWorkspace(page, baseApi());

    // The pill only renders on narrow screens once there are nodes
    const pill = page.locator('.mm-pill');
    await expect(pill).toBeVisible();
    // The map pane is slid off-screen by default (translateX(-100%))
    await expect(page.locator('[data-map-open="1"]')).toHaveCount(0);

    await pill.tap();
    await expect(page.locator('.app[data-map-open="1"]')).toBeVisible();
    await expect(page.locator('.mm-node.root')).toBeVisible();
  });

  test('breadcrumb collapses to the root title and Notes button is hidden', async ({ page }) => {
    const session = fullSession({ nodes: [fullSession().nodes[0], deeperNode()], nodeCount: 2 });
    await gotoWorkspace(page, baseApi(), { session, nodeId: deeperNode().nodeId as string });

    // Only the root crumb shows on phones (desktop shows the full trail)
    await expect(page.locator('.crumbs .crumb')).toHaveCount(1);
    await expect(page.locator('.crumbs .crumb')).toHaveText(ROOT_TITLE);
    // Notes is desktop-only
    await expect(page.locator('.topbar .tools button', { hasText: 'Notes' })).toHaveCount(0);
  });

  test('a single tap selects the sentence under the finger and pops the highlight menu', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    const body = page.locator('.section-body[data-section-id="s1"]');
    await body.waitFor();

    await body.tap();
    await expect(page.locator('.hl-menu--visible')).toBeVisible();
    const sel = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
    expect(sel.length).toBeGreaterThanOrEqual(3);
  });

  test('Ask AI on mobile centres the follow-up popup and branches', async ({ page }) => {
    const gate = deferred();
    const api = baseApi()
      .on(`POST /sessions/${SID}/nodes`, async () => { await gate.promise; return askNode(); })
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-m-1' });
    await gotoWorkspace(page, api);

    const body = page.locator('.section-body[data-section-id="s1"]');
    await body.waitFor();
    await body.tap();
    await page.locator('.hl-menu--visible button', { hasText: 'Ask AI' }).tap();

    const pop = page.locator('.followup-pop');
    await expect(pop).toBeVisible();
    await pop.locator('textarea').fill('What pigments are involved?');
    await pop.locator('button.btn-primary').tap();

    // Optimistic loading node lands on the map immediately
    await expect(page.locator('.mm-node.loading')).toBeVisible();
    gate.resolve();
    await expect(page.locator('.mm-node', { hasText: 'Pigments Beyond Chlorophyll' })).toBeVisible();
  });

  test('trial-mode first query works end-to-end on a phone', async ({ page }) => {
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    const input = page.getByPlaceholder('Try: how does photosynthesis work?');
    await input.fill('how does photosynthesis work?');
    await page.locator('.query-box button.submit').tap();

    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.mm-pill')).toBeVisible();
  });

  test('page-level pinch-zoom is suppressed (gesture events are prevented)', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    // Providers.tsx attaches non-passive gesturestart/-change/-end preventers.
    // We can't synthesise a real trackpad pinch, but we can confirm the document
    // swallows the (non-standard, Safari) gesture event without throwing and
    // that the visual viewport scale stays at 1.
    const defaultPrevented = await page.evaluate(() => {
      const ev = new Event('gesturestart', { cancelable: true, bubbles: true });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scale).toBe(1);
  });
});
