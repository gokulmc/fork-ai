import * as dynamoose from 'dynamoose';
import { NodeSchema, AgentRunSchema, ProjectSchema } from './dynamo.schemas';

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
        provider: 'github-mock',
        owner: 'acme',
        repo: 'widgets',
        defaultBranch: 'main',
        url: 'https://mock.git/acme/widgets',
      },
      plugins: ['mem-palace', 'graphify'],
      sessionId: 's1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const json = item.toJSON() as Record<string, unknown>;
    expect(json.repoRef).toEqual({
      provider: 'github-mock',
      owner: 'acme',
      repo: 'widgets',
      defaultBranch: 'main',
      url: 'https://mock.git/acme/widgets',
    });
    expect(json.plugins).toEqual(['mem-palace', 'graphify']);
  });
});
