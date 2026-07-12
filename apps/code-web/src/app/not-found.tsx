import Link from 'next/link';
import { ThemeScript } from '@/components/ThemeScript';

export default function NotFound() {
  return (
    <>
      <ThemeScript />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          overflow: 'hidden',
          background: 'var(--bg)',
          color: 'var(--ink)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <Link href="/" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← forkai code</Link>
          <span style={{ color: 'var(--ink-3)' }}>404 — page not found</span>
        </div>
        <p className="history-game-tagline">Nothing here</p>
        <p className="history-game-sub">FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU</p>
      </div>
    </>
  );
}
