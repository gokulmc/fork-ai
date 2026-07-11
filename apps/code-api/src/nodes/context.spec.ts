import { findRailChain, planDocOf, codeSummaryOf, codeContextBlockOf } from './context';
import type { NodeItem } from '@/dynamo/dynamo.interfaces';

function node(overrides: Partial<NodeItem> & Pick<NodeItem, 'nodeId' | 'kind'>): NodeItem {
  return {
    PK: `SESSION#sess`,
    SK: `NODE#${overrides.nodeId}`,
    parentId: null,
    title: overrides.nodeId,
    emoji: null,
    query: overrides.nodeId,
    lede: '',
    sections: [],
    fromSection: null,
    fromText: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findRailChain', () => {
  it('walks CODE→CODE→PLAN and stops at PLAN, collecting codeAncestors nearest-first', () => {
    const plan = node({ nodeId: 'plan', kind: 'PLAN', parentId: null, sections: [{ id: 's', heading: 'Goal', body: 'Ship it' }] });
    const code1 = node({ nodeId: 'code1', kind: 'CODE', parentId: 'plan' });
    const code2 = node({ nodeId: 'code2', kind: 'CODE', parentId: 'code1' });
    const nodeById = new Map([plan, code1, code2].map((n) => [n.nodeId, n]));

    const chain = findRailChain(nodeById, 'code2');
    expect(chain.codeAncestors.map((n) => n.nodeId)).toEqual(['code2', 'code1']);
    expect(chain.planNode?.nodeId).toBe('plan');
    expect(chain.branchNode).toBeNull();
  });

  it('walks CODE→BRANCH and stops at BRANCH, never reaching whatever is above it', () => {
    const codeBeforeBranch = node({ nodeId: 'code0', kind: 'CODE', parentId: null });
    const branch = node({ nodeId: 'branch1', kind: 'BRANCH', parentId: 'code0', branchName: 'feature/x' });
    const code1 = node({ nodeId: 'code1', kind: 'CODE', parentId: 'branch1' });
    const nodeById = new Map([codeBeforeBranch, branch, code1].map((n) => [n.nodeId, n]));

    const chain = findRailChain(nodeById, 'code1');
    expect(chain.branchNode?.nodeId).toBe('branch1');
    expect(chain.branchNode?.branchName).toBe('feature/x');
    expect(chain.codeAncestors.map((n) => n.nodeId)).toEqual(['code1']);
    expect(chain.planNode).toBeNull();
  });

  it('starts inclusively at fromNodeId — a BRANCH or PLAN parent itself is recognised, not just an ancestor', () => {
    const plan = node({ nodeId: 'plan', kind: 'PLAN', sections: [] });
    const nodeById = new Map([[plan.nodeId, plan]]);
    const chain = findRailChain(nodeById, 'plan');
    expect(chain.planNode?.nodeId).toBe('plan');
    expect(chain.codeAncestors).toEqual([]);
  });

  it('returns an empty chain when fromNodeId is missing from the map', () => {
    const chain = findRailChain(new Map(), 'missing');
    expect(chain.ancestors).toEqual([]);
    expect(chain.planNode).toBeNull();
    expect(chain.branchNode).toBeNull();
    expect(chain.codeAncestors).toEqual([]);
  });
});

describe('planDocOf', () => {
  it('joins all sections as full heading/body markdown with no cap', () => {
    const plan = node({
      nodeId: 'plan', kind: 'PLAN',
      sections: [
        { id: 's1', heading: 'Goal', body: 'Ship the thing' },
        { id: 's2', heading: 'Steps', body: '1. Do it' },
      ],
    });
    expect(planDocOf(plan)).toBe('## Goal\n\nShip the thing\n\n## Steps\n\n1. Do it');
  });
});

describe('codeSummaryOf', () => {
  it('extracts commitMessage + file paths + totals from diffSummary', () => {
    const code = node({
      nodeId: 'code1', kind: 'CODE', commitMessage: 'Add retry logic',
      diffSummary: { filesChanged: 1, additions: 10, deletions: 2, files: [{ path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 }] },
    });
    expect(codeSummaryOf(code)).toEqual({ commitMessage: 'Add retry logic', filePaths: ['src/a.ts'], additions: 10, deletions: 2 });
  });

  it('defaults to empty/zero when the node has no diffSummary or commitMessage yet (a still-running CODE node)', () => {
    const running = node({ nodeId: 'code2', kind: 'CODE' });
    expect(codeSummaryOf(running)).toEqual({ commitMessage: '', filePaths: [], additions: 0, deletions: 0 });
  });
});

describe('codeContextBlockOf', () => {
  it('includes commit message, file list, and recent events', () => {
    const code = node({
      nodeId: 'code1', kind: 'CODE', commitMessage: 'Add retry logic',
      diffSummary: { filesChanged: 1, additions: 5, deletions: 1, files: [{ path: 'src/retry.ts', status: 'modified', additions: 5, deletions: 1 }] },
    });
    const block = codeContextBlockOf(code, [
      { seq: 0, ts: 't', kind: 'text', payload: 'reading files' },
      { seq: 1, ts: 't', kind: 'terminal', payload: 'tests passed' },
    ]);
    expect(block).toContain('Add retry logic');
    expect(block).toContain('src/retry.ts');
    expect(block).toContain('reading files');
    expect(block).toContain('tests passed');
  });

  it('stringifies a non-string payload rather than crashing', () => {
    const code = node({ nodeId: 'code1', kind: 'CODE' });
    const block = codeContextBlockOf(code, [{ seq: 0, ts: 't', kind: 'tool_call', payload: { cmd: 'ls' } }]);
    expect(block).toContain('"cmd":"ls"');
  });

  it('falls back to placeholders when there are no files or events', () => {
    const code = node({ nodeId: 'code1', kind: 'CODE' });
    const block = codeContextBlockOf(code, []);
    expect(block).toContain('no files recorded');
    expect(block).toContain('no agent run events available');
  });
});
