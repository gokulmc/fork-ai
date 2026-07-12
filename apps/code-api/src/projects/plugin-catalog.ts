// Curated catalog of Skills and Harnesses a Project can enable. Pure data + pure
// functions — no NestJS DI — so it can be imported from both the DTO (validation
// allowlist) and services (deterministic init.md assembly, prompt rendering)
// without pulling in a module graph.

export type PluginCategory = 'skill' | 'harness';

export interface PluginEntry {
  id: string;
  name: string;
  icon: string;
  category: PluginCategory;
  desc: string;
  instruction: string;
}

// 9 Skills (always-on behaviours) then 13 Harnesses (multi-step working loops).
export const PLUGIN_CATALOG: PluginEntry[] = [
  { id: 'caveman', name: 'Caveman', icon: '🗿', category: 'skill', desc: 'Ultra-terse output mode — cuts filler, keeps technical substance', instruction: 'Respond tersely: drop filler, articles, and pleasantries while keeping full technical accuracy.' },
  { id: 'graphify', name: 'Graphify', icon: '🕸️', category: 'skill', desc: 'Structural AST index of the repo — classes, functions, call graph', instruction: 'Before searching the codebase, build or refresh the structural index and query it instead of grepping blindly.' },
  { id: 'mem-palace', name: 'Mem Palace', icon: '🏛️', category: 'skill', desc: 'Mines project history into a searchable memory palace', instruction: 'After each meaningful change, store a memory entry; consult the palace before re-deriving past decisions.' },
  { id: 'karpathy-guidelines', name: 'Karpathy Guidelines', icon: '📏', category: 'skill', desc: 'Guardrails against common LLM coding mistakes', instruction: 'Keep changes surgical, avoid speculative abstraction, surface assumptions, and define verifiable success criteria before coding.' },
  { id: 'handoff', name: 'Handoff', icon: '🤝', category: 'skill', desc: 'Compacts session state into a handoff document', instruction: 'When a task spans sessions, write a handoff summary of state, decisions, and next steps before stopping.' },
  { id: 'zoom-out', name: 'Zoom Out', icon: '🔭', category: 'skill', desc: 'Periodic architecture-level reassessment', instruction: 'Every few steps, zoom out: restate the goal, check the approach still fits the architecture, and correct drift.' },
  { id: 'status', name: 'Status', icon: '📊', category: 'skill', desc: 'Running progress ledger any agent can resume from', instruction: 'Maintain a running status of what is done, in progress, and blocked, so any agent can resume mid-task.' },
  { id: 'adr', name: 'ADR', icon: '📜', category: 'skill', desc: 'Short architecture decision records before implementing', instruction: 'Record each architectural decision as a short ADR — context, decision, consequences — before implementing it.' },
  { id: 'issue-log', name: 'Issue Log', icon: '🐛', category: 'skill', desc: 'Symptom/Cause/Fix log for every bug fix', instruction: 'Log every bug fix as Symptom / Cause / Fix in an issues.md entry in the same commit, so regressions are recognisable later.' },
  { id: 'tdd', name: 'TDD', icon: '🔴', category: 'harness', desc: 'Red-green-refactor loop for every feature and fix', instruction: 'For each feature or fix: write a failing test first, make it pass minimally, then refactor.' },
  { id: 'diagnose', name: 'Diagnose', icon: '🩺', category: 'harness', desc: 'Disciplined debugging loop for hard bugs', instruction: 'For bugs: reproduce, minimise, hypothesise, instrument, fix, then add a regression test — never patch blind.' },
  { id: 'grill-me', name: 'Grill Me', icon: '🔥', category: 'harness', desc: 'Adversarial plan interrogation before building', instruction: 'Before implementing a plan, interrogate its assumptions and edge cases until every open branch is resolved.' },
  { id: 'prototype', name: 'Prototype', icon: '🧪', category: 'harness', desc: 'Throwaway prototypes to de-risk designs', instruction: 'For risky designs, build a throwaway prototype to answer the open question, then discard it and implement clean.' },
  { id: 'playwright-testing', name: 'Playwright Testing', icon: '🎭', category: 'harness', desc: 'Headless browser checks after frontend changes', instruction: 'After each change that touches the frontend, run a headless Playwright check on the affected flow.' },
  { id: 'ship', name: 'Ship', icon: '🚀', category: 'harness', desc: 'Commit → push → PR → merge in one pass', instruction: 'When a change is verified, commit it with a focused message, push a feature branch, open a PR, and merge.' },
  { id: 'deep-research', name: 'Deep Research', icon: '📚', category: 'harness', desc: 'Multi-source research with adversarial verification', instruction: 'For open technical questions, gather multiple sources, cross-verify claims, and cite them before deciding.' },
  { id: 'code-review', name: 'Code Review', icon: '🔎', category: 'harness', desc: 'Self-review pass on every diff', instruction: 'Before finishing any change, review the full diff for correctness bugs and simplifications, and fix what you find.' },
  { id: 'verify', name: 'Verify', icon: '✅', category: 'harness', desc: 'End-to-end check of the changed flow before calling it done', instruction: 'Before declaring a change done, run the app and exercise the affected flow — observe real behavior, not just passing tests.' },
  { id: 'cascade', name: 'Cascade', icon: '♻️', category: 'harness', desc: 'Recovery discipline — revert after two failed fixes', instruction: 'After two failed fix attempts, stop, revert to the last working state without shame, and rethink the approach.' },
  { id: 'security-review', name: 'Security Review', icon: '🛡️', category: 'harness', desc: 'Security pass on auth, input, and secret changes', instruction: 'Review every change touching auth, input handling, or secrets for injection, authz gaps, and leaked credentials before merging.' },
  { id: 'simplify', name: 'Simplify', icon: '📝', category: 'harness', desc: 'Reuse and simplification sweep after features land', instruction: 'After a feature lands, sweep the diff for duplication, dead abstraction, and simpler equivalents, and apply them.' },
  { id: 'benchmark', name: 'Benchmark', icon: '⏱️', category: 'harness', desc: 'Measure before/after for performance changes', instruction: 'For any performance-motivated change, measure before and after with the same workload, and keep the numbers with the change.' },
];

