'use client';
import { useState } from 'react';
import { ChevronRight } from '@/components/Icons';
import { useInView } from './useInView';

const TOGGLES = [
  { id: 'overview', title: 'Overview', body: 'Access to green space is broadly associated with better mental health outcomes across dozens of observational studies.' },
  { id: 'moderators', title: 'Moderating factors', body: 'Socioeconomic status significantly moderates this relationship — lower-income residents see larger gains.' },
  { id: 'askai', title: 'Ask AI — highlighted sentence', body: 'The strongest citation for the moderator claim is a longitudinal cohort study across multiple UK cities.' },
];

// Beat: Sunday night ends; the whole session lands in the Notion doc where
// Alex's thesis already lives. Static/interactive visual mock only — no
// real OAuth flow or pushToNotion call.
export function NotionExportDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [open, setOpen] = useState<Record<string, boolean>>({ overview: true });

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Sunday night wraps</div>
        <h2 className="wp-h2">Push the whole map into Notion</h2>
        <p className="wp-lede">
          One click, and the whole session lands as a real Notion page — not a tab she&rsquo;ll
          never reopen.
        </p>
        <div className="wp-notion-demo">
          <div className="wp-notion-diagram">
            <span className="wp-notion-chip">Root question</span>
            <span className="wp-notion-arrow">→</span>
            <span className="wp-notion-chip">Moderating factors</span>
            <span className="wp-notion-arrow">→</span>
            <span className="wp-notion-chip">Ask AI</span>
            <div className="wp-notion-diagram-label">Mind map (auto-generated)</div>
          </div>
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
        </div>
        <p className="wp-compare-note">
          It slots into the thesis doc Alex already has open, instead of living in a tab
          she&rsquo;ll never reopen.
        </p>
      </div>
    </section>
  );
}
