import { test, expect } from '@playwright/test';
import { fulfillSse } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi } from '../fixtures/app';
import { fullSession, rootStreamEvents, SID, ROOT_TITLE, S1_BODY } from '../fixtures/data';

async function submitQuery(page: import('@playwright/test').Page, q: string) {
  await page.getByPlaceholder('Try: how does photosynthesis work?').fill(q);
  await page.locator('.query-box button.submit').click();
}

test.describe('Root query (streaming)', () => {
  test('happy path: query streams into the workspace; session id lands in URL hash + localStorage', async ({ page }) => {
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');

    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.section-body[data-section-id="s1"]')).toContainText('Chlorophyll absorbs photons');
    await expect(page.locator('.mm-node.root')).toBeVisible();

    // Persist effect: hash + localStorage point at the real session
    await expect(page).toHaveURL(new RegExp(`#${SID}$`));
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.session'))).toBe(SID);

    // The request carried the auth token and the tweak defaults
    const [call] = api.callsTo('POST /sessions/stream');
    expect(call.headers['authorization']).toMatch(/^Bearer .+/);
    expect(call.body).toMatchObject({ query: 'how does photosynthesis work?', webSearch: true, sectionCount: 6 });
  });

  test('REGRESSION (e3b2c91): refresh mid-stream restores the session instead of dropping to Landing', async ({ page }) => {
    // Stream delivers init + meta + one section but never `done` — the
    // pre-fix behaviour only learned the session id at `done`, so a refresh
    // at this point lost everything.
    const events = rootStreamEvents().filter(e => e.type !== 'done' && !(e.type === 'section' && e.id === 's2'));
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, events))
      .on(`GET /sessions/${SID}`, fullSession());
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');
    await expect(page.locator('.section-body[data-section-id="s1"]')).toBeVisible();

    // The init event must have persisted the pointers BEFORE done
    await expect(page).toHaveURL(new RegExp(`#${SID}`));
    expect(await page.evaluate(() => localStorage.getItem('fork.ai.session'))).toBe(SID);

    await page.reload();
    // Restored from the API — full content, not Landing
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.section-body[data-section-id="s2"]')).toBeVisible();
    await expect(page.locator('.landing')).toHaveCount(0);
  });

  test('new session appears in History after the stream completes', async ({ page }) => {
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);

    await page.locator('.topbar .tools button', { hasText: 'History' }).click();
    await expect(page.locator('.session-card .session-card-title', { hasText: ROOT_TITLE })).toBeVisible();
  });

  test('402 out-of-credit shows the recharge notice on Landing (not a crash)', async ({ page }) => {
    const api = baseApi().on('POST /sessions/stream', 402);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'an expensive question');

    await expect(page.locator('.landing')).toContainText('Out of credit');
    // Workspace was rolled back
    await expect(page.locator('.ws-title')).toHaveCount(0);
  });

  test('a very long root query (> 500 chars) is sent in full, not truncated', async ({ page }) => {
    const longQuery = ('Explain in depth how the light-dependent and light-independent reactions of ' +
      'photosynthesis are coupled, including the role of the proton gradient, ATP synthase, ' +
      'rubisco, and photorespiration under varying CO2 and light conditions. ').repeat(3).trim();
    expect(longQuery.length).toBeGreaterThan(500);

    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, rootStreamEvents()));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, longQuery);
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);

    const [call] = api.callsTo('POST /sessions/stream');
    expect((call.body as { query: string }).query).toBe(longQuery);
  });

  test('sections render markdown (bold) and the lede strips citation markup', async ({ page }) => {
    const events = rootStreamEvents().map(e => {
      if (e.type === 'meta') return { ...e, lede: 'Plants convert light<sup>[1]</sup> into energy.' };
      if (e.type === 'section' && e.id === 's1') return { ...e, body: `**Bold lead-in.** ${S1_BODY}` };
      if (e.type === 'done') return { ...e, sections: undefined };
      return e;
    });
    const api = baseApi()
      .on('POST /sessions/stream', route => void fulfillSse(route, events));
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');

    await expect(page.locator('.section-body[data-section-id="s1"] strong').first()).toHaveText('Bold lead-in.');
    const lede = page.locator('.ws-lede');
    await expect(lede).toContainText('Plants convert light');
    await expect(lede).not.toContainText('[1]');
  });
});
