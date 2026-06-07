import Link from 'next/link';
import { ThemeScript } from '@/components/ThemeScript';
import { ForkTraceGame } from '@/components/ForkTraceGame';

// Reuses the empty-History "let's play a game" experience for the 404.
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
          overflow: 'hidden',
          background: 'var(--bg)',
          color: 'var(--ink)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          <Link href="/" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← fork ai</Link>
          <span style={{ color: 'var(--ink-3)' }}>404 — page not found</span>
        </div>
        <p className="history-game-tagline">Nothing here, let&rsquo;s play a game</p>
        <p className="history-game-sub">FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU</p>
        <ForkTraceGame />
      </div>
    </>
  );
}
