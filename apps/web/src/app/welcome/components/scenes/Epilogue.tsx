'use client';
import { useMemo, useState } from 'react';
import { ChevronRight, ArrowRight } from '@/components/Icons';
import { CookiePreferencesLink } from '@/components/CookiePreferencesLink';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { RECEIPT_ITEMS, RECEIPT_TOTAL, SHARE_URL } from '../storyContent';
import {
  ASSUMED_INPUT_TOKENS_PER_QUERY,
  ASSUMED_OUTPUT_TOKENS_PER_QUERY,
  SIGNUP_CREDIT_USD,
  TIER_LABELS,
  estimateQueryCostUsd,
  type PricingTier,
} from '../pricingConstants';

const TIERS: PricingTier[] = ['haiku', 'sonnet', 'opus'];

const FAQ_ITEMS = [
  {
    q: 'Do I need to sign up?',
    a: 'No — your first session is free, up to 5 nodes, no account needed. Sign up later and any guest branches you made are automatically yours.',
  },
  {
    q: 'Is the pricing calculator exact?',
    a: 'No — it’s an estimate based on a typical multi-section answer. Actual cost depends on question complexity and which model you pick per branch.',
  },
  {
    q: 'What happens when my credit runs out?',
    a: 'You can top up any time. Nothing is lost — your session stays saved, you just can’t create new branches until you add credit.',
  },
  {
    q: 'Can I export to Notion?',
    a: 'Yes — a whole session pushes as a real Notion page, with a mind-map diagram at the top and every branch as a collapsible section underneath.',
  },
  {
    q: 'Which AI models does fork ai use?',
    a: 'Claude, Gemini, DeepSeek, and GLM — you pick the model for each branch. The first question always uses a fast default.',
  },
];

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatEstCost(n: number) {
  return n > 0 && n < 0.01 ? '<$0.01' : `$${money(n)}`;
}

