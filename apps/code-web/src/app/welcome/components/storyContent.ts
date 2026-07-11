// Capture-swap module: chunk 3 replaces these constants with content
// transcribed verbatim from a real shared fork ai session (see
// /welcome capture — "Green Space & Mental Health", session
// 01KWGVTYFRZ8502R7PTM52PTMP). Keep shapes stable.

export const ROOT_QUERY = 'How does access to urban green space affect mental health outcomes?';

export interface StorySection {
  num: string;
  heading: string;
  body: string;
}

export const SECTIONS: StorySection[] = [
  {
    num: '1',
    heading: 'Stress Reduction & Restoration',
    body: 'Urban green spaces play a crucial role in stress reduction, acting as restorative environments. Exposure to natural settings, even within cities, can lower physiological markers of stress such as cortisol levels and heart rate. This restorative effect is often attributed to the ‘Attention Restoration Theory’ (ART)…',
  },
  {
    num: '2',
    heading: 'Mood Improvement & Reduced Depression',
    body: 'Access to urban green space is consistently associated with improved mood and a decreased risk of depression. Studies frequently show that individuals with greater proximity to or more frequent use of green areas report lower rates of depressive symptoms and higher levels of self-reported happiness…',
  },
  {
    num: '3',
    heading: 'Cognitive Benefits & Attention Restoration',
    body: 'Beyond emotional benefits, urban green spaces contribute significantly to cognitive health, particularly in attention restoration. The concept of ‘soft fascination’ in natural environments helps to restore depleted directed attention, which is often overtaxed by demanding urban stimuli…',
  },
  {
    num: '4',
    heading: 'Social Cohesion & Community Well-being',
    body: 'Urban green spaces serve as vital hubs for social interaction, fostering community cohesion and reducing feelings of loneliness and isolation. Parks, community gardens, and plazas provide neutral, accessible settings where people can gather, engage in shared activities, and build social networks…',
  },
  {
    num: '5',
    heading: 'Mitigation of Urban Stressors',
    body: 'Green spaces act as buffers against several urban stressors that negatively impact mental health. They help mitigate noise pollution, a known irritant that can increase stress and anxiety. Trees and vegetation absorb sound, creating quieter environments conducive to relaxation…',
  },
];

// The real highlighted sentence from the "Mood Improvement & Reduced
// Depression" section — this is what Alex selects and branches "Ask AI" on.
export const FORK_PASSAGE =
  'Studies frequently show that individuals with greater proximity to or more frequent use of green areas report lower rates of depressive symptoms and higher levels of self-reported happiness.';

// Condensed from the real ASK branch "Strongest Green Space Depression
// Citation" (nodeId 01KWGVYPRMXG31ZB1B80DZQYHX) — names White et al. 2013.
export const ASK_AI_ANSWER =
  'The strongest citation is White, Alcock, Wheeler & Depledge (2013, Psychological Science) — a fixed-effects analysis of the British Household Panel Survey, tracking ~10,000 households over time. Because it follows the same people as they move to greener or less-green neighborhoods, its panel design controls for the obvious confounder — that happier people simply choose greener neighborhoods — far better than a cross-sectional study could.';

// Condensed from the real DEEPER branch "Green Space & Depression Relief"
// (nodeId 01KWGVXS1XMB1S1PS7V77GPMWC) — keeps the equity/socioeconomic material.
export const GO_DEEPER_ANSWER =
  'A landmark 2019 meta-analysis of 1.2 million participants found that living within 300 meters of green space cut depression incidence by 12–16%, an effect that held even after controlling for income, physical health, and baseline mental health status. Green environments reduce cortisol and raise BDNF, promoting the hippocampal neuroplasticity that’s consistently reduced in clinical depression. But the benefit is not evenly distributed: lower-income and minority communities face a "green gap" — fewer parks, lower-quality vegetation, less perceived safety — so the antidepressant potential of green space is often least accessible to the populations at highest depression risk. Urban planners increasingly treat green infrastructure as a public health intervention, not just an aesthetic one.';

