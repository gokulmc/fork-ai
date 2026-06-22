import { defineConfig, devices } from '@playwright/test';

// Remote E2E config — runs the full mock-based suite against a live deployment.
// The NestJS API and next-auth session are mocked at the network layer
// (host-agnostic regex in mock-api.ts; glob patterns in auth.ts) so no real
// Cognito credentials or DynamoDB calls are needed.
//
// Usage:
//   E2E_BASE_URL=https://main.forkai.in npx playwright test -c e2e/playwright.remote.config.ts

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://main.forkai.in';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 2,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
      testIgnore: [/mobile\.spec\.ts/, /auth-refresh\.spec\.ts/],
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  // No webServer — the app is already deployed remotely.
});
