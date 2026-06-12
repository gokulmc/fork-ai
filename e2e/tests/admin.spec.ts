import { test, expect } from '@playwright/test';
import { mockAuth, TEST_EMAIL, TEST_SUB } from '../fixtures/auth';
import { primeStorage } from '../fixtures/app';
import { MockApi } from '../fixtures/mock-api';

function metricsDay(date: string, n: number) {
  return {
    date, users: n, sessions: n * 2, nodes: n * 5,
    revenueUsd: n * 0.5, llmSpendUsd: n * 0.2,
    spendByProvider: { anthropic: n * 0.1, gemini: n * 0.06, deepseek: n * 0.04 },
  };
}

function adminApiMock(): MockApi {
  return new MockApi()
    .on('GET /health', { status: 'ok', version: '0.1.0', commit: 'e2e1234', uptimeSec: 4242 })
    .on('GET /admin/config', { signupCreditUsd: 1, referralCreditUsd: 0.5, creditMultiplier: 1 })
    .on('GET /admin/metrics', {
      userCount: 42, sessionCount: 99, nodeCount: 250,
      revenueUsd: 12.5, llmSpendUsd: 4.2, outstandingCreditUsd: 30,
      llmSpendByProvider: { anthropic: 2.5, gemini: 1.2, deepseek: 0.5 },
      series: [metricsDay('2026-06-09', 3), metricsDay('2026-06-10', 5), metricsDay('2026-06-11', 8)],
    })
    .on('GET /admin/deployment', {
      commit: 'e2e1234', version: '0.1.0', env: 'e2e', region: 'ap-south-1',
      startedAt: '2026-06-11T00:00:00.000Z', uptimeSec: 4242,
    })
    .on('GET /admin/users', {
      items: [{
        sub: TEST_SUB, email: 'first-user@forkai.test',
        createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-10T10:00:00.000Z',
        creditUsd: 3.2, hasOnboarded: true, signupCountry: 'IN', signupCity: 'Chennai',
      }],
      nextCursor: null,
    })
    .on('GET /admin/payments', {
      items: [{
        paymentId: 'pay-e2e-1', orderId: 'order-e2e-1', sub: TEST_SUB,
        amountUsd: 5, amountInr: 440, createdAt: '2026-06-10T12:00:00.000Z',
      }],
      nextCursor: null,
    })
    .on('GET /admin/audit', []);
}

test.describe('Admin panel', () => {
  test('signed-out visitor is asked to sign in', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await primeStorage(page);
    await adminApiMock().install(page);

    await page.goto('/admin');
    await expect(page.getByText('Sign in required')).toBeVisible();
  });

  test('authenticated non-admin is blocked with "Restricted"', async ({ page }) => {
    await mockAuth(page, { authed: true, admin: false });
    await primeStorage(page);
    await adminApiMock().install(page);

    await page.goto('/admin');
    await expect(page.getByText('Restricted')).toBeVisible();
  });

  test('admin sees overview KPIs, live health pill, and identity', async ({ page }) => {
    await mockAuth(page, { authed: true, admin: true });
    await primeStorage(page);
    await adminApiMock().install(page);

    await page.goto('/admin');
    await expect(page.locator('.ad-stat', { hasText: 'Users' }).locator('.ad-stat-value')).toHaveText('42');
    await expect(page.locator('.ad-stat', { hasText: 'Sessions' }).locator('.ad-stat-value')).toHaveText('99');
    await expect(page.locator('.ad-stat', { hasText: 'Nodes' }).locator('.ad-stat-value')).toHaveText('250');
    await expect(page.locator('.ad-headright .ad-pill')).toContainText('API online');
    await expect(page.locator('.ad-whoami')).toContainText(TEST_EMAIL);
  });

  test('Users tab lists users; Payments tab lists payments', async ({ page }) => {
    const api = adminApiMock();
    await mockAuth(page, { authed: true, admin: true });
    await primeStorage(page);
    await api.install(page);

    await page.goto('/admin');
    await page.locator('.ad-tab', { hasText: 'Users' }).click();
    await expect(page.locator('.ad-table')).toContainText('first-user@forkai.test');
    expect(api.callsTo('GET /admin/users').length).toBeGreaterThanOrEqual(1);

    await page.locator('.ad-tab', { hasText: 'Payments' }).click();
    await expect(page.locator('.ad-table')).toContainText('pay-e2e-1');
  });

  test('admin requests carry the admin Bearer token (client gate is cosmetic, API is the boundary)', async ({ page }) => {
    const api = adminApiMock();
    await mockAuth(page, { authed: true, admin: true });
    await primeStorage(page);
    await api.install(page);

    await page.goto('/admin');
    await expect(page.locator('.ad-stat', { hasText: 'Users' })).toBeVisible();
    const [metricsCall] = api.callsTo('GET /admin/metrics');
    expect(metricsCall.headers['authorization']).toMatch(/^Bearer .+/);
  });
});
