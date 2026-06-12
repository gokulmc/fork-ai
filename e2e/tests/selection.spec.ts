import { test, expect, type Page } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode } from '../fixtures/data';

// A deliberately multi-sentence body so sentence-select ≠ block-select.
const MULTI = 'Chlorophyll absorbs photons in the thylakoid. Water is split to release oxygen. The Calvin cycle then fixes carbon.';
const FIRST_SENTENCE = 'Chlorophyll absorbs photons in the thylakoid.';

function multiSentenceSession() {
  return fullSession({ nodes: [rootNode({ sections: [{ id: 's1', heading: 'Overview', body: MULTI }] })] });
}

/**
 * Desktop text-selection gestures handled in Section.tsx:
 *  - double-click → browser word selection (native; menu appears on mouseup)
 *  - triple-click (detail === 3) → sentence under the caret
 *  - quadruple-click (detail >= 4) → whole block element
 * The HighlightMenu pops via App.tsx's document `mouseup` listener once the
 * selection is non-collapsed and ≥ 3 chars.
 */

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => (window.getSelection()?.toString() ?? '').trim());
}

// Multi-click with a real, monotonically increasing detail count. Playwright's
// click({clickCount}) resets between calls, so we issue n mousedown/up pairs
// targeting the same point and let the browser accumulate `detail`.
async function multiClick(page: Page, selector: string, count: number) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + 12;
  const y = box.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { clickCount: count });
}

test.describe('Desktop text selection', () => {
  test('triple-click selects the sentence under the caret (not the whole paragraph)', async ({ page }) => {
    await gotoWorkspace(page, baseApi(), { session: multiSentenceSession() });
    await page.locator('.section-body[data-section-id="s1"]').waitFor();

    // Click within the first sentence (near the start of the block)
    await multiClick(page, '.section-body[data-section-id="s1"]', 3);
    const sel = await selectedText(page);
    expect(sel).toBe(FIRST_SENTENCE);
    expect(sel.length).toBeLessThan(MULTI.length); // not the entire body
    await expect(page.locator('.hl-menu--visible')).toBeVisible();
  });

  test('quadruple-click selects the entire block', async ({ page }) => {
    await gotoWorkspace(page, baseApi(), { session: multiSentenceSession() });
    await page.locator('.section-body[data-section-id="s1"]').waitFor();

    await multiClick(page, '.section-body[data-section-id="s1"]', 4);
    const sel = await selectedText(page);
    expect(sel).toBe(MULTI);
  });

  test('double-click selects a single word and still pops the menu', async ({ page }) => {
    await gotoWorkspace(page, baseApi(), { session: multiSentenceSession() });
    await page.locator('.section-body[data-section-id="s1"]').waitFor();

    await multiClick(page, '.section-body[data-section-id="s1"]', 2);
    const sel = await selectedText(page);
    expect(sel.split(/\s+/).length).toBe(1);
    expect(sel.length).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.hl-menu--visible')).toBeVisible();
  });

  test('REGRESSION (citation boundary): a [N] citation marker does not fuse two sentences on sentence-select', async ({ page }) => {
    // Web-search prose glues a [1] superscript onto the period with no space:
    // "…reactions.[1] Carbon dioxide…". The boundary regex must still split here.
    const body = 'Chlorophyll splits water in the light reactions.<sup>[1]</sup> Carbon dioxide is then fixed by rubisco in the stroma.';
    const session = fullSession({
      nodes: [rootNode({ sections: [{ id: 's1', heading: 'Coupled stages', body }], sources: [{ title: 'Source', url: 'https://example.com' }] })],
    });
    await gotoWorkspace(page, baseApi(), { session });
    await page.locator('.section-body[data-section-id="s1"]').waitFor();

    // Click within the FIRST sentence
    await multiClick(page, '.section-body[data-section-id="s1"]', 3);
    const sel = await selectedText(page);
    // Pre-fix the [1] swallowed the boundary and the selection ran into sentence 2
    expect(sel).not.toContain('Carbon dioxide');
    expect(sel).not.toContain('[1]');
    expect(sel).toContain('light reactions');
  });
});
