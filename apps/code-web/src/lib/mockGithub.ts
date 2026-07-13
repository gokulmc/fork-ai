import type { RepoRef } from './api';

// Fixture repos for the project creation picker — forkai-code has no real GitHub
// integration yet (mock-first per ADR-0001), so these stand in for "search your repos".
export interface MockRepo extends RepoRef {
  description: string;
}

export const MOCK_REPOS: MockRepo[] = [
  {
    provider: 'github-mock',
    owner: 'acme-labs',
    repo: 'billing-service',
    defaultBranch: 'main',
    url: 'https://github.com/acme-labs/billing-service',
    description: 'Next.js 15 SaaS billing dashboard with subscriptions and usage metering.',
  },
  {
    provider: 'github-mock',
    owner: 'acme-labs',
    repo: 'inventory-api',
    defaultBranch: 'main',
    url: 'https://github.com/acme-labs/inventory-api',
    description: 'FastAPI service for warehouse inventory and order fulfillment.',
  },
  {
    provider: 'github-mock',
    owner: 'gokulmc',
    repo: 'internal-cli',
    defaultBranch: 'main',
    url: 'https://github.com/gokulmc/internal-cli',
    description: 'Go CLI for provisioning and tearing down internal dev environments.',
  },
  {
    provider: 'github-mock',
    owner: 'acme-labs',
    repo: 'fieldops-mobile',
    defaultBranch: 'main',
    url: 'https://github.com/acme-labs/fieldops-mobile',
    description: 'React Native app for field technicians logging on-site service visits.',
  },
  {
    provider: 'github-mock',
    owner: 'forkai',
    repo: 'docs-site',
    defaultBranch: 'main',
    url: 'https://github.com/forkai/docs-site',
    description: 'Docusaurus documentation site for the forkai-code product.',
  },
  {
    provider: 'github-mock',
    owner: 'acme-labs',
    repo: 'events-pipeline',
    defaultBranch: 'main',
    url: 'https://github.com/acme-labs/events-pipeline',
    description: 'Airflow + dbt pipeline aggregating product analytics events nightly.',
  },
];

export interface Plugin {
  id: string;
  name: string;
  icon: string;
  desc: string;
  category: 'skill' | 'harness';
}

// Ids must match the catalog in apps/code-api/src/projects/plugin-catalog.ts.
export const PLUGINS: Plugin[] = [
  { id: 'caveman', name: 'Caveman', icon: '🗿', category: 'skill', desc: 'Ultra-terse output mode — cuts filler, keeps technical substance' },
  { id: 'graphify', name: 'Graphify', icon: '🕸️', category: 'skill', desc: 'Structural AST index of the repo — classes, functions, call graph' },
  { id: 'mem-palace', name: 'Mem Palace', icon: '🏛️', category: 'skill', desc: 'Mines project history into a searchable memory palace' },
  { id: 'karpathy-guidelines', name: 'Karpathy Guidelines', icon: '📏', category: 'skill', desc: 'Guardrails against common LLM coding mistakes' },
  { id: 'handoff', name: 'Handoff', icon: '🤝', category: 'skill', desc: 'Compacts session state into a handoff document' },
  { id: 'zoom-out', name: 'Zoom Out', icon: '🔭', category: 'skill', desc: 'Periodic architecture-level reassessment' },
  { id: 'status', name: 'Status', icon: '📊', category: 'skill', desc: 'Running progress ledger any agent can resume from' },
  { id: 'adr', name: 'ADR', icon: '📜', category: 'skill', desc: 'Short architecture decision records before implementing' },
  { id: 'issue-log', name: 'Issue Log', icon: '🐛', category: 'skill', desc: 'Symptom/Cause/Fix log for every bug fix' },
  { id: 'tdd', name: 'TDD', icon: '🔴', category: 'harness', desc: 'Red-green-refactor loop for every feature and fix' },
  { id: 'diagnose', name: 'Diagnose', icon: '🩺', category: 'harness', desc: 'Disciplined debugging loop for hard bugs' },
  { id: 'grill-me', name: 'Grill Me', icon: '🔥', category: 'harness', desc: 'Adversarial plan interrogation before building' },
  { id: 'prototype', name: 'Prototype', icon: '🧪', category: 'harness', desc: 'Throwaway prototypes to de-risk designs' },
  { id: 'playwright-testing', name: 'Playwright Testing', icon: '🎭', category: 'harness', desc: 'Headless browser checks after frontend changes' },
  { id: 'ship', name: 'Ship', icon: '🚀', category: 'harness', desc: 'Commit → push → PR → merge in one pass' },
  { id: 'deep-research', name: 'Deep Research', icon: '📚', category: 'harness', desc: 'Multi-source research with adversarial verification' },
  { id: 'code-review', name: 'Code Review', icon: '🔎', category: 'harness', desc: 'Self-review pass on every diff' },
  { id: 'verify', name: 'Verify', icon: '✅', category: 'harness', desc: 'End-to-end check of the changed flow before calling it done' },
  { id: 'cascade', name: 'Cascade', icon: '♻️', category: 'harness', desc: 'Recovery discipline — revert after two failed fixes' },
  { id: 'security-review', name: 'Security Review', icon: '🛡️', category: 'harness', desc: 'Security pass on auth, input, and secret changes' },
  { id: 'simplify', name: 'Simplify', icon: '📝', category: 'harness', desc: 'Reuse and simplification sweep after features land' },
  { id: 'benchmark', name: 'Benchmark', icon: '⏱️', category: 'harness', desc: 'Measure before/after for performance changes' },
];

export const SKILL_PLUGINS = PLUGINS.filter(p => p.category === 'skill');
export const HARNESS_PLUGINS = PLUGINS.filter(p => p.category === 'harness');
