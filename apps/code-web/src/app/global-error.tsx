'use client';
import * as Sentry from '@sentry/nextjs';
import posthog from 'posthog-js';
import { useEffect } from 'react';

// Root error boundary — catches errors thrown in the root layout itself.
// Reports to Sentry (no-op without a DSN) and PostHog (boundary-caught errors
// never reach window.onerror, so exception autocapture can't see them), and
// renders a minimal fallback with the error text so device crashes are
// diagnosable without a remote debugger.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    posthog.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "'DM Sans', system-ui, sans-serif", padding: 40, textAlign: 'center', color: '#1c1917' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong.</h1>
        <p style={{ color: '#78716c', marginBottom: 20 }}>An unexpected error occurred. Try reloading the page.</p>
        <a href="/" style={{ color: '#1c1917' }}>← Back to fork ai</a>
        <pre
          style={{
            marginTop: 28,
            padding: 12,
            textAlign: 'left',
            fontSize: 11,
            lineHeight: 1.5,
            color: '#a8a29e',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            border: '1px solid #e7e5e4',
            borderRadius: 8,
            maxWidth: 560,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {`${error.name}: ${error.message}${error.digest ? `\ndigest: ${error.digest}` : ''}\n${(error.stack || '').split('\n').slice(1, 5).join('\n')}`}
        </pre>
      </body>
    </html>
  );
}
