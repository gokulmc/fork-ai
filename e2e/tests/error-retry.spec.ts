import { test, expect } from '@playwright/test';
import { MockApi, fulfillJson, fulfillSse } from '../fixtures/mock-api';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, deeperNode, rootStreamEvents, SID, SHARE_TOKEN, ROOT_TITLE } from '../fixtures/data';

async function submitQuery(page: import('@playwright/test').Page, q: string) {
  await page.getByPlaceholder('Try: how does photosynthesis work?').fill(q);
  await page.locator('.query-box button.submit').click();
}

test.describe('Error surfacing & retry', () => {
  test('failed branch shows the backend reason and Retry re-fires into the same node', async ({ page }) => {
    // First branch attempt fails with a realistic NestJS error body; the retry succeeds.
    let attempts = 0;
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, route => {
      attempts++;
      if (attempts === 1) {
        return fulfillJson(route, { message: 'The AI model is overloaded right now', statusCode: 500 }, 500);
      }
      return fulfillJson(route, deeperNode());
    });
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    const banner = page.locator('.ws-error');
    // The actual backend reason — not a generic string, and no doubled "Try again.. Try again."
    await expect(banner).toContainText('The AI model is overloaded right now');
    await expect(banner).not.toContainText(/Try again\.+\s*Try again/);

    await banner.locator('.ws-error-btn', { hasText: 'Retry' }).click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
    await expect(page.locator('.ws-error')).toHaveCount(0);
    expect(api.callsTo(`POST /sessions/${SID}/nodes`).length).toBe(2);
  });

  test('REGRESSION: failed root query keeps the workspace with a Retry instead of dropping to Landing', async ({ page }) => {
    // Pre-fix: any non-402 root failure wiped nodes/rootId and silently dumped
    // the user back to Landing; SSE `error` events were parsed but ignored.
    let attempts = 0;
    const api = baseApi().on('POST /sessions/stream', route => {
      attempts++;
      if (attempts === 1) {
        return fulfillSse(route, [{ type: 'error', message: 'The AI provider took too long to respond', status: 500 }]);
      }
      return fulfillSse(route, rootStreamEvents());
    });
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await submitQuery(page, 'how does photosynthesis work?');

    // Still in the workspace, with the in-band SSE error surfaced
    await expect(page.locator('.landing')).toHaveCount(0);
    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('The AI provider took too long to respond');

    await banner.locator('.ws-error-btn', { hasText: 'Retry' }).click();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
    await expect(page.locator('.ws-error')).toHaveCount(0);
  });

  test('guest hitting the trial cap (402) gets a log-in CTA, not "open Billing"', async ({ page }) => {
    const api = new MockApi()
      .on(`GET /share/${SHARE_TOKEN}`, fullSession({ isTrial: true, nodeCount: 3 }))
      .on(`POST /share/${SHARE_TOKEN}/nodes`, 402);
    const auth = await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await page.locator('.deeper-btn').first().click();

    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('Trial limit reached — log in to keep exploring');
    await expect(banner).not.toContainText('Billing');

    await banner.locator('.ws-error-btn', { hasText: 'Log in' }).click();
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
    // REGRESSION guard: the CTA must invoke forceLogin, never a sign-out bounce
    expect(auth.signOutCalls.length).toBe(0);
  });

  test('guest blocked by the daily trial budget (429) sees the server message + log-in CTA', async ({ page }) => {
    const api = new MockApi()
      .on(`GET /share/${SHARE_TOKEN}`, fullSession({ isTrial: true, nodeCount: 3 }))
      .on(`POST /share/${SHARE_TOKEN}/nodes`, route =>
        fulfillJson(route, { message: 'Trial limit reached for today — log in to continue', statusCode: 429 }, 429));
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await page.locator('.deeper-btn').first().click();

    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('Trial limit reached for today — log in to continue');
    await expect(banner.locator('.ws-error-btn', { hasText: 'Log in' })).toBeVisible();
  });

  test('REGRESSION: authed Cut-Off shows the length-limit reason; Retry re-fires with boost', async ({ page }) => {
    // Pre-fix: an over-long (Verbose) answer truncated at max_tokens → JSON parse
    // failed → generic "unreadable answer", and Retry re-ran at the same budget →
    // identical failure. Now: a 422 OUTPUT_TRUNCATED surfaces the real reason and
    // the authed Retry doubles the budget (boost:true).
    let attempts = 0;
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, route => {
      attempts++;
      if (attempts === 1) {
        return fulfillJson(route, { message: 'The answer was cut off — it hit the length limit', code: 'OUTPUT_TRUNCATED' }, 422);
      }
      return fulfillJson(route, deeperNode());
    });
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('hit the length limit');

    await banner.locator('.ws-error-btn', { hasText: 'Retry' }).click();
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');
    await expect(page.locator('.ws-error')).toHaveCount(0);

    const calls = api.callsTo(`POST /sessions/${SID}/nodes`);
    expect(calls.length).toBe(2);
    // First attempt carries no boost; the Retry of a Cut-Off doubles the budget.
    expect((calls[0].body as { boost?: boolean }).boost).toBeUndefined();
    expect((calls[1].body as { boost?: boolean }).boost).toBe(true);
  });

  test('REGRESSION: guest Cut-Off shows the reason but no Retry (same budget would truncate again)', async ({ page }) => {
    const api = new MockApi()
      .on(`GET /share/${SHARE_TOKEN}`, fullSession({ isTrial: true, nodeCount: 1 }))
      .on(`POST /share/${SHARE_TOKEN}/nodes`, route =>
        fulfillJson(route, { message: 'The answer was cut off — it hit the length limit', code: 'OUTPUT_TRUNCATED' }, 422));
    await mockAuth(page, { authed: false });
    await primeStorage(page, { visited: false });
    await api.install(page);

    await page.goto(`/?sk=${SHARE_TOKEN}`);
    await page.locator('.deeper-btn').first().click();

    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('hit the length limit');
    // 422 → not the 402/429 Log-in CTA; a guest can't Retry a Cut-Off either.
    await expect(banner.locator('.ws-error-btn')).toHaveCount(0);
  });

  test('authed 402 on a branch still points at Billing (no retry button)', async ({ page }) => {
    const api = baseApi().on(`POST /sessions/${SID}/nodes`, 402);
    await gotoWorkspace(page, api);

    await page.locator('.deeper-btn').first().click();
    const banner = page.locator('.ws-error');
    await expect(banner).toContainText('Out of credit — open Billing to recharge');
    await expect(banner.locator('.ws-error-btn')).toHaveCount(0);
  });
});
