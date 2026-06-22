import { defineConfig } from '@playwright/test';
import path from 'path';

/**
 * Isolated config for the server-side token-refresh test (auth-refresh.spec.ts).
 *
 * Unlike the main suite, this one does NOT mock /api/auth/session — it drives the
 * real next-auth `jwt` callback in apps/web/src/auth.ts. The Cognito SDK is pointed
 * at a black-holed endpoint (127.0.0.1:1), so every REFRESH_TOKEN_AUTH call fails
 * instantly with a connection error (the "transient" class) without touching AWS.
 *
 * Run with: npm run test:e2e:auth-refresh
 */
const PORT = Number(process.env.AUTH_REFRESH_PORT ?? 3021);

export default defineConfig({
  testDir: './tests',
  testMatch: /auth-refresh\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: { baseURL: `http://localhost:${PORT}` },

  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: path.resolve(__dirname, '../apps/web'),
    port: PORT,
    // Always a fresh server so an edit to auth.ts between runs is picked up.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      // Force every Cognito SDK call to fail with a connection error (transient
      // class) without hitting real AWS. 127.0.0.1:1 refuses instantly.
      AWS_ENDPOINT_URL: 'http://127.0.0.1:1',
      AWS_MAX_ATTEMPTS: '1', // no SDK-level retry/backoff — keep the test fast
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
