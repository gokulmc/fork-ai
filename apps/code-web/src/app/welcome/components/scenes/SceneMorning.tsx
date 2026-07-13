'use client';
import { useEffect, useState } from 'react';
import { ChevronRight, Copy, Check } from '@/components/Icons';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';

const TOGGLES = [
  { id: 'summary', title: 'Summary', body: 'Adds per-user rate limiting to the API with a Redis-backed sliding-window counter. Fixes the boundary-burst issue where fixed windows let a client send up to 2x its limit across a reset.' },
  { id: 'changes', title: 'Changes', body: 'src/rateLimiter.ts (new), src/rateLimiter.test.ts (new), src/app.ts (+6 −1) — middleware wired in ahead of the existing routes.' },
  { id: 'testplan', title: 'Test plan', body: 'rateLimiter.test.ts covers the boundary case directly. Full suite green locally: 42 passing, 0 failing.' },
];

const PR_LINK = 'github.com/acme-labs/billing-service/pull/42';

// Beat: Sunday night ends; the project persists exactly as it was, and by
// morning a teammate has already reviewed the PR on GitHub — no waiting for
// Alex to walk them through it.
export function SceneMorning() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const { addNode, ensureStoryNodes } = useStory();
  const [open, setOpen] = useState<Record<string, boolean>>({ summary: true });
  const [copied, setCopied] = useState(false);
  const [reviewArrived, setReviewArrived] = useState(false);

  // Fast scrollers who land here directly still see the full project behind
  // the "teammate reviewed anyway" beat, not just the review node in isolation.
  useEffect(() => {
    if (inView) ensureStoryNodes();
  }, [inView, ensureStoryNodes]);

  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(() => {
      addNode({ id: 'teammate', parentId: 'root', label: 'Priya · PR review', kind: 'guest' });
      setReviewArrived(true);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [inView, addNode]);

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(PR_LINK);
    } catch {
      // Clipboard API unavailable — link stays visible/selectable.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section id="scene-morning" data-time="1935" className="wp-scene wp-scene-morning">
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">MON · 8:15 AM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">It survives the night</h2>
        <p className="wp-sub wp-reveal">
          Monday morning: she reopens the project from Projects. Same map, same commits, exactly
          where she left them.
        </p>

        <div ref={ref} className={`wp-morning-body ${inView ? 'wp-in-view' : ''}`}>
          <div className="wp-notion-toggles">
            {TOGGLES.map(t => (
              <div key={t.id} className="wp-notion-toggle">
                <button
                  type="button"
                  className="wp-notion-toggle-head"
                  onClick={() => toggle(t.id)}
                  aria-expanded={!!open[t.id]}
                >
                  <ChevronRight size={14} className={open[t.id] ? 'wp-chevron-open' : ''} />
                  {t.title}
                </button>
                {open[t.id] && <p className="wp-notion-toggle-body">{t.body}</p>}
              </div>
            ))}
          </div>

          <div className="wp-share-row">
            <span className="wp-share-link">{PR_LINK}</span>
            <button type="button" className="wp-btn-outline wp-share-copy" onClick={onCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {reviewArrived && (
            <p className="wp-morning-caption wp-fade-in-el">
              8:32 AM — Priya opened the PR from her phone. Left one comment. Approved.
            </p>
          )}

          <p className="wp-compare-note">Reopen it anytime — the whole map, every commit, is still there.</p>

          <p className="wp-why">№4 — It ends as a reviewable PR, not a transcript you&rsquo;ll never reopen.</p>
        </div>
      </div>
    </section>
  );
}
