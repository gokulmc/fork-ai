'use client';
import { useState } from 'react';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { WEB_ANSWER, SOURCES } from '../storyContent';

// Beat: the agent's commit, reviewed like a real PR — a narrated log of what
// it did, with each step tied to the file it touched. Citations bloom in and
// a "Files changed" list slides open; receipts here are diffs and test runs,
// not sources.
export function SceneSources() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const { addNode } = useStory();
  const [on, setOn] = useState(false);
  const [activeSource, setActiveSource] = useState<number | null>(null);

  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) {
      addNode({
        id: 'web-branch',
        parentId: 'root',
        label: 'Add per-user rate limiter',
        kind: 'story',
        satellites: SOURCES.length,
      });
    }
  };

  const totalAdd = SOURCES.reduce((n, s) => n + Number(s.diffStat.match(/\+(\d+)/)?.[1] ?? 0), 0);
  const totalDel = SOURCES.reduce((n, s) => n + Number(s.diffStat.match(/−(\d+)/)?.[1] ?? 0), 0);

  return (
    <section id="scene-sources" data-time="1360" className="wp-scene wp-scene-sources">
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">10:40 PM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">Receipts</h2>

        <div ref={ref} className={`wp-sources-body ${inView ? 'wp-in-view' : ''}`}>
          <label className="wp-toggle">
            <input type="checkbox" checked={on} onChange={toggle} />
            <span className="wp-toggle-track"><span className="wp-toggle-thumb" /></span>
            Diff view {on ? 'on' : 'off'}
          </label>

          <div className="wp-demo-card wp-demo-card-compact">
            <p>
              {WEB_ANSWER.split('.').filter(Boolean).map((sentence, i) => (
                <span key={i}>
                  {sentence.trim()}.
                  {on && SOURCES[i] && (
                    <sup className="wp-cite wp-cite-in">
                      <a
                        href={SOURCES[i].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        tabIndex={0}
                        onMouseEnter={() => setActiveSource(SOURCES[i].n)}
                        onMouseLeave={() => setActiveSource(null)}
                        onFocus={() => setActiveSource(SOURCES[i].n)}
                        onBlur={() => setActiveSource(null)}
                      >
                        [{SOURCES[i].n}]
                      </a>
                      {activeSource === SOURCES[i].n && (
                        <span className="wp-source-card">
                          <span className="wp-source-card-title">{SOURCES[i].path}</span>
                          <span className="wp-source-card-year">{SOURCES[i].diffStat}</span>
                        </span>
                      )}
                    </sup>
                  )}{' '}
                </span>
              ))}
            </p>

            {on && (
              <div className="wp-sources-list wp-sources-list-in">
                <div className="wp-sources-label">Files changed · +{totalAdd} −{totalDel}</div>
                <ol>
                  {SOURCES.map(s => (
                    <li key={s.n}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.path} · {s.diffStat}</a>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