// Condensed from the real webSearch=true ASK branch "Green Space Stress
// Biomarkers: Meta-Evidence" (nodeId 01KWGW05YFF08X490BFVV8ES01).
export const WEB_ANSWER =
  'A January 2025 meta-analysis of 78 studies found nature exposure cut salivary cortisol by 21%, with the largest effect at 20–30 minutes of exposure. Heart-rate and autonomic findings are even more consistent — pooled RCT evidence shows an effect size of −0.60 on heart rate, and a 2025 review of children and youth reinforces the same shift toward parasympathetic dominance. But a July 2024 evidence-grading overview found no pooled association with cortisol specifically — a reminder that "confirmed" findings can still be contested at the effect-size level, even as mood and heart-rate effects hold up.';

export const MIX_QUESTION =
  "Pull this together — what's the defensible argument, and what's missing?";

// Rewritten grounded in the real content: claim + equity moderator +
// strongest evidence (longitudinal cohort work, White et al.) + what's open.
export const MIX_ANSWER =
  'The defensible claim: proximity to green space measurably improves mood and lowers depression risk, and the physiological pathway (lower cortisol, better heart-rate variability) is broadly consistent across recent meta-analyses. The strongest single-study support is White et al. (2013, Psychological Science) — its fixed-effects panel design tracks the same ~10,000 households over time, which rules out the obvious "happier people just move to greener areas" objection better than any cross-sectional study could. At population scale, a 2019 meta-analysis of 1.2 million participants found a 12–16% reduction in depression incidence within 300 meters of green space. The open gap is equity: lower-income and minority neighborhoods face a persistent "green gap" in access, so the benefit is least available exactly where depression risk runs highest. And even the physiology is still contested — 2024–2025 meta-analyses disagree on whether cortisol itself moves at the pooled level, even as heart-rate and mood effects hold up. That is the line to open the chapter with: causal design first, equity gap flagged as unresolved.';

export interface StorySource {
  n: number;
  title: string;
  year: string;
  url: string;
}

// Top 3 real sources from the web branch's `sources` array (verbatim URLs).
export const SOURCES: StorySource[] = [
  {
    n: 1,
    title: 'Nature exposure dose & mental illness outcomes — systematic review & meta-analysis',
    year: '2025',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11851813/',
  },
  {
    n: 2,
    title: 'Restorative effects of green exposure — meta-analysis of randomized control trials',
    year: '2022',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9658851/',
  },
  {
    n: 3,
    title: 'Nature exposure & the nervous system in children and youth — systematic review',
    year: '2025',
    url: 'https://www.sciencedirect.com/science/article/pii/S0272494425002713',
  },
];

// When non-null, the epilogue renders the live "open Alex's actual map ↗"
// link; when null it's omitted (fallback CTA only).
export const SHARE_URL: string | null = 'https://forkai.in/?sk=GfOPbyzL_s7Gr9sVqfUIYLOnno-gf4gzArRaFUIJGZg';

export const RECEIPT_ITEMS: [string, string][] = [
  ['1× root question', '$0.02'],
  ['2× branches (Sonnet)', '$0.14'],
  ['1× branch + web search', '$0.07'],
  ['1× advisor branch (guest)', '$0.02'],
  ['1× synthesis (Mixer)', '$0.03'],
];

export const RECEIPT_TOTAL = '$0.34';

// Card metadata for the BigMap/Constellation mind-map renderers. Keyed by the
// story node id (see StoryContext addNode call sites) — nodes not listed here
// (visitor highlights, unknown ids) fall back to their own `label` at render
// time in BigMap/Constellation.
export const NODE_META: Record<string, { emoji?: string; title: string; kicker: string }> = {
  root: { emoji: '🌳', title: 'Urban Green Space & Mental Health', kicker: 'ROOT' },
  'moderating-factors': { title: 'Green Space & Depression Relief', kicker: 'GO DEEPER' },
  'web-branch': { title: 'Meta-evidence · 2024–25', kicker: 'ASK AI · WEB' },
  mix: { title: 'Synthesis', kicker: 'MIX' },
  advisor: { title: 'Advisor · 8:32 AM', kicker: 'GUEST' },
};
