import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { SID, SHARE_TOKEN } from '../fixtures/data';

test.describe('Share button lifecycle (host side)', () => {
  test('generate → copied → shared, link in clipboard; revoke → back to Share', async ({ page }) => {
    const api = baseApi()
      .on(`GET /sessions/${SID}/share`, { active: false })
      .on(`POST /sessions/${SID}/share`, { token: SHARE_TOKEN })
      .on(`DELETE /sessions/${SID}/share`, route => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
    await gotoWorkspace(page, api);

    const tools = page.locator('.topbar .tools');
    await tools.locator('button', { hasText: 'Share' }).first().click();

    await expect(tools.locator('button', { hasText: 'Copied!' })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`/?sk=${SHARE_TOKEN}`);

    // Settles to the active state with a revoke control
    const sharedBtn = tools.locator('button', { hasText: 'Shared' });
    await expect(sharedBtn).toBeVisible();

    await tools.locator('button[title="Stop sharing"]').click();
    await expect(tools.locator('button', { hasText: 'Shared' })).toHaveCount(0);
    await expect(tools.locator('button[title="Share this session"]')).toBeVisible();
    expect(api.callsTo('DELETE /sessions/:id/share').length).toBe(1);
  });

  test('a session that is already shared mounts in the Shared state', async ({ page }) => {
    const api = baseApi()
      .on(`GET /sessions/${SID}/share`, { active: true, token: SHARE_TOKEN });
    await gotoWorkspace(page, api);

    await expect(page.locator('.topbar .tools button', { hasText: 'Shared' })).toBeVisible();
  });

  test('clicking Shared re-copies the existing link without minting a new token', async ({ page }) => {
    const api = baseApi()
      .on(`GET /sessions/${SID}/share`, { active: true, token: SHARE_TOKEN });
    await gotoWorkspace(page, api);

    await page.locator('.topbar .tools button', { hasText: 'Shared' }).click();
    await expect(page.locator('.topbar .tools button', { hasText: 'Copied!' })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`/?sk=${SHARE_TOKEN}`);
    expect(api.callsTo('POST /sessions/:id/share').length).toBe(0);
  });
});
