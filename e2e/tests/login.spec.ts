import { test, expect, type Page } from '@playwright/test';
import { mockAuth, TEST_EMAIL } from '../fixtures/auth';
import { mockCognito } from '../fixtures/cognito';
import { primeStorage, baseApi } from '../fixtures/app';

/**
 * The custom email/password login UI (LoginPage.tsx). Cognito itself is
 * mocked at the /api/cognito/* layer; signIn('cognito-token') is mocked at
 * /api/auth/callback/* (flips the session mock to authed). A successful
 * sign-in plays the graph animation → "arrived" screen → auto-onEnter after
 * 1.5s → Landing.
 */

const GOOD_PW = 'Str0ng#Pass';

async function gotoLogin(page: Page) {
  await page.goto('/');
  await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
}

async function submitEmail(page: Page, email = TEST_EMAIL) {
  const input = page.getByPlaceholder('enter email to login or signup');
  await input.fill(email);
  await input.press('Enter');
  await expect(page.getByPlaceholder('password')).toBeVisible();
}

async function expectArrivedThenLanding(page: Page) {
  await expect(page.getByText('arrived', { exact: true })).toBeVisible({ timeout: 20_000 });
  // onEnter auto-fires 1.5s after the arrived screen shows
  await expect(page.getByPlaceholder('Try: how does photosynthesis work?')).toBeVisible({ timeout: 20_000 });
}

test.describe('Login — correct & wrong password', () => {
  test('existing user with the correct password signs in and lands on the workspace', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await mockCognito(page, { userExists: true, password: GOOD_PW });
    await primeStorage(page, { visited: true });
    await baseApi().install(page);

    await gotoLogin(page);
    await submitEmail(page);
    await expect(page.getByText(`signing in as ${TEST_EMAIL}`)).toBeVisible();

    await page.getByPlaceholder('password').fill(GOOD_PW);
    await page.getByPlaceholder('password').press('Enter');

    await expectArrivedThenLanding(page);
  });

  test('wrong password shows "Incorrect password" and reveals the forgot-password link', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await mockCognito(page, { userExists: true, password: GOOD_PW });
    await primeStorage(page, { visited: true });
    await baseApi().install(page);

    await gotoLogin(page);
    await submitEmail(page);
    await page.getByPlaceholder('password').fill('Wrong#Pass1');
    await page.getByPlaceholder('password').press('Enter');

    await expect(page.getByText('Incorrect password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'forgot password?' })).toBeVisible();
    // Still on the password step — no animation, no landing
    await expect(page.getByPlaceholder('password')).toBeVisible();
  });
});

test.describe('Login — new account (signup → verify)', () => {
  test('unknown email routes to signup; password rules enforced; email code verifies and signs in', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await mockCognito(page, { userExists: false, verifyCode: '424242' });
    await primeStorage(page, { visited: true });
    await baseApi().install(page);

    await gotoLogin(page);
    await submitEmail(page, 'new-user@forkai.test');
    // check-email already knows the user doesn't exist
    await expect(page.getByText('signing up as new-user@forkai.test')).toBeVisible();

    // Any password attempt on an unknown account routes into signup
    await page.getByPlaceholder('password').fill('whatever1A#');
    await page.getByPlaceholder('password').press('Enter');
    await expect(page.getByText('creating account for new-user@forkai.test')).toBeVisible();

    const newPw = page.getByPlaceholder('new password');
    const confirmPw = page.getByPlaceholder('confirm password');

    // Too weak → pool password policy error
    await newPw.fill('weak');
    await confirmPw.fill('weak');
    await confirmPw.press('Enter');
    await expect(page.getByText(/Min 8 chars/)).toBeVisible();

    // Mismatch
    await newPw.fill(GOOD_PW);
    await confirmPw.fill(`${GOOD_PW}x`);
    await confirmPw.press('Enter');
    await expect(page.getByText('Passwords do not match')).toBeVisible();

    // Valid → verify step with the spam-folder hint
    await confirmPw.fill(GOOD_PW);
    await confirmPw.press('Enter');
    const codeInput = page.getByPlaceholder('verification code from email');
    await expect(codeInput).toBeVisible();
    await expect(page.getByText(/check your spam folder/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'resend code' })).toBeVisible();

    // Wrong code → Cognito error surfaces
    await codeInput.fill('000000');
    await codeInput.press('Enter');
    await expect(page.getByText('CodeMismatchException')).toBeVisible();

    // Correct code → confirm + auto-login
    await codeInput.fill('424242');
    await codeInput.press('Enter');
    await expectArrivedThenLanding(page);
  });
});

test.describe('Login — forgot password', () => {
  test('reset flow: code + new password signs the user back in', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await mockCognito(page, { userExists: true, password: GOOD_PW, verifyCode: '777777' });
    await primeStorage(page, { visited: true });
    await baseApi().install(page);

    await gotoLogin(page);
    await submitEmail(page);
    // The reset link is only offered after a failed password attempt
    await page.getByPlaceholder('password').fill('Wrong#Pass1');
    await page.getByPlaceholder('password').press('Enter');
    await page.getByRole('button', { name: 'forgot password?' }).click();

    await expect(page.getByText(`reset password for ${TEST_EMAIL}`)).toBeVisible();
    await page.getByPlaceholder('reset code from email').fill('777777');
    await page.getByPlaceholder('new password', { exact: true }).fill(GOOD_PW);
    const confirm = page.getByPlaceholder('confirm new password');
    await confirm.fill(GOOD_PW);
    await confirm.press('Enter');

    await expectArrivedThenLanding(page);
  });

  test('back link returns to the email step and clears errors', async ({ page }) => {
    await mockAuth(page, { authed: false });
    await mockCognito(page, { userExists: true, password: GOOD_PW });
    await primeStorage(page, { visited: true });
    await baseApi().install(page);

    await gotoLogin(page);
    await submitEmail(page);
    await page.getByPlaceholder('password').fill('Wrong#Pass1');
    await page.getByPlaceholder('password').press('Enter');
    await expect(page.getByText('Incorrect password')).toBeVisible();

    await page.getByRole('button', { name: '← back' }).click();
    await expect(page.getByText('Incorrect password')).toHaveCount(0);
    await expect(page.getByPlaceholder('enter email to login or signup')).toBeVisible();
  });
});
