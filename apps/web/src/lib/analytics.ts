import posthog from 'posthog-js';

// PostHog product analytics. Everything is a no-op unless NEXT_PUBLIC_POSTHOG_KEY
// is set at build time, so local dev and forks send nothing.

let inited = false;

export function initAnalytics(): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || inited || typeof window === 'undefined') return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    // Sentry has no DSN in prod, so this is the only place uncaught client
    // exceptions (incl. React 19 reportError) get recorded.
    capture_exceptions: true,
  });
  inited = true;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!inited) return;
  posthog.capture(event, props);
}

export function identifyUser(id: string, email?: string): void {
  if (!inited) return;
  posthog.identify(id, email ? { email } : undefined);
}

export function resetAnalytics(): void {
  if (!inited) return;
  posthog.reset();
}