export function Epilogue() {
  const { ref: receiptRef, inView: receiptInView } = useInView<HTMLDivElement>(0.4);
  const { ref: calcRef, inView: calcInView } = useInView<HTMLDivElement>(0.2);
  const { ref: faqRef, inView: faqInView } = useInView<HTMLDivElement>(0.2);
  const { visitorActions } = useStory();

  const [queriesPerMonth, setQueriesPerMonth] = useState(40);
  const [tier, setTier] = useState<PricingTier>('haiku');
  const [flatPrice, setFlatPrice] = useState(20);
  const [faqOpenIdx, setFaqOpenIdx] = useState<number | null>(0);

  const { monthly, savings, freeCovers } = useMemo(() => {
    const perQuery = estimateQueryCostUsd(tier);
    const monthly = perQuery * queriesPerMonth;
    return {
      monthly,
      savings: flatPrice - monthly,
      freeCovers: Math.max(0, Math.floor(SIGNUP_CREDIT_USD / perQuery)),
    };
  }, [tier, queriesPerMonth, flatPrice]);

  return (
    <section id="scene-epilogue" data-time="1935" className="wp-scene wp-scene-epilogue">
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">MON · 8:15 AM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">The bill</h2>

        <div className="wp-receipt-outer">
          <div ref={receiptRef} className={`wp-receipt ${receiptInView ? 'wp-receipt-play' : ''}`}>
            <div className="wp-perf wp-perf-top" />
            <div className="wp-r-title">FORK AI — SESSION RECEIPT</div>
            <div className="wp-r-sub">SUN 9:14 PM – 11:47 PM</div>

            {RECEIPT_ITEMS.map(([label, amount], i) => (
              <div className="wp-r-line" key={label} style={{ animationDelay: `${0.15 + i * 0.23}s` }}>
                <span>{label}</span>
                <span className="wp-r-dots" />
                <span>{amount}</span>
              </div>
            ))}

            <hr className="wp-r-rule" />
            <div className="wp-r-line wp-r-total" style={{ animationDelay: '1.3s' }}>
              <span>TOTAL</span>
              <span className="wp-r-dots" />
              <span>{RECEIPT_TOTAL}</span>
            </div>

            <p className="wp-r-note" style={{ animationDelay: '1.5s' }}>&ldquo;No subscription was harmed.&rdquo;</p>
            <p className="wp-r-footnote" style={{ animationDelay: '1.68s' }}>
              Illustrative estimate — actual cost varies with models and question complexity.
            </p>
            <div className="wp-perf wp-perf-bottom" />
          </div>

          {visitorActions.branches > 0 && (
            <div className={`wp-receipt wp-receipt-mini ${receiptInView ? 'wp-receipt-play' : ''}`}>
              <div className="wp-perf wp-perf-top" />
              <div className="wp-r-title">YOUR SESSION — WHILE READING THIS PAGE</div>
              <div className="wp-r-line" style={{ animationDelay: '1.9s' }}>
                <span>{visitorActions.branches}× branches (Haiku)</span>
                <span className="wp-r-dots" />
                <span>{formatEstCost(visitorActions.estCostUsd)}</span>
              </div>
              <p className="wp-r-note" style={{ animationDelay: '2.1s' }}>Real branches. They&rsquo;d cost about that.</p>
              <div className="wp-perf wp-perf-bottom" />
            </div>
          )}
        </div>

        <div ref={calcRef} className={`wp-calc-section ${calcInView ? 'wp-in-view' : ''}`}>
          <h3 className="wp-h3">Price your own nights</h3>
          <div className="wp-calc">
            <div className="wp-calc-row">
              <label className="wp-calc-label" htmlFor="wp-calc-queries">
                Questions per month <span className="wp-calc-value">{queriesPerMonth}</span>
              </label>
              <input
                id="wp-calc-queries"
                type="range"
                min={1}
                max={200}
                value={queriesPerMonth}
                onChange={e => setQueriesPerMonth(Number(e.target.value))}
                className="wp-calc-slider"
              />
            </div>

            <div className="wp-calc-row">
              <span className="wp-calc-label">Typical model tier</span>
              <div className="wp-calc-segmented" role="group" aria-label="Model tier">
                {TIERS.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`wp-calc-seg-btn ${tier === t ? 'wp-calc-seg-active' : ''}`}
                    onClick={() => setTier(t)}
                  >
                    {TIER_LABELS[t].label}
                  </button>
                ))}
              </div>
              <div className="wp-calc-hint">
                {TIER_LABELS[tier].sub} — Gemini, DeepSeek, and GLM are typically cheaper still.
              </div>
            </div>

            <div className="wp-calc-row">
              <label className="wp-calc-label" htmlFor="wp-calc-flat">
                What a flat monthly AI subscription costs you
              </label>
              <div className="wp-calc-flat-input">
                <span>$</span>
                <input
                  id="wp-calc-flat"
                  type="number"
                  min={0}
                  step={1}
                  value={flatPrice}
                  onChange={e => setFlatPrice(Math.max(0, Number(e.target.value)))}
                />
                <span>/month</span>
              </div>
              <div className="wp-calc-hint">
                $20 is just a common flat-fee reference point for illustration — edit it to match
                whatever you&rsquo;re comparing against.
              </div>
            </div>

            <div className="wp-calc-result">
              <div className="wp-calc-result-main">
                About <strong>${money(monthly)}/month</strong> with fork ai&rsquo;s pay-as-you-go
                credit, at {queriesPerMonth} questions/month on the {TIER_LABELS[tier].label.toLowerCase()} tier.
              </div>
              {savings > 0 ? (
                <div className="wp-calc-result-savings wp-calc-win">
                  That&rsquo;s about <strong>${money(savings)} less</strong> than a flat ${money(flatPrice)}/month plan.
                </div>
              ) : (
                <div className="wp-calc-result-savings wp-calc-even">
                  At this volume, a flat ${money(flatPrice)}/month plan would cost about the same
                  or less — pay-as-you-go tends to win for lighter or bursty usage, not constant
                  heavy use.
                </div>
              )}
              <div className="wp-calc-result-aside">
                Your free ${money(SIGNUP_CREDIT_USD)} signup credit covers about{' '}
                <strong>{freeCovers} question{freeCovers === 1 ? '' : 's'}</strong> at this tier
                before you&rsquo;d need to add credit.
              </div>
            </div>

            <p className="wp-calc-disclaimer">
              Estimate based on a typical multi-section answer (~{ASSUMED_INPUT_TOKENS_PER_QUERY.toLocaleString()}{' '}
              input / ~{ASSUMED_OUTPUT_TOKENS_PER_QUERY.toLocaleString()} output tokens) — your
              mileage will vary with question complexity and model choice. Not a guarantee.
            </p>
          </div>

          <div className="wp-vignettes">
            <div className="wp-vignette-row">11:59 PM — problem set due, three branches, $0.06</div>
            <div className="wp-vignette-row">A Tuesday — literature review, forty branches across a week, $1.80</div>
            <div className="wp-vignette-row">Always — research that lands in Notion, not in a transcript you&rsquo;ll never reopen.</div>
          </div>
        </div>

        <div ref={faqRef} className={`wp-faq-wrap ${faqInView ? 'wp-in-view' : ''}`}>
          <details className="wp-fine-print">
            <summary>Fine print</summary>
            <div className="wp-faq">
              {FAQ_ITEMS.map((item, i) => (
                <div key={item.q} className="wp-faq-item">
                  <button
                    type="button"
                    className="wp-faq-q"
                    onClick={() => setFaqOpenIdx(v => (v === i ? null : i))}
                    aria-expanded={faqOpenIdx === i}
                  >
                    <ChevronRight size={14} className={faqOpenIdx === i ? 'wp-chevron-open' : ''} />
                    {item.q}
                  </button>
                  {faqOpenIdx === i && <p className="wp-faq-a">{item.a}</p>}
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="wp-proved">
          <div className="wp-proved-title">WHAT THE NIGHT PROVED</div>
          <div className="wp-proved-row">№1 — A research flow you can&rsquo;t get lost in. Sections, not scroll.</div>
          <div className="wp-proved-row">№2 — Each branch carries only its own thread. Cleaner context in, sharper answers out.</div>
          <div className="wp-proved-row">№3 — The structure is the interaction: highlight → branch → node.</div>
          <div className="wp-proved-row">№4 — It ends as notes in Notion, not a transcript you&rsquo;ll never reopen.</div>
          <div className="wp-proved-row">№5 — The Mixer: combine ideas → arrive at the answer.</div>
        </div>

        <div className="wp-cta-block">
          <div className="wp-cta-serif wp-reveal">It&rsquo;s 9 PM somewhere.</div>
          <a className="wp-cta-pill" href="/">Try fork ai free</a>
          <div className="wp-cta-tagline">Ask once. Branch forever.</div>
          <div className="wp-cta-mono">No signup needed for a first session</div>
          {SHARE_URL && (
            <div className="wp-cta-secondary">
              <a href={SHARE_URL} className="wp-cta-secondary-link">
                or open Alex&rsquo;s actual map <ArrowRight size={12} />
              </a>
            </div>
          )}
          <div className="wp-footer-links">
            <a href="/blog">Blog</a>
            <span className="wp-footer-sep">·</span>
            <a href="/privacy-policy">Privacy</a>
            <span className="wp-footer-sep">·</span>
            <a href="/terms">Terms</a>
            <span className="wp-footer-sep">·</span>
            <CookiePreferencesLink />
          </div>
        </div>

        <div className="wp-foot-space" />
      </div>
    </section>
  );
}
