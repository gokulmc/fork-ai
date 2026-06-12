import type { Page, Route } from '@playwright/test';
import { FAKE_ID_TOKEN } from './auth';

/**
 * Mocks the Next.js /api/cognito/* routes the custom LoginPage talks to.
 * These are same-origin server routes, so interception fully replaces Cognito.
 * Error shapes mirror what the real routes return ({ error: '<CognitoCode>' }).
 */
export interface CognitoConfig {
  userExists: boolean;
  password?: string;    // the correct password when the user exists
  verifyCode?: string;  // accepted by confirm + confirm-forgot-password (default '123456')
}

const TOKENS = { idToken: FAKE_ID_TOKEN, refreshToken: 'e2e-refresh-token', expiresIn: 3600 };

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function postJson(route: Route): Record<string, string> {
  try { return JSON.parse(route.request().postData() ?? '{}'); } catch { return {}; }
}

export async function mockCognito(page: Page, cfg: CognitoConfig) {
  const code = cfg.verifyCode ?? '123456';

  await page.route('**/api/cognito/check-email', r => json(r, { exists: cfg.userExists }));

  await page.route('**/api/cognito/login', r => {
    if (!cfg.userExists) return json(r, { error: 'UserNotFoundException' });
    if (postJson(r).password === cfg.password) return json(r, TOKENS);
    return json(r, { error: 'NotAuthorizedException' });
  });

  await page.route('**/api/cognito/signup', r => json(r, { ok: true }));
  await page.route('**/api/cognito/resend', r => json(r, { ok: true }));

  await page.route('**/api/cognito/confirm', r =>
    json(r, postJson(r).code === code ? TOKENS : { error: 'CodeMismatchException' }));

  await page.route('**/api/cognito/forgot-password', r => json(r, { ok: true }));

  await page.route('**/api/cognito/confirm-forgot-password', r =>
    json(r, postJson(r).code === code ? TOKENS : { error: 'CodeMismatchException' }));
}
