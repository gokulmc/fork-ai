'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { listMyBlogSubmissions, type BlogSubmission } from '@/lib/api';

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--ink-3)',
  approved: '#15803d',
  rejected: '#c0392b',
};

export default function MySubmissionsPage() {
  const { data: session, status } = useSession();
  const idToken = (session as { idToken?: string } | null)?.idToken ?? '';
  const [subs, setSubs] = useState<BlogSubmission[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !idToken) return;
    listMyBlogSubmissions(idToken)
      .then(setSubs)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, [status, idToken]);

  if (status === 'loading') {
    return <article className="post"><p className="post-meta">Loading…</p></article>;
  }

  if (status !== 'authenticated') {
    return (
      <article className="post">
        <h1>My submissions</h1>
        <p>Log in to see the posts you&rsquo;ve submitted.</p>
        <div className="post-cta">
          <p>Log in to fork ai to view your submissions.</p>
          <Link className="btn" href="/">Log in →</Link>
        </div>
      </article>
    );
  }

  return (
    <article className="post">
      <h1>My submissions</h1>
      <p className="post-meta">Posts you&rsquo;ve submitted for review</p>

      {err && <p style={{ color: '#c0392b' }}>{err}</p>}

      {!subs ? (
        <p className="post-meta">Loading…</p>
      ) : subs.length === 0 ? (
        <p>You haven&rsquo;t submitted any posts yet. <Link href="/blog/submit">Write one →</Link></p>
      ) : (
        <div style={{ marginTop: 24 }}>
          {subs.map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid var(--line)', padding: '18px 0' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20 }}>{s.emoji}</span>
                <strong style={{ fontSize: 18 }}>{s.title}</strong>
                <span
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: STATUS_COLOR[s.status] ?? 'var(--ink-3)', border: `1px solid ${STATUS_COLOR[s.status] ?? 'var(--line-strong)'}`,
                    borderRadius: 'var(--radius-sm)', padding: '2px 7px',
                  }}
                >
                  {s.status}
                </span>
                <span className="post-meta" style={{ margin: 0 }}>{fmt(s.createdAt)}</span>
              </div>
              {s.summary && <p style={{ color: 'var(--ink-2)', margin: '8px 0 0' }}>{s.summary}</p>}
              <button
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                style={{ marginTop: 8, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                {openId === s.id ? 'Hide' : 'Read'}
              </button>
              {openId === s.id && (
                <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink)' }}>
                  {s.body}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 28 }}><Link href="/blog/submit">✍ Write another</Link></p>
    </article>
  );
}
