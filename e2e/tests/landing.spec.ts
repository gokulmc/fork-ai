import { test, expect } from '@playwright/test';
import { MockApi } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';

test.describe('Landing & login gate', () => {
  test('new visitor (logged out) lands on the hero, not the login page', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await new MockApi().install(page);

    await page.goto('/');
    await expect(page.locator('.landing h1')).toContainText('Ask once.');
    // No login form for a first-time visitor
    await expect(page.getByPlaceholder('enter email to login or signup')).toHaveCount(0);
  });

  test('returning visitor (logged out) sees the login page instead of Landing', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: true });
    await new MockApi().install(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
  });

  test('logged-in user gets Landing with query box; Begin stays disabled until typing', async ({ page }) => {
    await mockAuth(page);
    await primeStorage(page);
    await baseApi().install(page);

    await page.goto('/');
    const input = page.getByPlaceholder('Try: how does photosynthesis work?');
    await expect(input).toBeVisible();

    const begin = page.locator('.query-box button.submit');
    await expect(begin).toBeDisabled();
    await input.fill('why is the sky blue');
    await expect(begin).toBeEnabled();
  });

  test('each suggested topic chip fills the query box and enables Begin', async ({ page }) => {
    await mockAuth(page);
    await primeStorage(page);
    await baseApi().install(page);

    await page.goto('/');
    const chips = page.locator('.examples .chip');
    await expect(chips.first()).toBeVisible();
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(4); // FALLBACK_TOPICS has 4 entries

    const input = page.getByPlaceholder('Try: how does photosynthesis work?');
    const begin = page.locator('.query-box button.submit');
    for (let i = 0; i < count; i++) {
      const chip = chips.nth(i);
      const text = (await chip.getAttribute('title')) ?? '';
      await chip.click();
      await expect(input).toHaveValue(text);
      await expect(begin).toBeEnabled();
    }
  });

  test('Landing "Login" button forces the login page for a logged-out new visitor', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await new MockApi().install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'Login' }).click();
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
  });
});
