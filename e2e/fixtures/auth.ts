import type { Page } from '@playwright/test';

/**
 * next-auth v5 session mocking.
 *
 * The app reads auth purely from `useSession()` (SessionProvider fetches
 * `/api/auth/session` client-side), so intercepting that endpoint is enough
 * to simulate any auth state — no Cognito involved. `signOut()` fetches
 * `/api/auth/csrf` then POSTs `/api/auth/signout`; both are intercepted so
 * sign-out flips the mocked state to logged-out, exactly like production.
 * `signIn('cognito-token', …)` (the custom LoginPage flow) POSTs
 * `/api/auth/callback/cognito-token` — intercepted to flip the state to
 * logged-in, so the full login UI can be exercised end-to-end.
 */

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

export const TEST_EMAIL = 'e2e@forkai.test';
export const TEST_SUB = 'u-e2e-test';

function makeToken(groups: string[]): string {
  return [
    b64url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    b64url(JSON.stringify({ sub: TEST_SUB, email: TEST_EMAIL, 'cognito:username': TEST_SUB, 'cognito:groups': groups })),
    'e2e-signature',
  ].join('.');
}

// Shape-only JWTs — the frontend only ever base64-decodes the payload
// (isAdminToken) and forwards the string as a Bearer header to the (mocked) API.
export const FAKE_ID_TOKEN = makeToken([]);
export const FAKE_ADMIN_ID_TOKEN = makeToken(['admins']);

export interface AuthMock {
  state: { authed: boolean; error?: string };
  signOutCalls: number[];
}

export async function mockAuth(
  page: Page,
  opts: { authed?: boolean; error?: string; admin?: boolean } = {},
): Promise<AuthMock> {
  const state = { authed: opts.authed ?? true, error: opts.error };
  const signOutCalls: number[] = [];
  const idToken = opts.admin ? FAKE_ADMIN_ID_TOKEN : FAKE_ID_TOKEN;

  await page.route('**/api/auth/session', route => {
    if (!state.authed) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: 'null' });
    }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: { email: TEST_EMAIL, name: 'E2E Tester' },
        idToken,
        expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        ...(state.error ? { error: state.error } : {}),
      }),
    });
  });

  await page.route('**/api/auth/csrf', route =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csrfToken: 'e2e-csrf' }) }));

  // Credentials sign-in from the custom LoginPage → session becomes authed
  await page.route('**/api/auth/callback/**', route => {
    state.authed = true;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://localhost:3001/' }) });
  });

  await page.route('**/api/auth/signout', route => {
    signOutCalls.push(Date.now());
    state.authed = false;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://localhost:3001/' }) });
  });

  return { state, signOutCalls };
}
