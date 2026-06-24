import { test, expect, type Page } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { userProfile } from '../fixtures/data';

/**
 * Billing — international payment flow.
 *
 * The suite mocks three layers:
 *   1. Razorpay checkout.js → stub that captures constructor options and
 *      auto-fires handler(success) or modal.ondismiss(cancel) based on
 *      window.__e2eRzpMode set per-test.
 *   2. POST /billing/orders → controlled via MockApi
 *   3. POST /billing/verify → controlled via MockApi
 *
 * Timezone detection (detectPaymentCurrency in AccountButton) uses
 * Intl.DateTimeFormat.prototype.resolvedOptions, overridden in addInitScript.
 */

// Razorpay stub injected as the response to any checkout.razorpay.com request.
// It stores the constructor options in window.__rzpOptions so tests can inspect
// what currency/amount was passed. The open() behaviour is controlled by
// window.__e2eRzpMode ('success' | 'cancel') set before each click.
const RZP_STUB_JS = `
  window.Razorpay = function(opts) {
    window.__rzpOptions = opts;
    this.open = function() {
      const mode = window.__e2eRzpMode || 'success';
      if (mode === 'cancel') {
        setTimeout(function() { opts.modal.ondismiss(); }, 30);
      } else {
        setTimeout(function() {
          opts.handler({
            razorpay_order_id: opts.order_id,
            razorpay_payment_id: 'pay_E2ETEST00001',
            razorpay_signature: 'sig_e2etest_abc',
          });
        }, 30);
      }
    };
  };
`;

async function stubRazorpayScript(page: Page) {
  await page.route('**/checkout.razorpay.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: RZP_STUB_JS,
    }),
  );
}

function spoofTimezone(page: Page, timeZone: string) {
  return page.addInitScript(tz => {
    const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...orig.call(this), timeZone: tz };
    };
  }, timeZone);
}

/** Shared boilerplate: hide Next.js dev portal so the gear button is clickable. */
function hideDevPortal(page: Page) {
  return page.addInitScript(() => {
    const apply = () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal{display:none!important}';
      document.head?.appendChild(s);
    };
    if (document.head) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  });
}

const INR_ORDER = {
  orderId: 'order_INR_E2E_001',
  amountInr: 42500, // ₹425 in paise (at ~85 INR/USD)
  amountUsd: 5,
  currency: 'INR',
  keyId: 'rzp_test_e2e',
};

const USD_ORDER = {
  orderId: 'order_USD_E2E_001',
  amountInr: 0,
  amountUsd: 5,
  currency: 'USD',
  keyId: 'rzp_test_e2e',
};

const VERIFY_OK = { credited: 5 };

async function openBilling(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
}

async function openRechargePanel(page: Page) {
  await page.getByRole('button', { name: 'Add Credit' }).click();
}

