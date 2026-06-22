import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * fork.ai E2E suite.
 *
 * Runs against the Next.js web app (port 3001) with the NestJS API fully
 * mocked at the network layer (see fixtures/mock-api.ts). No DynamoDB,
 * Cognito, or LLM keys are needed — every test is deterministic.
 *
 * NEXT_PUBLIC_API_BASE_URL is forced to http://localhost:3000 for the
 * webServer (it overrides .env.local, which may point at a LAN IP from
 * phone testing). If you reuse an already-running dev server, make sure it
 * was started with the localhost base or the route mocks will not match —
 * the mocks themselves are host-agnostic, but auth cookies and CORS aren't.
 */
// Port 3001 can be squatted by OTHER local apps (e.g. p2p-lending-tracker's dev
// server) — reuseExistingServer would then run the whole suite against the wrong
// app and every test fails with "element not found". Set E2E_PORT to sidestep a
// collision: `E2E_PORT=3101 npm run test:e2e`.
const PORT = Number(process.env.E2E_PORT ?? 3001);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One local retry absorbs occasional dev-server load flakes on the
  // animation-heavy login flow under high parallelism; CI gets two.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // The app registers a service worker (public/sw.js). Once active it proxies
    // fetches, and WebKit does NOT surface SW-initiated requests to page.route
    // (Chromium does) — so API mocks intermittently leaked to the real network.
    // Blocking SW registration keeps every fetch in the page context on all engines.
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      // clipboard permissions are Chromium-only — WebKit rejects them.
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
      // Mobile-only specs are isolated to the mobile project. auth-refresh runs the REAL
      // next-auth refresh against a black-holed Cognito — it has its own config
      // (playwright.auth-refresh.config.ts) and must not run on this mock-everything server.
      testIgnore: [/mobile\.spec\.ts/, /auth-refresh\.spec\.ts/],
    },
    {
      name: 'mobile',
      // iPhone 13 — viewport 390×664, hasTouch, isMobile, devicePixelRatio 3.
      use: { ...devices['iPhone 13'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: path.resolve(__dirname, '../apps/web'),
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      // Override the LAN-IP values that may live in apps/web/.env.local —
      // real process env always wins over .env files in Next.js.
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3000',
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
