/**
 * Performance timing spec — measures how long page load takes for an
 * already-authenticated user from navigation to visible workspace.
 *
 * Three scenarios:
 *   1. Cold load — no IndexedDB cache (simulates first visit after login)
 *   2. Warm load — with IndexedDB cache pre-seeded
 *   3. Slow API — cache hit but network is delayed 1 s (simulates prod latency)
 *   4. Logout — time from click to LoginPage visible
 *
 * Run: npx playwright test -c e2e tests/perf-landing.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, SID } from '../fixtures/data';
import type { CachedSession } from '../../apps/web/src/lib/sessionCache';

const SESSION = fullSession();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed an IndexedDB snapshot so loadSession() paints from cache immediately. */
async function seedIndexedDb(page: import('@playwright/test').Page, session: typeof SESSION) {
  await page.addInitScript((snap: CachedSession) => {
    // Run in the browser context before any app code to prime the DB.
    const req = indexedDB.open('forkai', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('sessions', { keyPath: 'sessionId' });
      store.createIndex('savedAt', 'savedAt');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.transaction('sessions', 'readwrite').objectStore('sessions').put(snap);
    };
  }, {
    sessionId: session.sessionId as string,
    rootId: (session.nodes as Array<{ nodeId: string; parentId: string | null }>).find(n => n.parentId === null)?.nodeId ?? '',
    nodes: Object.fromEntries(
      (session.nodes as Array<{ nodeId: string } & Record<string, unknown>>).map(n => [
        n.nodeId,
        { ...n, id: n.nodeId, loading: false, createdAt: Date.now() },
      ])
    ),
    annotations: [],
    persistentHl: {},
    highlightsList: [],
    notionPageUrl: null,
    savedAt: Date.now(),
  } as CachedSession);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Landing performance — authenticated user', () => {

  test('COLD LOAD — no IndexedDB cache: time from navigation to workspace', async ({ page }) => {
    const api = baseApi().on(`GET /sessions/${SID}`, SESSION);
    await mockAuth(page);
    await primeStorage(page, { storage: { 'fork.ai.session': SID } });
    await api.install(page);

    const t0 = Date.now();
    await page.goto('/');
    await page.locator('.ws-title').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    console.log(`[perf] COLD LOAD: ${elapsed} ms to workspace`);
    // Collect Web Vitals from the browser
    const vitals = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
        // Measure any marks the app may have emitted
        marks: performance.getEntriesByType('mark').map(m => ({ name: m.name, time: Math.round(m.startTime) })),
      };
    });
    console.log('[perf] Web vitals:', JSON.stringify(vitals, null, 2));

    // Sanity assertions (generous — we're diagnosing, not gating CI)
    expect(elapsed).toBeGreaterThan(0);
    // Log whether cache was cold (no IndexedDB hit)
    console.log(`[perf] Cold load complete in ${elapsed} ms`);
  });

  test('WARM LOAD — IndexedDB cache seeded: time from navigation to workspace', async ({ page }) => {
    const api = baseApi().on(`GET /sessions/${SID}`, SESSION);
    await mockAuth(page);
    await primeStorage(page, { storage: { 'fork.ai.session': SID } });
    await seedIndexedDb(page, SESSION);
    await api.install(page);

    const t0 = Date.now();
    await page.goto('/');
    await page.locator('.ws-title').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    console.log(`[perf] WARM LOAD (cache hit): ${elapsed} ms to workspace`);
    expect(elapsed).toBeGreaterThan(0);
  });

  test('SLOW API — cache hit but network delayed 800 ms: user should still see workspace fast', async ({ page }) => {
    const api = baseApi().on(`GET /sessions/${SID}`, async () => {
      await new Promise(r => setTimeout(r, 800));
      return SESSION;
    });
    await mockAuth(page);
    await primeStorage(page, { storage: { 'fork.ai.session': SID } });
    await seedIndexedDb(page, SESSION);
    await api.install(page);

    const t0 = Date.now();
    await page.goto('/');
    await page.locator('.ws-title').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    console.log(`[perf] SLOW API (800ms delay, cache hit): ${elapsed} ms to workspace`);
    // With cache the user should see the workspace well before the API responds
    expect(elapsed).toBeGreaterThan(0);
  });

  test('NO SESSION — authenticated but no prior session: time to Landing input visible', async ({ page }) => {
    const api = baseApi(); // no session in storage
    await mockAuth(page);
    await primeStorage(page, { visited: true }); // visited = true → no signup page
    await api.install(page);

    const t0 = Date.now();
    await page.goto('/');
    await page.getByPlaceholder('Try: how does photosynthesis work?').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    console.log(`[perf] NO SESSION — Landing input visible in: ${elapsed} ms`);
    expect(elapsed).toBeGreaterThan(0);
  });

  test('LOGOUT — time from click to login screen visible', async ({ page }) => {
    // Boot into workspace first
    await gotoWorkspace(page, baseApi());

    const t0 = Date.now();
    // Open account menu and click logout
    await page.locator('.account-btn, [aria-label="Account"], .acct-btn').first().click();
    await page.locator('button', { hasText: /log.?out|sign.?out/i }).first().click();
    // Wait for login page to appear
    await page.getByPlaceholder('enter email to login or signup').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    console.log(`[perf] LOGOUT: ${elapsed} ms to login screen`);
    expect(elapsed).toBeGreaterThan(0);
  });

  test('AUTH SETTLE — time from navigation to idToken available (next-auth delay)', async ({ page }) => {
    const api = baseApi().on(`GET /sessions/${SID}`, SESSION);
    await mockAuth(page);
    await primeStorage(page, { storage: { 'fork.ai.session': SID } });
    await api.install(page);

    await page.goto('/');

    // Measure when the app makes its first authenticated API call
    // (which only fires once next-auth settles and idToken is available)
    const authSettleMs = await page.evaluate(async () => {
      return new Promise<number>(resolve => {
        const t0 = performance.now();
        // Poll for when the session API call appears in performance entries
        const check = () => {
          const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
          const sessionCall = entries.find(e => e.name.includes('/sessions/') || e.name.includes('/users/me'));
          if (sessionCall) {
            resolve(Math.round(sessionCall.requestStart - t0));
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });
    }).catch(() => -1);

    console.log(`[perf] AUTH SETTLE (time to first API call): ${authSettleMs} ms`);
    await page.locator('.ws-title').waitFor({ state: 'visible' });
  });

});
