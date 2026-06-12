import { test, expect } from '@playwright/test';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode, deeperNode, SID, CHILD_ID, ROOT_TITLE } from '../fixtures/data';

test.describe('Session restore & self-healing', () => {
  test('restores the last session from localStorage on launch', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.mm-node.root')).toBeVisible();
  });

  test('restores the last active node, not just the root', async ({ page }) => {
    const session = fullSession({ nodes: [rootNode(), deeperNode()], nodeCount: 2 });
    await gotoWorkspace(page, baseApi(), { session, nodeId: CHILD_ID });
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
  });

  // Known gap: a #sessionId URL opened in a browser with no localStorage never
  // restores — the `view` effect rewrites the URL to the bare pathname on the
  // first commit (before auth settles), so the auth-gated restore effect reads
  // an empty hash and falls back to (missing) localStorage. The hash written
  // by the persist effect is therefore only decorative today.
  test.fixme('cold-start restore from a #sessionId URL alone (no localStorage)', async ({ page }) => {
    const api = baseApi().on(`GET /sessions/${SID}`, fullSession());
    await mockAuth(page);
    await primeStorage(page); // note: no fork.ai.session
    await api.install(page);
    await page.goto(`/#${SID}`);
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
  });

  test('REGRESSION (defeb77): a stale stored session id self-heals to Landing instead of wedging the loader', async ({ page }) => {
    const api = baseApi().on('GET /sessions/ghost-session', 404);
    await mockAuth(page);
    await primeStorage(page, { storage: { 'fork.ai.session': 'ghost-session', 'fork.ai.node': 'ghost-node' } });
    await api.install(page);

    await page.goto('/');
    // Pre-fix this hung on the Thinking… screen until the user cleared site data
    await expect(page.getByPlaceholder('Try: how does photosynthesis work?')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.session'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.node'))).toBeNull();
  });

  test('logged-out returning visitor with a stored session id does not hang on the loading screen', async ({ page }) => {
    // Safety-net effect: loadingRoot initialises true from the stored key, but
    // no restore path runs once auth settles unauthenticated → must clear it.
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: true, storage: { 'fork.ai.session': SID } });
    await baseApi().install(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible({ timeout: 15_000 });
  });

  test('active node id round-trips through localStorage on reload', async ({ page }) => {
    const session = fullSession({ nodes: [rootNode(), deeperNode()], nodeCount: 2 });
    await gotoWorkspace(page, baseApi(), { session });

    // Navigate to the child via the map → persist effect records hash + storage
    await page.locator('.mm-node', { hasText: 'Thylakoid Electron Transport' }).click();
    await expect(page).toHaveURL(new RegExp(`#${SID}/${CHILD_ID}`));

    await page.reload();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
  });
});
