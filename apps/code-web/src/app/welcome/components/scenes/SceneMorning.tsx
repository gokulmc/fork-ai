'use client';
import { useEffect, useState } from 'react';
import { ChevronRight, Copy, Check } from '@/components/Icons';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { SHARE_URL } from '../storyContent';

const TOGGLES = [
  { id: 'overview', title: 'Overview', body: 'Access to urban green space is consistently associated with reduced stress, improved mood, and lower depression risk across dozens of observational studies.' },
  { id: 'moderators', title: 'Mood improvement', body: 'Individuals with greater proximity to or more frequent use of green areas report lower rates of depressive symptoms and higher self-reported happiness.' },
  { id: 'askai', title: 'Ask AI — highlighted sentence', body: 'The strongest citation is White et al. (2013, Psychological Science) — a fixed-effects panel study of ~10,000 households that tracks the same people over time.' },
];

const DISPLAY_LINK = SHARE_URL ?? 'https://forkai.in/?sk=8f2a1c9d3e';

// Beat: Sunday night ends; the whole session lands in Notion, then the
// advisor opens the link Monday morning and branches as a guest — no
// account needed.
export function SceneMorning() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const { addNode, ensureStoryNodes } = useStory();
  const [open, setOpen] = useState<Record<string, boolean>>({ overview: true });
  const [copied, setCopied] = useState(false);
  const [guestArrived, setGuestArrived] = useState(false);

  // Fast scrollers who land here directly still see the full session behind
  // the "advisor branched anyway" beat, not just the guest node in isolation.
  useEffect(() => {
    if (inView) ensureStoryNodes();
  }, [inView, ensureStoryNodes]);

  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(() => {
      addNode({ id: 'advisor', parentId: 'root', label: 'Advisor · 8:32 AM (no account)', kind: 'guest' });
      setGuestArrived(true);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [inView, addNode]);

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(DISPLAY_LINK);
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
            <span className="wp-share-link">{DISPLAY_LINK}</span>
            <button type="button" className="wp-btn-outline wp-share-copy" onClick={onCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {guestArrived && (
            <p className="wp-morning-caption wp-fade-in-el">
              8:32 AM — her advisor opened the link on the train. No account. Branched anyway.
            </p>
          )}

          <p className="wp-compare-note">If they sign up later, their branches follow them.</p>

          <p className="wp-why">№4 — It ends as notes in Notion, not a transcript you&rsquo;ll never reopen.</p>
        </div>
      </div>
    </section>
  );
}
