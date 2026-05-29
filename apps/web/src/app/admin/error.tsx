'use client';

// Route-level error boundary for /admin. Turns any render/runtime crash into a
// readable message instead of a blank white page, and surfaces the error text.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        background: '#0b0d12',
        color: '#e7e9ee',
        textAlign: 'center',
      }}
    >
      <h2 style={{ margin: 0 }}>The admin dashboard hit an error</h2>
      <pre
        style={{
          maxWidth: 680,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#fca5a5',
          background: 'rgba(239,68,68,0.1)',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        {error.message}{error.digest ? `\n\ndigest: ${error.digest}` : ''}
      </pre>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={reset} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
          Retry
        </button>
        <a href="/" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #232733', color: '#e7e9ee', textDecoration: 'none' }}>
          Back to app
        </a>
      </div>
    </div>
  );
}
