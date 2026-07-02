'use client';
import { useState } from 'react';
import { useInView } from './useInView';

// Approximate per-query cost multipliers vs. the cheapest tier, derived from
// apps/api/src/llm/models.ts MODEL_PRICING using the same assumed token
// profile as pricingConstants.ts. Cosmetic only — not wired to real billing.
const MODEL_GROUPS = [
  { group: 'Claude', options: [
    { value: 'haiku', label: 'Haiku', cost: 1 },
    { value: 'sonnet', label: 'Sonnet', cost: 3 },
    { value: 'opus', label: 'Opus', cost: 15 },
  ] },
  { group: 'Gemini', options: [
    { value: 'gemini-flash-lite', label: 'Flash Lite', cost: 0.1 },
    { value: 'gemini-flash', label: 'Flash', cost: 0.5 },
    { value: 'gemini-pro', label: 'Pro', cost: 1.9 },
  ] },
  { group: 'DeepSeek', options: [
    { value: 'deepseek-flash', label: 'Flash', cost: 0.1 },
    { value: 'deepseek-pro', label: 'Pro', cost: 0.8 },
  ] },
  { group: 'GLM', options: [
    { value: 'glm-air', label: 'Air', cost: 0.2 },
    { value: 'glm', label: '5.2', cost: 0.9 },
  ] },
];

const ALL_OPTIONS = MODEL_GROUPS.flatMap(g => g.options.map(o => ({ ...o, group: g.group })));

// Beat: for the moderating-factors branch Alex wants something sharper; a
// quick side-question stays on the cheap default — she pays per branch.
export function ModelPickerDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [value, setValue] = useState('haiku');
  const selected = ALL_OPTIONS.find(o => o.value === value) ?? ALL_OPTIONS[0];

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Alex&rsquo;s next move</div>
        <h2 className="wp-h2">Pick a model per branch</h2>
        <p className="wp-lede">
          The moderating-factors branch matters for her defense, so she wants something
          sharper. A quick side-question stays on the cheap default — she&rsquo;s paying per
          branch, not per session.
        </p>
        <div className="wp-model-demo">
          <select
            className="wp-model-select"
            value={value}
            onChange={e => setValue(e.target.value)}
            aria-label="Pick a model for this branch"
          >
            {MODEL_GROUPS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label} · {o.cost}×</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="wp-model-card">
            <div className="wp-model-card-pill">✳ {selected.group} {selected.label}</div>
            <div className="wp-model-card-cost">~{selected.cost}× the cost of the cheapest tier</div>
          </div>
        </div>
        <p className="wp-compare-note">
          The first question always uses a fast default model — you choose the model for what
          you branch into.
        </p>
      </div>
    </section>
  );
}
