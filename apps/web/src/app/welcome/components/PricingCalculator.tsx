'use client';
import { useMemo, useState } from 'react';
import { useInView } from './useInView';
import {
  ASSUMED_INPUT_TOKENS_PER_QUERY,
  ASSUMED_OUTPUT_TOKENS_PER_QUERY,
  SIGNUP_CREDIT_USD,
  TIER_LABELS,
  estimateQueryCostUsd,
  type PricingTier,
} from './pricingConstants';

const TIERS: PricingTier[] = ['haiku', 'sonnet', 'opus'];

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Beat: Alex used ~15 branches this week, mixed cheap and pricier models —
// would a flat $20/month have been worth it, or does pay-as-you-go win for
// someone whose usage is bursty around deadlines?
export function PricingCalculator() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [queriesPerMonth, setQueriesPerMonth] = useState(40);
  const [tier, setTier] = useState<PricingTier>('haiku');
  const [flatPrice, setFlatPrice] = useState(20);

  const { perQuery, monthly, savings, freeCovers } = useMemo(() => {
    const perQuery = estimateQueryCostUsd(tier);
    const monthly = perQuery * queriesPerMonth;
    return {
      perQuery,
      monthly,
      savings: flatPrice - monthly,
      freeCovers: Math.max(0, Math.floor(SIGNUP_CREDIT_USD / perQuery)),
    };
  }, [tier, queriesPerMonth, flatPrice]);

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Alex&rsquo;s other question</div>
        <h2 className="wp-h2">Don&rsquo;t pay a flat fee. Pay for what you use.</h2>
        <p className="wp-lede">
          She used about 15 branches that week, mixed cheap and pricier models. Would a flat
          monthly plan have been worth it — or is pay-as-you-go cheaper for usage that&rsquo;s
          bursty around deadlines? Try your own numbers below.
        </p>

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
              About <strong>${money(monthly)}/month</strong> with fork.ai&rsquo;s pay-as-you-go
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
      </div>
    </section>
  );
}
