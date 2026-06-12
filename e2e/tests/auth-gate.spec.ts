import { test, expect } from '@playwright/test';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import { userProfile } from '../fixtures/data';
import { MockApi } from '../fixtures/mock-api';

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
