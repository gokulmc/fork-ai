'use client';
import { useState } from 'react';
import { GitBranch } from '@/components/Icons';
import { HighlightAskAIMock } from './HighlightAskAIMock';
import { useInView } from './useInView';

// Beat: Alex asks her real question and gets a structured, sectioned answer.
export function BranchingDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [deeper, setDeeper] = useState(false);

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Alex asks a real question</div>
        <h2 className="wp-h2">One question, split into sections</h2>
        <p className="wp-lede">
          Not one long blob of text — an answer she can navigate, one thread at a time.
        </p>

        <div className="wp-demo-card">
          <div className="wp-demo-query">
            &ldquo;How does access to urban green space affect mental health outcomes?&rdquo;
          </div>

          <div className="wp-demo-section">
            <div className="wp-demo-section-heading">1 · Overview</div>
            <p>
              Across dozens of observational studies, access to urban green space is
              consistently associated with lower rates of depression, anxiety, and perceived
              stress — though effect sizes vary widely by city and how &ldquo;access&rdquo;
              itself is measured.
            </p>
          </div>

          <div className="wp-demo-section wp-demo-section-highlight">
            <div className="wp-demo-section-heading">2 · Moderating factors</div>
            <HighlightAskAIMock />
            <button type="button" className="wp-godeeper-btn" onClick={() => setDeeper(v => !v)}>
              <GitBranch size={13} /> Go Deeper
            </button>
            {deeper && (
              <div className="wp-branch-card wp-branch-card-in">
                <div className="wp-branch-card-kicker">Go Deeper · Moderating factors</div>
                <p>
                  Three matched-cohort studies isolate income as a moderator. All three find the
                  effect holds after controlling for baseline health — but only one tracks the
                  same residents over time, the strongest design for ruling out reverse causation.
                </p>
              </div>
            )}
          </div>

          <div className="wp-demo-section">
            <div className="wp-demo-section-heading">3 · Measurement challenges</div>
            <p>
              Studies disagree on whether &ldquo;access&rdquo; means walking distance, canopy
              cover from satellite imagery, or self-reported visit frequency — and the choice
              changes the measured effect size substantially.
            </p>
          </div>

          <div className="wp-demo-section">
            <div className="wp-demo-section-heading">4 · Open questions</div>
            <p>
              Causality is still contested: does green space improve mental health, or do
              mentally healthier people simply seek it out more? Few studies track the same
              residents over time to settle this.
            </p>
          </div>
        </div>

        <p className="wp-compare-note">
          One click, and &ldquo;moderating factors&rdquo; becomes its own node — with its own
          clean context, not a jumble of everything Alex&rsquo;s asked so far.
        </p>
      </div>
    </section>
  );
}
