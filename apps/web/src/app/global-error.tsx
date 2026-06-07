'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Root error boundary — catches errors thrown in the root layout itself.
// Reports to Sentry (no-op without a DSN) and renders a minimal fallback.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "'DM Sans', system-ui, sans-serif", padding: 40, textAlign: 'center', color: '#1c1917' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong.</h1>
        <p style={{ color: '#78716c', marginBottom: 20 }}>An unexpected error occurred. Try reloading the page.</p>
        <a href="/" style={{ color: '#1c1917' }}>← Back to fork ai</a>
      </body>
    </html>
  );
}
