import { test, expect } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import fs from 'fs';
import path from 'path';

/**
 * Server-side token-refresh resilience — the intermittent "forced login after ~1 hour" bug.
 *
 * The rest of the suite stubs /api/auth/session (fixtures/auth.ts), so it never runs the
 * real next-auth `jwt` callback. This spec does the opposite: it mints a genuine next-auth
 * session cookie and hits the real /api/auth/session route, driving apps/web/src/auth.ts.
 * The dedicated server (playwright.auth-refresh.config.ts) black-holes the Cognito endpoint,
 * so every REFRESH_TOKEN_AUTH call fails with a connection error — the "transient" class.
 *
 * The bug: ANY refresh failure was collapsed to error:'RefreshTokenExpired', which App.tsx
 * turns into an immediate signOut(). A transient blip must NOT log a user out of a still-valid
 * 30-day refresh token.
 */

// Dev cookie name (auth.ts namespaces it when NODE_ENV !== 'production'; next dev = development).
const COOKIE_NAME = 'forkai.session-token';

function envVal(key: string): string {
  const file = path.resolve(__dirname, '../../apps/web/.env.local');
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) throw new Error(`${key} missing from apps/web/.env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Shape-only id_token — auth.ts only base64-decodes the payload; never verified here.
const FAKE_ID_TOKEN = [
  b64url({ alg: 'none', typ: 'JWT' }),
  b64url({ sub: 'u-refresh-test', email: 'refresh@forkai.test', 'cognito:username': 'u-refresh-test' }),
  'sig',
].join('.');

async function cookieHeader(expiresAt: number): Promise<string> {
  const value = await encode({
    salt: COOKIE_NAME,
    secret: envVal('NEXTAUTH_SECRET'),
    maxAge: 30 * 24 * 3600,
    token: {
      sub: 'u-refresh-test',
      idToken: FAKE_ID_TOKEN,
      refreshToken: 'refresh-token-still-valid',
      username: 'u-refresh-test',
      expiresAt,
    },
  });
  return `${COOKIE_NAME}=${value}`;
}

test.describe('Server-side token refresh resilience', () => {
  test('control: a non-expired session is served unchanged (no refresh attempted)', async ({ request }) => {
    const res = await request.get('/api/auth/session', {
      headers: { Cookie: await cookieHeader(Date.now() + 3600_000) }, // 1h in the future
    });
    const body = await res.json();
    expect(body.idToken).toBe(FAKE_ID_TOKEN);
    expect(body.error).toBeUndefined();
  });

  test('a transient Cognito failure does NOT force logout (session preserved)', async ({ request }) => {
    const res = await request.get('/api/auth/session', {
      headers: { Cookie: await cookieHeader(Date.now() - 1000) }, // already past → triggers refresh
    });
    const body = await res.json();
    // Refresh hits the black-holed endpoint and fails (connection error → transient).
    // BEFORE the fix: error === 'RefreshTokenExpired' → App.tsx signs the user out.
    // AFTER the fix: the transient failure is swallowed and the session is kept.
    expect(body).not.toBeNull();
    expect(body.error).toBeUndefined();
    expect(body.idToken).toBe(FAKE_ID_TOKEN);
  });
});
