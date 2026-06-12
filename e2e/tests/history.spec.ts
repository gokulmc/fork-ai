import { test, expect } from '@playwright/test';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import { fullSession, sessionSummary, SID, ROOT_TITLE } from '../fixtures/data';

test.describe('History page', () => {
  test('lists sessions and opens one into the workspace', async ({ page }) => {
    const other = sessionSummary({
      sessionId: 'ses-other', title: 'Roman Republic Collapse', emoji: '🏛️',
      lede: 'Why the Republic fell.', updatedAt: '2026-05-20T09:00:00.000Z', createdAt: '2026-05-20T09:00:00.000Z',
    });
    const api = baseApi()
      .on('GET /sessions', [sessionSummary(), other])
      .on(`GET /sessions/${SID}`, fullSession());
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();

    await expect(page.locator('.session-card-title', { hasText: ROOT_TITLE })).toBeVisible();
    await expect(page.locator('.session-card-title', { hasText: 'Roman Republic Collapse' })).toBeVisible();

    await page.locator('.session-card', { hasText: ROOT_TITLE }).click();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
  });

  test('?view=history survives a refresh', async ({ page }) => {
    const api = baseApi().on('GET /sessions', [sessionSummary()]);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();
    await expect(page.locator('.session-card-title', { hasText: ROOT_TITLE })).toBeVisible();
    await expect(page).toHaveURL(/view=history/);

    await page.reload();
    await expect(page.locator('.session-card-title', { hasText: ROOT_TITLE })).toBeVisible();
  });

  test('empty history shows the easter-egg game prompt and mounts the ForkTrace game', async ({ page }) => {
    const api = baseApi().on('GET /sessions', []);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();
    await expect(page.getByText("Nothing here, let's play a game")).toBeVisible();
    // The game itself mounts its SVG/graph container
    await expect(page.locator('.fork-trace-game')).toBeVisible();
    // No session cards when history is empty
    await expect(page.locator('.session-card')).toHaveCount(0);
  });
});
