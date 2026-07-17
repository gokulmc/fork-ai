import { Test, TestingModule } from '@nestjs/testing';
import { MockAgentService, AgentRunContext } from './mock-agent.service';
import { LlmService } from '@/llm/llm.service';

const mockLlm = {
  generateAgentTranscript: jest.fn(),
};

const baseCtx: AgentRunContext = {
  instruction: 'Add retry logic to the fetch client',
  planDoc: null,
  branchName: 'main',
  baseCommitSha: null,
  repoRef: null,
  plugins: [],
  ancestorCodeSummaries: [],
};

function validTranscript(overrides: Record<string, unknown> = {}) {
  return {
    commitMessage: 'Add retry logic to fetch client',
    diffSummary: {
      // Deliberately WRONG totals — the service must recompute from files, never trust these.
      filesChanged: 99,
      additions: 999,
      deletions: 999,
      files: [
        { path: 'src/fetch.ts', status: 'modified', additions: 10, deletions: 2 },
        { path: 'src/fetch.test.ts', status: 'added', additions: 20, deletions: 0 },
      ],
    },
    events: [
      { kind: 'text', payload: 'Reading the fetch client' },
      { kind: 'tool_call', payload: 'grep -r fetch src/' },
      { kind: 'terminal', payload: 'FAIL src/fetch.test.ts' },
      { kind: 'file_edit', payload: 'src/fetch.ts' },
      { kind: 'terminal', payload: 'PASS src/fetch.test.ts' },
    ],
    ...overrides,
  };
}

function sdkResult(json: unknown, usage = { inputTokens: 500, outputTokens: 300 }) {
  return { rawText: JSON.stringify(json), usage };
}

describe('MockAgentService', () => {
  let service: MockAgentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockAgentService, { provide: LlmService, useValue: mockLlm }],
    }).compile();
    service = module.get<MockAgentService>(MockAgentService);
  });

  it('recomputes diffSummary totals from the files array instead of trusting the model', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    const result = await service.generate(baseCtx);
    expect(result.diffSummary.filesChanged).toBe(2);
    expect(result.diffSummary.additions).toBe(30);
    expect(result.diffSummary.deletions).toBe(2);
  });

  it('assigns sequential seq and an ISO ts to every event, preserving kind/payload', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    const result = await service.generate(baseCtx);
    expect(result.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(result.events[0].kind).toBe('text');
    expect(result.events[0].payload).toBe('Reading the fetch client');
    for (const e of result.events) expect(() => new Date(e.ts).toISOString()).not.toThrow();
  });

  it('returns usage + model from the successful call', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript(), { inputTokens: 123, outputTokens: 456 }));
    const result = await service.generate({ ...baseCtx, model: 'claude-haiku-4-5-20251001' });
    expect(result.inputTokens).toBe(123);
    expect(result.outputTokens).toBe(456);
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults to the branch default model when ctx.model is omitted', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    const result = await service.generate(baseCtx);
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });

  it('rejects an event with an invalid kind and retries once', async () => {
    mockLlm.generateAgentTranscript
      .mockResolvedValueOnce(sdkResult(validTranscript({ events: [{ kind: 'thought', payload: 'hmm' }] })))
      .mockResolvedValueOnce(sdkResult(validTranscript()));
    const result = await service.generate(baseCtx);
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(2);
    expect(result.commitMessage).toBe('Add retry logic to fetch client');
  });

  it('rejects a "truncated" kind — that marker is synthetic-only, never model-emitted', async () => {
    mockLlm.generateAgentTranscript
      .mockResolvedValueOnce(sdkResult(validTranscript({ events: [{ kind: 'truncated', payload: 'x' }] })))
      .mockResolvedValueOnce(sdkResult(validTranscript()));
    await service.generate(baseCtx);
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-string payload and retries once', async () => {
    mockLlm.generateAgentTranscript
      .mockResolvedValueOnce(sdkResult(validTranscript({ events: [{ kind: 'text', payload: { nested: true } }] })))
      .mockResolvedValueOnce(sdkResult(validTranscript()));
    await service.generate(baseCtx);
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing/empty commitMessage', async () => {
    mockLlm.generateAgentTranscript
      .mockResolvedValueOnce(sdkResult(validTranscript({ commitMessage: '' })))
      .mockResolvedValueOnce(sdkResult(validTranscript()));
    await service.generate(baseCtx);
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting the retries on persistently malformed output', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult({ commitMessage: 'x' })); // missing diffSummary/events every time
    await expect(service.generate(baseCtx)).rejects.toThrow();
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(3);
  });

  it('propagates an LlmService failure (e.g. truncation) immediately without retrying', async () => {
    mockLlm.generateAgentTranscript.mockRejectedValue(new Error('cut off'));
    await expect(service.generate(baseCtx)).rejects.toThrow('cut off');
    expect(mockLlm.generateAgentTranscript).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences before parsing', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue({
      rawText: '```json\n' + JSON.stringify(validTranscript()) + '\n```',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await expect(service.generate(baseCtx)).resolves.toBeDefined();
  });

  it('builds a prompt naming the repo, branch, instruction, plan, prior commits, and tools', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    await service.generate({
      ...baseCtx,
      branchName: 'feature/retry',
      planDoc: '## Goal\n\nShip retries',
      repoRef: { provider: 'github-mock', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://mock.git/acme/widgets' },
      plugins: ['graphify'],
      ancestorCodeSummaries: [{ commitMessage: 'Initial commit', filePaths: ['src/fetch.ts'], additions: 5, deletions: 0 }],
    });
    const prompt = mockLlm.generateAgentTranscript.mock.calls[0][0] as string;
    const model = mockLlm.generateAgentTranscript.mock.calls[0][1] as string;
    expect(prompt).toContain('acme/widgets');
    expect(prompt).toContain('feature/retry');
    expect(prompt).toContain('Add retry logic to the fetch client');
    expect(prompt).toContain('Ship retries');
    expect(prompt).toContain('Initial commit');
    expect(prompt).toContain('Graphify');
    expect(model).toBe('claude-haiku-4-5-20251001');
  });

  it('appends an Objective/Key results section to the prompt when ctx.okr is set (#220)', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    await service.generate({
      ...baseCtx,
      okr: { objective: 'Ship the retry logic', keyResults: ['p99 < 200ms', 'no flaky tests'] },
    });
    const prompt = mockLlm.generateAgentTranscript.mock.calls[0][0] as string;
    expect(prompt).toContain('Objective: Ship the retry logic');
    expect(prompt).toContain('- p99 < 200ms');
    expect(prompt).toContain('- no flaky tests');
  });

  it('omits the Objective section when ctx.okr is absent', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    await service.generate(baseCtx);
    const prompt = mockLlm.generateAgentTranscript.mock.calls[0][0] as string;
    expect(prompt).not.toContain('Objective:');
  });

  it('names an unspecified repo and says no tools are enabled when repoRef/plugins are empty', async () => {
    mockLlm.generateAgentTranscript.mockResolvedValue(sdkResult(validTranscript()));
    await service.generate(baseCtx);
    const prompt = mockLlm.generateAgentTranscript.mock.calls[0][0] as string;
    expect(prompt).toContain('an unspecified repository');
    expect(prompt).toContain('No additional tools are enabled');
  });
});