export const ALLOWED_PLUGINS: string[] = PLUGIN_CATALOG.map((p) => p.id);

export const INIT_SECTION_HEADING = 'init.md';

// `<icon> <name> — <instruction>` for a known id; the raw id is the fallback for
// an id that's since been dropped from the catalog (an old Project may still
// reference it), so rendering never throws on stale data.
export function pluginLine(id: string): string {
  const entry = PLUGIN_CATALOG.find((p) => p.id === id);
  return entry ? `${entry.icon} ${entry.name} — ${entry.instruction}` : id;
}

// Deterministic, LLM-free init.md seed for a from-scratch project's fill-root
// answer — assembled purely from the project's selected plugins. Returns null
// when nothing selected (or every id is unknown) so the caller can skip the
// section entirely rather than emit an empty one.
export function buildInitMd(pluginIds: string[], targetFile: string, repoLabel: string): string | null {
  // Filter+order against the catalog (not the input) so the rendered file always
  // lists Skills before Harnesses regardless of the order the client sent.
  const selected = PLUGIN_CATALOG.filter((p) => pluginIds.includes(p.id));
  if (!selected.length) return null;

  const skills = selected.filter((p) => p.category === 'skill');
  const harnesses = selected.filter((p) => p.category === 'harness');

  const lines: string[] = [
    '# init.md',
    '',
    `Agent bootstrap for ${repoLabel}. This file defines the Skills and Harnesses enabled for this project.`,
  ];
  if (skills.length) {
    lines.push('', '## Skills — always-on behaviours', '');
    for (const p of skills) lines.push(`- ${pluginLine(p.id)}`);
  }
  if (harnesses.length) {
    lines.push('', '## Harnesses — multi-step working loops', '');
    for (const p of harnesses) lines.push(`- ${pluginLine(p.id)}`);
  }
  lines.push(
    '',
    '## Setup',
    '',
    `Create ${targetFile} at the repo root and copy the Skills and Harnesses rules above into it verbatim, so every future agent session loads them. Then keep ${targetFile} current as the project's conventions evolve.`,
  );

  return `Deterministic project setup — assembled from your selected plugins, not generated by the model.\n\n\`\`\`markdown\n${lines.join('\n')}\n\`\`\``;
}
