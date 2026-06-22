import { test, expect } from '@playwright/test';
import { deferred } from '../fixtures/mock-api';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode, deeperNode, SID } from '../fixtures/data';

test.describe('Section heading — markdown hashes stripped', () => {
  // LLM section headings sometimes arrive with their markdown ATX hashes intact
  // (e.g. "## Light reactions"), which used to render the literal `##` in the
  // <h2>. cleanHeading() now strips them at every display surface.
  const dirtySession = () =>
    fullSession({
      nodes: [
        rootNode({
          sections: [
            { id: 's1', heading: '## Light reactions', body: 'Body one.' }, // h2 + space
            { id: 's2', heading: '###Calvin cycle', body: 'Body two.' },     // 3 hashes, no space
            { id: 's3', heading: 'Net result ##', body: 'Body three.' },     // ATX closing run
            { id: 's4', heading: 'C# vs F#', body: 'Body four.' },           // must NOT be touched
          ],
        }),
      ],
    });

  test('rendered <h2> shows no markdown hashes', async ({ page }) => {
    await gotoWorkspace(page, baseApi(), { session: dirtySession() });

    const headings = page.locator('.section-head h2');
    await expect(headings.nth(0)).toHaveText('Light reactions');
    await expect(headings.nth(1)).toHaveText('Calvin cycle');
    await expect(headings.nth(2)).toHaveText('Net result');
    // A legitimate internal/trailing `#` survives — only the heading markers go.
    await expect(headings.nth(3)).toHaveText('C# vs F#');
  });

  test('Go deeper derives a clean title and query from a hashed heading', async ({ page }) => {
    const gate = deferred();
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, async () => {
      await gate.promise;
      return deeperNode();
    });
    await gotoWorkspace(page, api, { session: dirtySession() });

    await page.locator('.deeper-btn').first().click();

    // The optimistic loading card on the map carries the cleaned heading as its title.
    await expect(page.locator('.mm-node.loading .mm-label')).toHaveText('Light reactions');

    gate.resolve();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');

    // The expand payload sent to the backend never carries the markdown hashes either.
    const [call] = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect((call.body as { query: string }).query).toBe('Light reactions');
  });
});
