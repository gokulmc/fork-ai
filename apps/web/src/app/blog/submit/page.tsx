'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { submitBlogPost } from '@/lib/api';

const label: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  margin: '0 0 7px',
};
const field: React.CSSProperties = {
  width: '100%',
  background: 'var(--paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius)',
  padding: '10px 12px',
  color: 'var(--ink)',
  fontFamily: 'var(--sans)',
  fontSize: 15,
  lineHeight: 1.5,
};

export default function SubmitBlogPage() {
  const { data: session, status } = useSession();
  const idToken = (session as { idToken?: string } | null)?.idToken ?? '';

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const canSubmit = title.trim().length >= 4 && body.trim().length >= 50 && state !== 'saving';

  const onSubmit = async () => {
    if (!canSubmit) return;
    setState('saving');
    setError('');
    try {
      await submitBlogPost({ title: title.trim(), summary: summary.trim() || undefined, body: body.trim() }, idToken);
      setState('done');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  if (status === 'loading') {
    return <article className="post"><p className="post-meta">Loading…</p></article>;
  }

  if (status !== 'authenticated') {
    return (
      <article className="post">
        <h1>Write a post</h1>
        <p>You need to be logged in to submit a blog post.</p>
        <div className="post-cta">
          <p>Log in to fork ai, then come back here to submit your draft.</p>
          <Link className="btn" href="/">Log in →</Link>
        </div>
      </article>
    );
  }

  if (state === 'done') {
    return (
      <article className="post">
        <h1>Thanks — submitted! 🎉</h1>
        <p>
          Your draft is in the review queue. If we publish it, it&rsquo;ll appear on the blog. You can submit
          another anytime.
        </p>
        <div className="post-cta">
          <p>Want to write another?</p>
          <button
            className="btn"
            onClick={() => { setTitle(''); setSummary(''); setBody(''); setState('idle'); }}
            style={{ cursor: 'pointer', border: 0 }}
          >
            Write another →
          </button>
        </div>
        <p style={{ marginTop: 20 }}><Link href="/blog">← Back to the blog</Link></p>
      </article>
    );
  }

  return (
    <article className="post">
      <h1>Write a post</h1>
      <p className="post-meta">Submit a draft for review</p>
      <p>
        Share something worth reading on AI research, mind maps, or how you use fork ai. Markdown is
        supported. We review every submission before it goes live.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 28 }}>
        <div>
          <label style={label} htmlFor="bp-title">Title</label>
          <input
            id="bp-title"
            style={field}
            value={title}
            maxLength={160}
            placeholder="A clear, specific headline"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label style={label} htmlFor="bp-summary">Summary <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input
            id="bp-summary"
            style={field}
            value={summary}
            maxLength={300}
            placeholder="One sentence on what it's about"
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <div>
          <label style={label} htmlFor="bp-body">Body <span style={{ textTransform: 'none', letterSpacing: 0 }}>(markdown)</span></label>
          <textarea
            id="bp-body"
            style={{ ...field, minHeight: 320, fontFamily: 'var(--mono)', fontSize: 13.5, resize: 'vertical' }}
            value={body}
            maxLength={40000}
            placeholder={'## A heading\n\nWrite your post here. Markdown — **bold**, _italic_, lists, links — all work.'}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 6, letterSpacing: '0.04em' }}>
            {body.trim().length}/50 min characters
          </div>
        </div>

        {state === 'error' && (
          <div style={{ color: '#c0392b', fontSize: 13 }}>{error || 'Could not submit — please try again.'}</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            className="btn"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{ cursor: canSubmit ? 'pointer' : 'not-allowed', border: 0, opacity: canSubmit ? 1 : 0.5 }}
          >
            {state === 'saving' ? 'Submitting…' : 'Submit for review →'}
          </button>
          <Link href="/blog" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none' }}>
            Cancel
          </Link>
        </div>
      </div>
    </article>
  );
}
