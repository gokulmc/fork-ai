'use client';
import { useState } from 'react';
import { useInView } from './useInView';

// Beat: Alex needs a couple of recent meta-analyses, not just training-data
// recall, so she flips on web search for this one branch.
export function WebSearchDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [on, setOn] = useState(false);

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">One more branch</div>
        <h2 className="wp-h2">Optional web search, with real sources</h2>
        <p className="wp-lede">
          Recent papers, not just what the model already knew — flip it on per branch.
        </p>
        <div className="wp-websearch-demo">
          <label className="wp-toggle">
            <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
            <span className="wp-toggle-track"><span className="wp-toggle-thumb" /></span>
            Web search {on ? 'on' : 'off'}
          </label>
          <div className="wp-demo-card wp-demo-card-compact">
            <p>
              Recent meta-analyses continue to support a moderate association between green
              space access and reduced depressive symptoms
              {on ? <sup className="wp-cite">[1]</sup> : null}, with socioeconomic status as a
              consistent moderator{on ? <sup className="wp-cite">[2]</sup> : null}.
            </p>
            {on && (
              <div className="wp-sources wp-branch-card-in">
                <div className="wp-sources-label">Sources</div>
                <ol className="wp-sources-list">
                  <li>Journal of Environmental Psychology, 2024</li>
                  <li>Social Science &amp; Medicine, 2024</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
