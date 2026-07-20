import * as dynamoose from 'dynamoose';
import { NodeSchema, AgentRunSchema, ProjectSchema, SessionMetaSchema, GithubInstallationSchema, HighlightSchema } from './dynamo.schemas';

// Model instantiation + toJSON only — no .save()/.get(), so no AWS calls/creds
// needed. This exists to catch the exact bug this codebase has hit before:
// saveUnknown:false silently strips any field the schema doesn't declare, on
// both write and read (see root CLAUDE.md → "Dynamoose saveUnknown is off").
// Asserting toJSON() retains every new field proves the interface and the
// schema haven't drifted apart — a schema omission fails this test instead of
// silently dropping data in production.
describe('Dynamoose schema field coverage', () => {
  it('Node model retains all CODE/BRANCH fields', () => {
    const NodeModel = dynamoose.model('NodeSchemaCoverageTest', NodeSchema);
    const item = new NodeModel({
      PK: 'SESSION#s1',
      SK: 'NODE#n1',
      nodeId: 'n1',
      parentId: 'p1',
      kind: 'CODE',
      title: 'Add retry logic',
      emoji: null,
      query: 'Add retry logic',
      lede: '',
      sections: [{ id: 'sec1', heading: '', body: '' }],
      fromSection: null,
      fromText: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      commitSha: 'abc1234',
      branchName: 'feature/x',
      commitMessage: 'Add retry logic',
      diffSummary: {
        filesChanged: 2,
        additions: 10,
        deletions: 3,
        files: [{ path: 'src/a.ts', status: 'modified', additions: 8, deletions: 2 }],
      },
      agentStatus: 'done',
      imported: true,
      runCostUsd: 0.03,
      machineCostUsd: 0.0135,
      prNumber: 42,
      prUrl: 'https://github.com/acme/widgets/pull/42',
      prError: 'forbidden',
      okr: { objective: 'Ship the retry logic', keyResults: ['p99 latency < 200ms', 'zero flaky test failures'] },
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.commitSha).toBe('abc1234');
    expect(json.branchName).toBe('feature/x');
    expect(json.commitMessage).toBe('Add retry logic');
    expect(json.diffSummary).toEqual({
      filesChanged: 2,
      additions: 10,
      deletions: 3,
      files: [{ path: 'src/a.ts', status: 'modified', additions: 8, deletions: 2 }],
    });
    expect(json.agentStatus).toBe('done');
    expect(json.imported).toBe(true);
    expect(json.runCostUsd).toBe(0.03);
    expect(json.machineCostUsd).toBe(0.0135);
    expect(json.prNumber).toBe(42);
    expect(json.prUrl).toBe('https://github.com/acme/widgets/pull/42');
    expect(json.prError).toBe('forbidden');
    expect(json.okr).toEqual({ objective: 'Ship the retry logic', keyResults: ['p99 latency < 200ms', 'zero flaky test failures'] });
  });

  // Regression guard for the inline-mode (#237) footgun: a section's askedQuery
  // must be declared on NodeSchema's nested sections schema, or saveUnknown:false
  // silently drops it on write/read — same class of bug as the Usage Event
  // `model` field (see root CLAUDE.md → "Dynamoose saveUnknown is off").
  it('Node model retains sections[].askedQuery (inline mode)', () => {
    const NodeModel = dynamoose.model('NodeSchemaAskedQueryCoverageTest', NodeSchema);
    const item = new NodeModel({
      PK: 'SESSION#s1',
      SK: 'NODE#n1',
      nodeId: 'n1',
      parentId: null,
      kind: 'QUERY',
      title: 'Root Title',
      emoji: null,
      query: 'Root query',
      lede: '',
      sections: [{ id: 'sec1', heading: '', body: 'Because the loss surface is convex here.', askedQuery: 'Why does this work?' }],
      fromSection: null,
      fromText: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const json = item.toJSON() as { sections: Array<Record<string, unknown>> };
    expect(json.sections[0].askedQuery).toBe('Why does this work?');
  });

  it('AgentRun model retains all fields', () => {
    const AgentRunModel = dynamoose.model('AgentRunSchemaCoverageTest', AgentRunSchema);
    const item = new AgentRunModel({
      PK: 'SESSION#s1',
      SK: 'AGENTRUN#n1',
      nodeId: 'n1',
      status: 'done',
      events: JSON.stringify([{ seq: 0, ts: '2026-01-01T00:00:00.000Z', kind: 'text', payload: 'hi' }]),
      commitSha: 'abc1234',
      branchName: 'feature/x',
      commitMessage: 'Add retry logic',
      diffSummary: {
        filesChanged: 1,
        additions: 5,
        deletions: 1,
        files: [{ path: 'src/b.ts', status: 'added', additions: 5, deletions: 0 }],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.status).toBe('done');
    expect(json.events).toContain('"kind":"text"');
    expect(json.commitSha).toBe('abc1234');
    expect((json.diffSummary as { files: Array<{ path: string }> }).files[0].path).toBe('src/b.ts');
  });

  it('Project model retains all fields', () => {
    const ProjectModel = dynamoose.model('ProjectSchemaCoverageTest', ProjectSchema);
    const item = new ProjectModel({
      PK: 'USER#u1',
      SK: 'PROJECT#p1',
      projectId: 'p1',
      name: 'My Project',
      repoRef: {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        defaultBranch: 'main',
        url: 'https://github.com/acme/widgets',
        private: true,
      },
      plugins: ['mem-palace', 'graphify'],
      sessionId: 's1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      branchCount: 3,
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.repoRef).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      defaultBranch: 'main',
      url: 'https://github.com/acme/widgets',
      private: true,
    });
    expect(json.plugins).toEqual(['mem-palace', 'graphify']);
    expect(json.branchCount).toBe(3);
  });

  it('SessionMeta model retains projectId', () => {
    const SessionMetaModel = dynamoose.model('SessionMetaSchemaCoverageTest', SessionMetaSchema);
    const item = new SessionMetaModel({
      PK: 'USER#u1',
      SK: 'SESSION#s1',
      sessionId: 's1',
      title: 'T',
      emoji: '',
      lede: '',
      rootNodeId: '',
      nodeCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      gsi1pk: 'USER#u1',
      gsi1sk: 'UPDATED#2026-01-01T00:00:00.000Z',
      projectId: 'p1',
      lastRunStatus: 'running',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.projectId).toBe('p1');
    expect(json.lastRunStatus).toBe('running');
  });

  // Regression guard for the "Explain" inline-note footgun (#237 Phase 1b): the
  // note field must be declared on HighlightSchema, or saveUnknown:false
  // silently drops it on write/read — same class of bug as the Usage Event
  // `model` field (see root CLAUDE.md → "Dynamoose saveUnknown is off").
  it('Highlight model retains note', () => {
    const HighlightModel = dynamoose.model('HighlightSchemaCoverageTest', HighlightSchema);
    const item = new HighlightModel({
      PK: 'SESSION#s1',
      SK: 'HL#hl1',
      hlId: 'hl1',
      nodeId: 'n1',
      sectionId: 'sec1',
      text: 'gradient descent',
      start: 10,
      end: 27,
      bg: 'note',
      fg: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      note: 'Because the loss surface is convex here.',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.bg).toBe('note');
    expect(json.note).toBe('Because the loss surface is convex here.');
  });

  // Same footgun, same fix, for the question that produced `note` (#237 Phase
  // 1b gap-fix) — without this declared on the schema, a page reload can't
  // show what was asked, only the answer.
  it('Highlight model retains noteQuestion', () => {
    const HighlightModel = dynamoose.model('HighlightSchemaCoverageTest2', HighlightSchema);
    const item = new HighlightModel({
      PK: 'SESSION#s1',
      SK: 'HL#hl1',
      hlId: 'hl1',
      nodeId: 'n1',
      sectionId: 'sec1',
      text: 'gradient descent',
      start: 10,
      end: 27,
      bg: 'note',
      fg: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      note: 'Because the loss surface is convex here.',
      noteQuestion: 'Why does this work?',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.note).toBe('Because the loss surface is convex here.');
    expect(json.noteQuestion).toBe('Why does this work?');
  });

  it('GithubInstallation model retains all fields, including accountType and repositorySelection (ADR-0007)', () => {
    const GithubInstallationModel = dynamoose.model('GithubInstallationSchemaCoverageTest', GithubInstallationSchema);
    const item = new GithubInstallationModel({
      PK: 'USER#u1',
      SK: 'GHINST#12345',
      installationId: '12345',
      accountLogin: 'acme',
      accountType: 'Organization',
      repositorySelection: 'all',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.installationId).toBe('12345');
    expect(json.accountLogin).toBe('acme');
    expect(json.accountType).toBe('Organization');
    expect(json.repositorySelection).toBe('all');
  });
});
