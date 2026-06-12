import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace, selectSectionText } from '../fixtures/app';
import { fullSession, SID, ROOT_ID } from '../fixtures/data';

test.describe('Highlights, callouts & notes', () => {
  test('selecting text shows the highlight menu; highlighting persists with character offsets', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-real-1' });
    await gotoWorkspace(page, api);

    const selected = await selectSectionText(page, 's1', 0, 32);
    await page.locator('.hl-menu--visible .hl-main-btn').click();

    const [call] = api.callsTo(`POST /sessions/${SID}/highlights`);
    expect(call.body).toMatchObject({
      nodeId: ROOT_ID,
      sectionId: 's1',
      text: selected,
      start: 0,
      end: 32,
      bg: '#fef08a', // default yellow
    });

    // Notes badge counts the new highlight
    await expect(page.locator('.topbar .tools .has-badge .badge')).toHaveText('1');
    // The CSS Custom Highlight registry now carries the colour group
    expect(await page.evaluate(() => CSS.highlights.has('fork-hl-fef08a'))).toBe(true);
  });

  const persistedSession = () => fullSession({
    highlights: [{
      hlId: 'hl-persisted', nodeId: ROOT_ID, sectionId: 's1',
      text: 'Chlorophyll absorbs photons', start: 0, end: 27, bg: '#bbf7d0', fg: null,
    }],
    highlightCount: 1,
  });

  test('highlights stored on the server re-apply from their character offsets', async ({ page }) => {
    await gotoWorkspace(page, baseApi(), { session: persistedSession() });
    await expect(page.locator('.topbar .tools .has-badge .badge')).toHaveText('1');
    await expect
      .poll(() => page.evaluate(() => CSS.highlights.has('fork-hl-bbf7d0')))
      .toBe(true);
  });

  test('persisted highlights paint on cold load without any interaction', async ({ page }) => {
    // The code-split <Section> chunk mounts after the highlight layout effect
    // first runs; the `sectionReady` dependency (App.tsx) re-runs the effect
    // once the chunk is loaded so saved highlights paint with no interaction.
    await gotoWorkspace(page, baseApi(), { session: persistedSession() });
    await expect
      .poll(() => page.evaluate(() => CSS.highlights.has('fork-hl-bbf7d0')))
      .toBe(true);
  });

  test('picking a non-default highlight colour persists that bg+fg combination', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-green-1' });
    await gotoWorkspace(page, api);

    await selectSectionText(page, 's1', 0, 32);
    // Open the colour picker and choose green background
    await page.locator('.hl-menu--visible .hl-expand-btn').click();
    await page.locator('.hl-color-pop .hl-swatch[title="Highlight · #bbf7d0"]').click();

    const [call] = api.callsTo(`POST /sessions/${SID}/highlights`);
    expect(call.body).toMatchObject({ bg: '#bbf7d0' });
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('fork-hl-bbf7d0'))).toBe(true);
  });

  test('the last-used colour becomes the default for the next one-click highlight', async ({ page }) => {
    let n = 0;
    const api = baseApi().on(`POST /sessions/${SID}/highlights`, () => ({ hlId: `hl-${n++}` }));
    await gotoWorkspace(page, api);

    // First: explicitly pick blue
    await selectSectionText(page, 's1', 0, 20);
    await page.locator('.hl-menu--visible .hl-expand-btn').click();
    await page.locator('.hl-color-pop .hl-swatch[title="Highlight · #bae6fd"]').click();

    // Second: plain one-click highlight should reuse blue
    await selectSectionText(page, 's2', 0, 20);
    await page.locator('.hl-menu--visible .hl-main-btn').click();

    const calls = api.callsTo(`POST /sessions/${SID}/highlights`);
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { bg: string }).bg).toBe('#bae6fd');
  });

  test('a foreground (text) colour persists as a distinct named highlight', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-fg-1' });
    await gotoWorkspace(page, api);

    await selectSectionText(page, 's1', 0, 24);
    await page.locator('.hl-menu--visible .hl-expand-btn').click();
    // Red text swatch (second colour row, title "Text · Red")
    await page.locator('.hl-color-pop .hl-fg-swatch[title="Text · Red"]').click();

    const [call] = api.callsTo(`POST /sessions/${SID}/highlights`);
    expect(call.body).toMatchObject({ fg: '#b91c1c' });
    // bg+fg form their own named-highlight group
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('fork-hl-fef08a-b91c1c'))).toBe(true);
  });

  test('pinning a callout posts an annotation and renders it inline in the section', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/annotations`, {
      annId: 'ann-real-1', kind: 'callout',
      text: 'Chlorophyll absorbs photons', fromTitle: 'Photosynthesis Basics',
      nodeId: ROOT_ID, sectionId: 's1', createdAt: new Date('2026-06-01T11:00:00Z').toISOString(),
    });
    await gotoWorkspace(page, api);

    await selectSectionText(page, 's1', 0, 27);
    await page.locator('.hl-menu--visible button', { hasText: 'Callout' }).click();

    const [call] = api.callsTo(`POST /sessions/${SID}/annotations`);
    expect(call.body).toMatchObject({ kind: 'callout', nodeId: ROOT_ID, sectionId: 's1' });
    await expect(page.locator('.topbar .tools .has-badge .badge')).toHaveText('1');
  });

  test('the notes drawer lists saved highlights and removing one calls DELETE', async ({ page }) => {
    const api = baseApi()
      .on(`POST /sessions/${SID}/highlights`, { hlId: 'hl-real-9' })
      .on(`DELETE /sessions/${SID}/highlights/hl-real-9`,
        route => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
    await gotoWorkspace(page, api);

    const selected = await selectSectionText(page, 's1', 12, 40);
    await page.locator('.hl-menu--visible .hl-main-btn').click();
    await expect(page.locator('.topbar .tools .has-badge .badge')).toHaveText('1');

    await page.locator('.topbar .tools button', { hasText: 'Notes' }).click();
    const card = page.locator('.drawer .note-card.highlight', { hasText: selected });
    await expect(card).toBeVisible();

    await card.locator('button.del').click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => api.callsTo(`DELETE /sessions/${SID}/highlights/hl-real-9`).length).toBe(1);
  });
});
