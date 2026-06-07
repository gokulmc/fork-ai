import * as Sentry from '@sentry/nextjs';

// No-op unless NEXT_PUBLIC_SENTRY_DSN is set (so dev/CI builds never report).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
