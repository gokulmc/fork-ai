import { test, expect } from '@playwright/test';
import { fulfillSse } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import {
  fullSession, rootNode, deeperNode, rootStreamEvents, sessionSummary,
  SID, SHARE_TOKEN, ROOT_TITLE,
} from '../fixtures/data';
import { MockApi } from '../fixtures/mock-api';

test.describe('Guest mode (?sk= share links)', () => {
  test('guest opens a share link: workspace renders with Login-to-Save, no History/Share', async ({ page }) => {
    const api = new MockApi().on(`GET /share/${SHARE_TOKEN}`, fullSession());
    const auth = await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.topbar .tools button', { hasText: 'Login to Save' })).toBeVisible();
    await expect(page.locator('.topbar .tools button', { hasText: 'History' })).toHaveCount(0);
    await expect(page.locator('.topbar .tools button', { hasText: 'Share' })).toHaveCount(0);

    // The share GET must not carry an Authorization header
    const [call] = api.callsTo('GET /share/:token');
    expect(call.headers['authorization']).toBeUndefined();
    // REGRESSION guard: nothing in guest mode may trigger a sign-out bounce
    expect(auth.signOutCalls.length).toBe(0);
  });

  test('refresh keeps the guest in the shared session (?sk= stays in the URL)', async ({ page }) => {
    const api = new MockApi().on(`GET /share/${SHARE_TOKEN}`, fullSession());
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);

    await page.reload();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    expect(page.url()).toContain(`sk=${SHARE_TOKEN}`);
  });

  test('guest branches through the public /share endpoints, not /sessions', async ({ page }) => {
    const api = new MockApi()
      .on(`GET /share/${SHARE_TOKEN}`, fullSession())
      .on(`POST /share/${SHARE_TOKEN}/nodes`, deeperNode());
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');

    expect(api.callsTo('POST /share/:token/nodes').length).toBe(1);
    expect(api.callsTo('POST /sessions/:id/nodes').length).toBe(0);
  });

  test('invalid share link: friendly countdown screen, stale trial token cleared, no login bounce loop', async ({ page }) => {
    const api = new MockApi().on('GET /share/bad-token', 403);
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false, storage: { 'fork.ai.trial': 'bad-token' } });
    await api.install(page);

    await page.goto('/?sk=bad-token');
    await expect(page.getByText('Link not valid')).toBeVisible();
    await expect(page.getByText(/Redirecting to login/)).toBeVisible();

    // After the countdown the guest token is dropped → new visitor lands on the hero
    await expect(page.locator('.landing h1')).toContainText('Ask once.', { timeout: 10_000 });
    // REGRESSION guard: the stale trial token must be removed or the bounce recurs forever
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.trial'))).toBeNull();
  });

  test('"Login to Save" opens the login page while keeping the guest session claimable', async ({ page }) => {
    const api = new MockApi().on(`GET /share/${SHARE_TOKEN}`, fullSession());
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await page.locator('.topbar .tools button', { hasText: 'Login to Save' }).click();

    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
    // guestToken survives forceLogin — the post-login claim effect depends on it
    expect(page.url()).toContain(`sk=${SHARE_TOKEN}`);
  });

  test('already-authenticated user opening a share link claims it and loads it under their account', async ({ page }) => {
    const api = baseApi()
      .on(`POST /share/${SHARE_TOKEN}/claim`, sessionSummary())
      .on(`GET /sessions/${SID}`, fullSession());
    await mockAuth(page, { authed: true });
    await primeStorage(page);
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);

    // React StrictMode (dev) double-mounts, so the claim can fire twice — the
    // backend makes claiming idempotent for exactly this reason.
    const claims = api.callsTo('POST /share/:token/claim');
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0].headers['authorization']).toMatch(/^Bearer .+/);
    // Loaded via the authed endpoint after the claim
    expect(api.callsTo('GET /sessions/:id').length).toBeGreaterThan(0);
    // Owner UI back: Share button visible
    await expect(page.locator('.topbar .tools button', { hasText: 'Share' })).toBeVisible();
  });
});

test.describe('Trial mode (logged-out first query)', () => {
  test('new visitor can research without an account; trial token persists the session across refresh', async ({ page }) => {
    const api = new MockApi()
      .on('POST /share', route => void fulfillSse(route, rootStreamEvents({ token: SHARE_TOKEN })))
      .on(`GET /share/${SHARE_TOKEN}`, fullSession({ isTrial: true }));
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto('/');
    await page.getByPlaceholder('Try: how does photosynthesis work?').fill('how does photosynthesis work?');
    await page.locator('.query-box button.submit').click();

    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.topbar .tools button', { hasText: 'Login to Save' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.trial'))).toBe(SHARE_TOKEN);

    await page.reload();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
  });

  test('trial session locks at 5 nodes with a signup overlay', async ({ page }) => {
    const nodes = [
      rootNode(),
      ...[1, 2, 3, 4].map(i => deeperNode({ nodeId: `node-extra-${i}`, title: `Branch ${i}` })),
    ];
    const api = new MockApi()
      .on(`GET /share/${SHARE_TOKEN}`, fullSession({ isTrial: true, nodes, nodeCount: 5 }));
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false, storage: { 'fork.ai.trial': SHARE_TOKEN } });
    await api.install(page);

    await page.goto('/');
    await expect(page.getByText('Free session limit reached')).toBeVisible();
    await page.getByRole('button', { name: 'Login / Sign up' }).click();
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
  });
});
