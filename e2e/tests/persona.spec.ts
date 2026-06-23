import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { userProfile } from '../fixtures/data';

/**
 * Persona — a per-user free-text instruction the backend prepends to every LLM
 * prompt. This suite mocks the API, so it proves the *frontend contract*: the
 * editor prefills correctly and "Save to Persona" PATCHes /users/me with the
 * text. The actual prompt injection is covered by apps/api unit tests.
 */
test.describe('Persona', () => {
  // The account gear lives at bottom-left (bottom:24, left:24) — exactly under
  // the Next.js dev-tools indicator (<nextjs-portal>), which intercepts the
  // click in `next dev`. Hide it so the gear is reachable.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const apply = () => {
        const s = document.createElement('style');
        s.textContent = 'nextjs-portal{display:none!important}';
        document.head?.appendChild(s);
      };
      if (document.head) apply();
      else document.addEventListener('DOMContentLoaded', apply);
    });
  });

  async function openPersonaModal(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Persona', exact: true }).click();
  }

  test('first-time editor shows the default starter text and Save PATCHes /users/me', async ({ page }) => {
    // No persona on the profile yet → the feature is inert and the editor offers the starter text.
    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('PATCH /users/me', {});
    await gotoWorkspace(page, api);

    await openPersonaModal(page);

    const editor = page.locator('textarea');
    await expect(editor).toHaveValue(/Respond with warmth/);

    const mine = 'I am a quantum physicist. Lead with intuition, then the math.';
    await editor.fill(mine);
    await page.getByRole('button', { name: 'Save to Persona' }).click();

    await expect(page.getByText('Persona saved.')).toBeVisible();

    const calls = api.callsTo('PATCH /users/me');
    expect(calls).toHaveLength(1);
    expect((calls[0].body as { persona: string }).persona).toBe(mine);
  });

  test('a saved persona prefills the editor instead of the default', async ({ page }) => {
    const saved = 'I am a marine biologist who loves vivid analogies.';
    const api = baseApi().on('GET /users/me', userProfile({ persona: saved }));
    await gotoWorkspace(page, api);

    await openPersonaModal(page);

    await expect(page.locator('textarea')).toHaveValue(saved);
  });

  test('an empty persona is rejected and never hits the API', async ({ page }) => {
    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('PATCH /users/me', {});
    await gotoWorkspace(page, api);

    await openPersonaModal(page);

    const editor = page.locator('textarea');
    await expect(editor).toHaveValue(/Respond with warmth/);
    await editor.fill('   ');
    await page.getByRole('button', { name: 'Save to Persona' }).click();

    await expect(page.getByText('Persona cannot be empty')).toBeVisible();
    expect(api.callsTo('PATCH /users/me')).toHaveLength(0);
  });
});
