// Server-side PostHog capture. The next-auth `jwt` callback runs in the SSR Lambda,
// where posthog-js (browser-only) can't run, so we POST straight to PostHog's ingestion
// endpoint — no posthog-node dependency, no batching/flush to babysit in serverless.
// No-op unless NEXT_PUBLIC_POSTHOG_KEY is set (same key the client uses), so local dev
// and forks send nothing. Awaited by callers, but bounded by a 2s timeout and never throws,
// so it can't slow down or break the auth path beyond that ceiling.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export async function captureServer(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!KEY) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: KEY, event, distinct_id: distinctId, properties }),
      signal: ctrl.signal,
    });
  } catch {
    // Telemetry is best-effort — a dropped event must never affect auth.
  } finally {
    clearTimeout(timer);
  }
}
