'use client';
import { useState } from 'react';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { WEB_ANSWER, SOURCES } from '../storyContent';

// Beat: Alex needs a couple of recent meta-analyses, not just training-data
// recall, so she flips on web search for this one branch. Citations bloom
// in and a Sources list slides open; each citation is keyboard-focusable
// and shows a hairline source card on hover/focus.
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
        label: 'Stress biomarkers: meta-evidence',
        kind: 'story',
        satellites: SOURCES.length,
      });
    }
  };

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
            Web search {on ? 'on' : 'off'}
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
                          <span className="wp-source-card-title">{SOURCES[i].title}</span>
                          <span className="wp-source-card-year">{SOURCES[i].year}</span>
                        </span>
                      )}
                    </sup>
                  )}{' '}
                </span>
              ))}
            </p>

            {on && (
              <div className="wp-sources-list wp-sources-list-in">
                <div className="wp-sources-label">Sources</div>
                <ol>
                  {SOURCES.map(s => (
                    <li key={s.n}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}, {s.year}</a>
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
