import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { deeperNode, SID } from '../fixtures/data';

/**
 * Branch-node creation across all three LLM providers. The alias goes out on
 * the request; the (mocked) backend persists the concrete serving model id on
 * the node, which the workspace surfaces as the ✳ header pill.
 */
const PROVIDERS = [
  { provider: 'Claude', alias: 'haiku', servingId: 'claude-haiku-4-5-20251001', pillLabel: 'Claude Haiku' },
  { provider: 'Gemini', alias: 'gemini-flash', servingId: 'gemini-2.5-flash', pillLabel: 'Gemini 2.5 Flash' },
  { provider: 'DeepSeek', alias: 'deepseek-pro', servingId: 'deepseek-v4-pro', pillLabel: 'DeepSeek V4 Pro' },
] as const;

for (const { provider, alias, servingId, pillLabel } of PROVIDERS) {
  test(`Go deeper with ${provider} (${alias}) sends the alias and shows the ✳ ${pillLabel} pill`, async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, deeperNode({ model: servingId }));
    await gotoWorkspace(page, api);

    if (alias !== 'haiku') { // haiku is the default — no tweak needed
      await page.locator('.twk-trigger').click();
      await page.locator(`select.twk-field:has(option[value="${alias}"])`).selectOption(alias);
      await page.locator('.twk-x').click();
    }

    await page.locator('.deeper-btn').first().click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');

    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect((call.body as { model: string }).model).toBe(alias);

    // The node header pill shows the model that actually produced the node
    await expect(page.locator('.ws-meta .pill', { hasText: pillLabel })).toBeVisible();
  });
}
