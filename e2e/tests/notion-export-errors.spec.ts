import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode, ROOT_ID } from '../fixtures/data';

// Regression coverage for the "Failed to save — try again" report where nothing
// was logged in the console and no /notion/push ever reached the server. Cause:
// doNotionPush ran buildNotionClipboard (client-side, can throw) in the same try
// as the network push, and the catch set a message WITHOUT console.error — so a
// build throw was swallowed silently and never sent a request. The fix splits the
// two stages, logs both, and gives the build failure its own message.

const NOTION_PAGES = [{ id: 'page-1', title: 'My Workspace', url: 'https://notion.so/parent' }];

async function openPickerAndSave(page: import('@playwright/test').Page) {
  await page.locator('.mm-copy-btn', { hasText: 'Save to Notion' }).click();
  await page.locator('.notion-picker').waitFor({ state: 'visible' });
  await page.locator('.notion-picker-list button', { hasText: 'My Workspace' }).click();
}

test.describe('Notion export — error handling', () => {
  test('push failure: shows "Failed to save" AND logs the error (previously silent)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    const api = baseApi()
      .on('GET /notion/status', { connected: true })
      .on('GET /notion/pages', NOTION_PAGES)
      .on('POST /notion/push', 502); // server rejects the push

    await gotoWorkspace(page, api, { session: fullSession() });
    await openPickerAndSave(page);

    // The user sees the generic retry message...
    await expect(page.locator('.mm-copy-btn')).toContainText('Failed to save');
    // ...the request WAS attempted (this path does hit the network)...
    expect(api.callsTo('POST /notion/push').length).toBe(1);
    // ...and the fix logs the real error instead of swallowing it.
    expect(errors.some(e => e.includes('[notion] push failed'))).toBeTruthy();
  });

  test('REGRESSION: a node with a missing section body exports instead of crashing', async ({ page }) => {
    // The prod crash: a client-only incomplete node (streamed/mixed, finished so
    // not `loading`) had a section with no `body`. stripCiteRefs did body.replace()
    // → "Cannot read properties of undefined (reading 'replace')", thrown before the
    // fetch, so no /notion/push ever left the browser. A section object with no
    // `body` key reproduces it (the frontend sees section.body === undefined).
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    const child = rootNode({
      nodeId: 'node-child-nobody-000000000001',
      parentId: ROOT_ID,
      kind: 'DEEPER',
      title: 'Incomplete branch',
      fromSection: 's1',
      sections: [{ id: 'c1', heading: 'No body here' }], // body intentionally absent
    });

    const api = baseApi()
      .on('GET /notion/status', { connected: true })
      .on('GET /notion/pages', NOTION_PAGES)
      .on('POST /notion/push', { url: 'https://www.notion.so/created-page' });

    await gotoWorkspace(page, api, { session: fullSession({ nodes: [rootNode(), child] }) });
    await openPickerAndSave(page);

    // The export now succeeds: the request fires and the button flips to success.
    await expect(page.locator('.mm-copy-btn')).toContainText('Open in Notion');
    expect(api.callsTo('POST /notion/push').length).toBe(1);
    // No stripCiteRefs 'replace' crash was logged.
    expect(errors.some(e => e.includes("reading 'replace'"))).toBeFalsy();
  });

  test('build failure: distinct message, logged, and NO push request is sent', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    // A markdown table this large makes buildNotionClipboard throw (RangeError from
    // the Math.max(...) spread over row count) — the same class of client-side crash
    // behind the prod report. It lives in a NON-active child node so the workspace
    // reading pane never renders it (cheap), but the exporter still traverses it.
    const hugeTable =
      '| c1 | c2 |\n|---|---|\n' + Array.from({ length: 150_000 }, () => '| a | b |').join('\n');
    const child = rootNode({
      nodeId: 'node-child-huge-0000000000001',
      parentId: ROOT_ID,
      kind: 'DEEPER',
      title: 'Deep branch',
      fromSection: 's1',
      sections: [{ id: 'c1', heading: 'Big table', body: hugeTable }],
    });

    const api = baseApi()
      .on('GET /notion/status', { connected: true })
      .on('GET /notion/pages', NOTION_PAGES)
      .on('POST /notion/push', { url: 'https://www.notion.so/should-never-be-reached' });

    await gotoWorkspace(page, api, { session: fullSession({ nodes: [rootNode(), child] }) });
    await openPickerAndSave(page);

    // Distinct, honest message for a client-side build failure...
    await expect(page.locator('.mm-copy-btn')).toContainText("Couldn't build the Notion page");
    // ...the throw happened BEFORE the fetch, so no request reached the server
    // (exactly the prod symptom: no /notion/push in the logs)...
    expect(api.callsTo('POST /notion/push').length).toBe(0);
    // ...and it is logged rather than silently swallowed.
    expect(errors.some(e => e.includes('[notion] failed to build'))).toBeTruthy();
  });
});
