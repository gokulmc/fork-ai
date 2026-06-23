import { test, expect } from '@playwright/test';
import { mockAuth, TEST_EMAIL } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import { userProfile } from '../fixtures/data';
import { MockApi, fulfillJson } from '../fixtures/mock-api';

const b64 = (s: string) => Buffer.from(s).toString('base64url');
// Distinct valid-shaped id tokens per call — the refresher must return a token
// different from the one that 401'd for the retry to fire.
const makeToken = (n: number) =>
  [
    b64(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    b64(JSON.stringify({ sub: 'u-e2e-test', email: TEST_EMAIL, 'cognito:username': 'u-e2e-test', n })),
    'sig',
  ].join('.');

test.describe('Auth gate & token expiry', () => {
  test('a 401 on an authed request signs the user out and shows the login page', async ({ page }) => {
    // listSessions fires as soon as idToken is available → 401 → unauthorizedHandler → signOut
    const api = new MockApi()
      .on('GET /users/me', userProfile())
      .on('GET /sessions', 401);
    const auth = await mockAuth(page, { authed: true });
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible({ timeout: 15_000 });
    expect(auth.signOutCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('REGRESSION (6919a19 fallout): RefreshTokenExpired session error forces sign-out', async ({ page }) => {
    const auth = await mockAuth(page, { authed: true, error: 'RefreshTokenExpired' });
    await primeStorage(page);
    await baseApi().install(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible({ timeout: 15_000 });
    expect(auth.signOutCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('a stale-token 401 refreshes and retries instead of signing out (active mid-use logout fix)', async ({ page }) => {
    // The bug: an active user's API call uses a just-expired id_token (before useSession
    // refetched the refreshed one) → 401 → instant signOut. Fix: on 401, getSession() yields
    // a fresh token and the request is retried; only a still-401 retry signs out.
    let sessionsCalls = 0;
    const api = new MockApi()
      .on('GET /users/me', userProfile())
      .on('GET /sessions', route =>
        ++sessionsCalls === 1 ? fulfillJson(route, { message: 'expired id token' }, 401) : []);

    const auth = await mockAuth(page, { authed: true });
    // Override the session endpoint to hand back a *different* token on each call, simulating
    // the server-side jwt-callback refresh that getSession() triggers.
    let authCalls = 0;
    await page.route('**/api/auth/session', route =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user: { email: TEST_EMAIL, name: 'E2E Tester' },
          idToken: makeToken(++authCalls),
          expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }),
      }));

    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    // Stays on the app (authed Landing), never bounced to login.
    await expect(page.getByPlaceholder('Try: how does photosynthesis work?')).toBeVisible({ timeout: 15_000 });
    // The refresh + retry is async — wait for the second /sessions call to land.
    await expect.poll(() => sessionsCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(auth.signOutCalls.length).toBe(0);
  });

  test('an API 5xx does NOT sign the user out (only 401s with a token do)', async ({ page }) => {
    const api = new MockApi()
      .on('GET /users/me', userProfile())
      .on('GET /sessions', 500);
    const auth = await mockAuth(page, { authed: true });
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('Try: how does photosynthesis work?')).toBeVisible();
    expect(auth.signOutCalls.length).toBe(0);
  });
});
