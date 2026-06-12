import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { deeperNode, SID } from '../fixtures/data';

test.describe('Tweaks panel', () => {
  test('REGRESSION (44515f2): a model change applies to the very next branch (no stale closure)', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, deeperNode({ model: 'opus' }));
    await gotoWorkspace(page, api);

    await page.locator('.twk-trigger').click();
    // The model dropdown is the select that offers the Claude Opus option
    await page.locator('select.twk-field:has(option[value="opus"])').selectOption('opus');
    await page.locator('.twk-x').click();

    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');

    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    // Pre-fix the callback closed over the old tweaks and still sent 'haiku'
    expect((call.body as { model: string }).model).toBe('opus');
    // Status chip reflects the change too
    await expect(page.locator('.twk-status-pill', { hasText: 'Claude Opus' })).toBeVisible();
  });

  test('selecting a DeepSeek model disables web search and sends webSearch: false', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, deeperNode({ model: 'deepseek-pro' }));
    await gotoWorkspace(page, api);

    await page.locator('.twk-trigger').click();
    await page.locator('select.twk-field:has(option[value="deepseek-pro"])').selectOption('deepseek-pro');
    await page.locator('.twk-x').click();

    await expect(page.locator('.twk-status-pill', { hasText: 'Web n/a' })).toBeVisible();

    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect((call.body as { model: string }).model).toBe('deepseek-pro');
  });

  test('theme tweak flips data-theme on <html> and persists across reload', async ({ page }) => {
    const api = baseApi();
    await gotoWorkspace(page, api);

    await page.locator('.twk-trigger').click();
    // Theme is a segmented radio — selection is derived from pointer X on the track
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
