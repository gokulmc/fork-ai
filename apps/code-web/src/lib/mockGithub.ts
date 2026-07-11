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
  desc: string;
}

// Ids must match ALLOWED_PLUGINS in apps/code-api/src/projects/dto/create-project.dto.ts.
export const PLUGINS: Plugin[] = [
  {
    id: 'mem-palace',
    name: 'Mem Palace',
    desc: "Mine this project's history into a searchable memory palace as code nodes land.",
  },
  {
    id: 'graphify',
    name: 'Graphify',
    desc: 'Build a structural AST index of the repo before the agent starts searching.',
  },
  {
    id: 'playwright-testing',
    name: 'Playwright testing',
    desc: 'Run a headless browser check after each code node that touches the frontend.',
  },
];
