'use client';
import { useState } from 'react';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { GO_DEEPER_ANSWER } from '../storyContent';

// Approximate per-query cost multipliers vs. the cheapest tier, derived from
// apps/api/src/llm/models.ts MODEL_PRICING using the same assumed token
// profile as pricingConstants.ts. Cosmetic only — not wired to real billing.
const MODEL_GROUPS = [
  { group: 'Claude', options: [
    { value: 'haiku', label: 'Haiku', cost: 1, tier: 1 },
    { value: 'sonnet', label: 'Sonnet', cost: 3, tier: 2 },
    { value: 'opus', label: 'Opus', cost: 15, tier: 3 },
  ] },
  { group: 'Gemini', options: [
    { value: 'gemini-flash-lite', label: 'Flash Lite', cost: 0.1, tier: 1 },
    { value: 'gemini-flash', label: 'Flash', cost: 0.5, tier: 1 },
    { value: 'gemini-pro', label: 'Pro', cost: 1.9, tier: 2 },
  ] },
  { group: 'DeepSeek', options: [
    { value: 'deepseek-flash', label: 'Flash', cost: 0.1, tier: 1 },
    { value: 'deepseek-pro', label: 'Pro', cost: 0.8, tier: 1 },
  ] },
  { group: 'GLM', options: [
    { value: 'glm-air', label: 'Air', cost: 0.2, tier: 1 },
    { value: 'glm', label: '5.2', cost: 0.9, tier: 1 },
  ] },
];

const ALL_OPTIONS = MODEL_GROUPS.flatMap(g => g.options.map(o => ({ ...o, group: g.group })));
const MAX_COST = Math.max(...ALL_OPTIONS.map(o => o.cost));
// Log-scale meter width so the 0.1x–15x range stays legible.
function meterPct(cost: number) {
  const min = 0.1;
  const logMin = Math.log10(min);
  const logMax = Math.log10(MAX_COST);
  const logV = Math.log10(Math.max(min, cost));
  return Math.max(4, ((logV - logMin) / (logMax - logMin)) * 100);
}

// Beat: the branch that matters gets the sharper mind. Switching models
// visibly "focuses" the Go Deeper card and ticks the cost meter — she's
// paying per thought, not per month.
export function SceneModels() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const { addNode } = useStory();
  const [value, setValue] = useState('haiku');
  const [changed, setChanged] = useState(false);
  const selected = ALL_OPTIONS.find(o => o.value === value) ?? ALL_OPTIONS[0];

  const onChange = (v: string) => {
    setValue(v);
    if (!changed) {
      setChanged(true);
      addNode({ id: 'moderating-factors', parentId: 'root', label: 'Moderating factors', kind: 'story', ring: true });
    }
  };

  return (
    <section id="scene-models" data-time="1325" className="wp-scene wp-scene-models">
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">10:05 PM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">The right brain for the branch</h2>

        <div ref={ref} className={`wp-models-body ${inView ? 'wp-in-view' : ''}`}>
          <div className="wp-model-picker">
            <label className="wp-model-picker-label" htmlFor="wp-model-select">
              Model for this branch
            </label>
            <select
              id="wp-model-select"
              className="wp-model-select"
              value={value}
              onChange={e => onChange(e.target.value)}
            >
              {MODEL_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label} · {o.cost}×</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <div className="wp-meter">
              <div className="wp-meter-track">
                <div className="wp-meter-fill" style={{ width: `${meterPct(selected.cost)}%` }} />
              </div>
              <span className="wp-meter-label">×{selected.cost}</span>
            </div>
          </div>

          <div className="wp-branch-card wp-branch-card-show" data-model-tier={selected.tier}>
            <span className="wp-branch-kicker">GO DEEPER · MODERATING FACTORS · {selected.group.toUpperCase()} {selected.label.toUpperCase()}</span>
            <p className="wp-branch-body">{GO_DEEPER_ANSWER}</p>
          </div>
        </div>

        <p className="wp-compare-note wp-reveal">
          The branch that matters gets the sharper mind. She&rsquo;s paying per thought, not per
          month.
        </p>
      </div>
    </section>
  );
}
