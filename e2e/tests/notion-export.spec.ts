import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode } from '../fixtures/data';

const NOTION_LIMIT = 2000;

// A large page like "Context engineering for LLMs": one long paragraph (no blank
// lines, so mdToBlocks joins it into a single block) and a long fenced code block
// — both overrun Notion's 2000-char rich_text cap pre-fix.
const LONG_PARA = 'Context engineering is the practice of curating exactly what a model sees in its window. '.repeat(60);
const LONG_CODE = '```js\n' + 'const packed = packContext(tokens, budget); // keep the window lean\n'.repeat(40) + '```';
const BIG_BODY = `${LONG_PARA}\n\n${LONG_CODE}`;

// Collect every rich_text content string anywhere in the push payload (blocks +
// the nested childrenMap, including table cells).
function collectContents(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const v of value) collectContents(v, out); return out; }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const text = obj.text as { content?: unknown } | undefined;
    if (text && typeof text.content === 'string') out.push(text.content);
    for (const v of Object.values(obj)) collectContents(v, out);
  }
  return out;
}

test.describe('Notion export — large pages', () => {
  // REGRESSION: large sessions used to 400 on pages.create/append because a long
  // paragraph or code block produced a single rich_text element over Notion's
  // 2000-char cap, so no URL was ever returned. capLongText now chunks them.
  test('REGRESSION: no rich_text content exceeds Notion’s 2000-char cap', async ({ page }) => {
    const bigSession = fullSession({
      title: 'Context engineering for LLMs',
      nodes: [rootNode({
        title: 'Context engineering for LLMs',
        sections: [{ id: 's1', heading: 'Context engineering', body: BIG_BODY }],
      })],
    });

    const api = baseApi()
      .on('GET /notion/status', { connected: true })
      .on('GET /notion/pages', [{ id: 'page-1', title: 'My Workspace', url: 'https://notion.so/parent' }])
      .on('POST /notion/push', { url: 'https://www.notion.so/created-page' });

    await gotoWorkspace(page, api, { session: bigSession });

    await page.locator('.mm-copy-btn', { hasText: 'Save to Notion' }).click();
    await page.locator('.notion-picker').waitFor({ state: 'visible' });
    await page.locator('.notion-picker-list button', { hasText: 'My Workspace' }).click();

    // The push succeeded → button flips to the permanent success state.
    await expect(page.locator('.mm-copy-btn')).toContainText('Open in Notion');

    const [call] = api.callsTo('POST /notion/push');
    expect(call).toBeTruthy();
    const body = call.body as { blocks: unknown[]; childrenMap: unknown[] };
    const contents = [...collectContents(body.blocks), ...collectContents(body.childrenMap)];

    // The big body actually reached the payload...
    expect(contents.length).toBeGreaterThan(0);
    const total = contents.reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThan(LONG_PARA.length);
    // ...every element is within Notion's hard limit (the fix)...
    for (const c of contents) expect(c.length).toBeLessThanOrEqual(NOTION_LIMIT);
    // ...and it really was chunked (pre-fix this was a single >2000 element).
    expect(Math.max(...contents.map(c => c.length))).toBeGreaterThan(NOTION_LIMIT - 100);
  });
});
