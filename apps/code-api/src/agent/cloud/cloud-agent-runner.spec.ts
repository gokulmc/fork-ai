import type { RunnerYield } from '../agent-runner';
import type { AgentRunContext } from '../mock-agent.service';
import type { SandboxHandle } from './fly-provider';
import { CloudAgentRunner, type CloudAgentRunnerConfig } from './cloud-agent-runner';

// The runner's two external boundaries are injected/mocked: the sandbox
// provider (constructor param) and global fetch (the in-machine runner's SSE
// endpoint) — no real Fly or network calls, per the local-runner test rule.

const CFG: CloudAgentRunnerConfig = {
  apiToken: 'fly-token',
  orgSlug: 'personal',
  image: 'registry.fly.io/forkai-sbx-base:latest',
  region: 'sin',
  anthropicApiKey: 'sk-ant-test',
  ttlMinutes: 20,
};

const HANDLE: SandboxHandle = {
  sandboxId: 'forkai-sbx-run01:machine1',
  baseUrl: 'https://forkai-sbx-run01.fly.dev',
  vscodeUrl: 'https://forkai-sbx-run01.fly.dev:10300/?tkn=vstok',
};

const RESULT_FRAME = {
  type: 'result',
  sha: 'c00c4080ac39df64707ca215b8162a7a87711b03',
  baseSha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
  diffSummary: { filesChanged: 1, additions: 2, deletions: 0, files: [{ path: 'VERSION', status: 'added', additions: 2, deletions: 0 }] },
  exitCode: 0,
};

function sse(frames: unknown[]): string {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
}

function mkCtx(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    instruction: 'Add a VERSION file',
    planDoc: null,
    branchName: 'main',
    baseCommitSha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
    repoRef: null,
    plugins: [],
    ancestorCodeSummaries: [],
    runId: 'run01',
    repo: { cloneUrl: 'https://github.com/octocat/Hello-World.git' },
    ...overrides,
  };
}

async function drain(gen: AsyncIterable<RunnerYield>): Promise<RunnerYield[]> {
  const out: RunnerYield[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('CloudAgentRunner', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let provider: { create: jest.Mock; destroy: jest.Mock; setMetadata: jest.Mock };
  let runner: CloudAgentRunner;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = {
      create: jest.fn().mockResolvedValue(HANDLE),
      destroy: jest.fn().mockResolvedValue(undefined),
      setMetadata: jest.fn().mockResolvedValue(undefined),
    };
    runner = new CloudAgentRunner(CFG, provider);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('throws before provisioning anything when ctx has no cloneUrl', async () => {
    await expect(drain(runner.run(mkCtx({ repo: { localPath: '/some/local/repo' } })))).rejects.toThrow(/cloneUrl/);
    expect(provider.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates claude lines, yields a final result with the real sha + cloud workspace, and leaves the sandbox running with a tagged expiry', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          { type: 'vscode-ready' },
          { type: 'claude', line: { type: 'system', subtype: 'init', model: 'claude-sonnet-4-5' } },
          {
            type: 'claude',
            line: {
              type: 'assistant',
              message: {
                content: [
                  { type: 'text', text: 'Creating the VERSION file' },
                  { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
                ],
              },
            },
          },
          { type: 'claude', line: { type: 'result', result: 'Add VERSION file\n\nDetails.', usage: { input_tokens: 100, output_tokens: 50 } } },
          RESULT_FRAME,
        ]),
        { status: 200 },
      ),
    );

    const items = await drain(runner.run(mkCtx()));

    const events = items.filter((i) => i.type === 'event');
    expect(events.map((e) => (e.type === 'event' ? e.event.kind : ''))).toEqual(['text', 'text', 'terminal']);

    const results = items.filter((i) => i.type === 'result');
    expect(results).toHaveLength(1);
    const final = results[0].type === 'result' ? results[0].result : undefined;
    expect(final).toMatchObject({
      commitMessage: 'Add VERSION file',
      commitSha: RESULT_FRAME.sha,
      diffSummary: RESULT_FRAME.diffSummary,
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-sonnet-4-5',
      workspace: { kind: 'cloud', sandboxId: HANDLE.sandboxId, vscodeUrl: HANDLE.vscodeUrl },
    });
    expect(typeof final?.workspaceExpiresAt).toBe('string');
    expect(new Date(final!.workspaceExpiresAt!).getTime()).toBeGreaterThan(Date.now());

    // Success path: the sandbox survives past done, tagged with its expiry —
    // never destroyed in finally.
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.setMetadata).toHaveBeenCalledTimes(1);
    expect(provider.setMetadata).toHaveBeenCalledWith(HANDLE.sandboxId, 'forkai_expires_at', final!.workspaceExpiresAt);
  });

  it('sends the key in the /run body (never machine env) and appends the no-git-commit rule', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    await drain(runner.run(mkCtx()));

    // Machine env carries only the per-run, low-value tokens — the platform
    // key would be readable from the sandbox's own terminal (root VM).
    const machineEnv = provider.create.mock.calls[0][0].env as Record<string, string>;
    expect(Object.keys(machineEnv).sort()).toEqual(['IS_SANDBOX', 'RUN_TOKEN', 'VSCODE_TOKEN']);

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(`${HANDLE.baseUrl}/run`);
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.anthropicApiKey).toBe(CFG.anthropicApiKey);
    expect(body.repoUrl).toBe('https://github.com/octocat/Hello-World.git');
    expect(body.branch).toBe('main');
    // Load-bearing suffix: runner.mjs only commits a dirty tree post-run — an
    // agent that self-commits would silently produce sha === baseSha.
    expect(body.instruction).toMatch(/Do NOT run `git commit`/);
  });

  it('destroys the sandbox when the stream carries a runner error frame', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'claude', line: { type: 'system', subtype: 'init', model: 'm' } }, { type: 'error', message: 'clone failed: boom' }]), {
        status: 200,
      }),
    );

    await expect(drain(runner.run(mkCtx()))).rejects.toThrow('clone failed: boom');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(provider.destroy).toHaveBeenCalledWith(HANDLE.sandboxId);
    expect(provider.setMetadata).not.toHaveBeenCalled();
  });

  it('destroys the sandbox when the stream ends without a result frame (no commit worth keeping a workspace for)', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'claude', line: { type: 'system', subtype: 'init', model: 'm' } }]), { status: 200 }),
    );

    const items = await drain(runner.run(mkCtx()));

    expect(items.filter((i) => i.type === 'result')).toHaveLength(0);
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(provider.destroy).toHaveBeenCalledWith(HANDLE.sandboxId);
    expect(provider.setMetadata).not.toHaveBeenCalled();
  });

  it('leaves the sandbox running on error setting metadata (best-effort — never destroys a successful run over it)', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));
    provider.setMetadata.mockRejectedValue(new Error('Fly API POST /metadata → 500: boom'));

    const items = await drain(runner.run(mkCtx()));

    expect(items.filter((i) => i.type === 'result')).toHaveLength(1);
    expect(provider.setMetadata).toHaveBeenCalledTimes(1);
    expect(provider.destroy).not.toHaveBeenCalled();
  });
});