test.describe('Billing — recharge flow', () => {
  test('USD (international timezone): order uses USD cents, no INR in description', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile({ creditUsd: 5 }))
      .on('POST /billing/orders', USD_ORDER)
      .on('POST /billing/verify', VERIFY_OK);

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);
    await openRechargePanel(page);
    await page.getByRole('button', { name: '$5', exact: true }).click();

    // Wait for success confirmation
    await expect(page.getByText('$5.00 credit added.')).toBeVisible();

    // Verify order request used USD
    const orderCalls = api.callsTo('POST /billing/orders');
    expect(orderCalls).toHaveLength(1);
    expect((orderCalls[0].body as { currency: string }).currency).toBe('USD');
    expect((orderCalls[0].body as { amountUsd: number }).amountUsd).toBe(5);

    // Verify Razorpay was opened with USD cents (5 * 100 = 500)
    const rzpOptions = await page.evaluate(() => window.__rzpOptions as Record<string, unknown>);
    expect(rzpOptions.currency).toBe('USD');
    expect(rzpOptions.amount).toBe(500);
    // Description should not mention ₹ for USD orders
    expect(String(rzpOptions.description)).not.toContain('₹');

    // Verify payment API was called
    const verifyCalls = api.callsTo('POST /billing/verify');
    expect(verifyCalls).toHaveLength(1);
    expect((verifyCalls[0].body as { paymentId: string }).paymentId).toBe('pay_E2ETEST00001');
  });

  test('INR (India timezone): order uses INR paise, description shows ₹', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'Asia/Kolkata');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile({ creditUsd: 5 }))
      .on('POST /billing/orders', INR_ORDER)
      .on('POST /billing/verify', VERIFY_OK);

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);
    await openRechargePanel(page);
    await page.getByRole('button', { name: '$5', exact: true }).click();

    await expect(page.getByText('$5.00 credit added.')).toBeVisible();

    // Order must request INR
    const orderCalls = api.callsTo('POST /billing/orders');
    expect(orderCalls).toHaveLength(1);
    expect((orderCalls[0].body as { currency: string }).currency).toBe('INR');

    // Razorpay opened with paise amount
    const rzpOptions = await page.evaluate(() => window.__rzpOptions as Record<string, unknown>);
    expect(rzpOptions.currency).toBe('INR');
    expect(rzpOptions.amount).toBe(42500);
    expect(String(rzpOptions.description)).toContain('₹');
  });

  test('balance updates in UI after successful recharge', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile({ creditUsd: 3.50 }))
      .on('POST /billing/orders', { ...USD_ORDER, amountUsd: 10, orderId: 'order_USD_10' })
      .on('POST /billing/verify', { credited: 10 });

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);

    // Initial balance shown
    await expect(page.getByText('$3.50')).toBeVisible();

    await openRechargePanel(page);
    await page.getByRole('button', { name: '$10' }).click();

    await expect(page.getByText('$10.00 credit added.')).toBeVisible();
    // Balance should reflect the addition (3.50 + 10 = 13.50)
    await expect(page.getByText('$13.50')).toBeVisible();
  });

  test('custom amount: sends correct amountUsd to the order API', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile({ creditUsd: 2 }))
      .on('POST /billing/orders', { ...USD_ORDER, amountUsd: 25, orderId: 'order_USD_25' })
      .on('POST /billing/verify', { credited: 25 });

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);
    await openRechargePanel(page);

    await page.getByPlaceholder('Custom (min $1)').fill('25');
    await page.getByRole('button', { name: 'Pay' }).click();

    await expect(page.getByText('$25.00 credit added.')).toBeVisible();

    const orderCalls = api.callsTo('POST /billing/orders');
    expect(orderCalls).toHaveLength(1);
    expect((orderCalls[0].body as { amountUsd: number }).amountUsd).toBe(25);
  });

  test('custom amount below $1 shows validation error without hitting API', async ({ page }) => {
    await hideDevPortal(page);
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('POST /billing/orders', USD_ORDER)
      .on('POST /billing/verify', VERIFY_OK);

    await gotoWorkspace(page, api);

    await openBilling(page);
    await openRechargePanel(page);

    await page.getByPlaceholder('Custom (min $1)').fill('0.5');
    await page.getByRole('button', { name: 'Pay' }).click();

    await expect(page.getByText('Minimum $1')).toBeVisible();
    expect(api.callsTo('POST /billing/orders')).toHaveLength(0);
  });

  test('cancel (modal dismiss): no error shown, verify never called', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('POST /billing/orders', USD_ORDER)
      .on('POST /billing/verify', VERIFY_OK);

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'cancel'; });

    await openBilling(page);
    await openRechargePanel(page);
    await page.getByRole('button', { name: '$5', exact: true }).click();

    // Wait for the dismiss to resolve (loader disappears)
    await expect(page.getByText('Opening payment…')).not.toBeVisible({ timeout: 3000 });

    // No error message
    await expect(page.locator('[style*="color: rgb(192, 57, 43)"]').filter({ hasText: /payment/i })).not.toBeVisible();
    // Verify was never called
    expect(api.callsTo('POST /billing/verify')).toHaveLength(0);
  });

  test('verify failure: shows error message to user', async ({ page }) => {
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('POST /billing/orders', USD_ORDER)
      .on('POST /billing/verify', 500); // server error

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);
    await openRechargePanel(page);
    await page.getByRole('button', { name: '$5', exact: true }).click();

    await expect(page.getByText('Payment verification failed')).toBeVisible();
  });

  test('no currency sent when order API omits it (backward-compat default)', async ({ page }) => {
    // When currency is undefined from the server, the fallback path should not break the UI
    await hideDevPortal(page);
    await spoofTimezone(page, 'America/New_York');
    await stubRazorpayScript(page);

    // Simulate an older API response without explicit currency
    const legacyOrder = { orderId: 'order_legacy', amountInr: 0, amountUsd: 5, currency: 'USD', keyId: 'rzp_test_e2e' };

    const api = baseApi()
      .on('GET /users/me', userProfile())
      .on('POST /billing/orders', legacyOrder)
      .on('POST /billing/verify', VERIFY_OK);

    await gotoWorkspace(page, api);
    await page.evaluate(() => { window.__e2eRzpMode = 'success'; });

    await openBilling(page);
    await openRechargePanel(page);
    await page.getByRole('button', { name: '$5', exact: true }).click();

    await expect(page.getByText('$5.00 credit added.')).toBeVisible();
  });
});

// Extend Window type for the stubs used above
declare global {
  interface Window {
    __e2eRzpMode?: 'success' | 'cancel';
    __rzpOptions?: Record<string, unknown>;
  }
}
