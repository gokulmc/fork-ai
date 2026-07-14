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
  regions: ['sin'],
  anthropicApiKey: 'sk-ant-test',
  ttlMinutes: 20,
};

const HANDLE: SandboxHandle = {
  sandboxId: 'forkai-sbx-run01:machine1',
  baseUrl: 'https://forkai-sbx-run01.fly.dev',
  vscodeUrl: 'https://forkai-sbx-run01.fly.dev/?tkn=vstok',
  createdAt: '2026-07-13T10:00:00.000Z',
};

const RESULT_FRAME = {
  type: 'result',
  sha: 'c00c4080ac39df64707ca215b8162a7a87711b03',
  baseSha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
  diffSummary: { filesChanged: 1, additions: 2, deletions: 0, files: [{ path: 'VERSION', status: 'added', additions: 2, deletions: 0 }] },
  exitCode: 0,
  pushed: true,
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
  let onMachineDestroyBill: jest.Mock;
  let runner: CloudAgentRunner;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = {
      create: jest.fn().mockResolvedValue(HANDLE),
      destroy: jest.fn().mockResolvedValue(undefined),
      setMetadata: jest.fn().mockResolvedValue(undefined),
    };
    onMachineDestroyBill = jest.fn().mockResolvedValue(undefined);
    runner = new CloudAgentRunner({ ...CFG, onMachineDestroyBill }, provider);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('throws before provisioning anything when ctx has neither cloneUrl nor init', async () => {
    await expect(drain(runner.run(mkCtx({ repo: { localPath: '/some/local/repo' } })))).rejects.toThrow(/cloneUrl or init/);
    expect(provider.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes ctx.repo.init through to the sandbox body when it's a 'new' project (no cloneUrl)", async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    await drain(runner.run(mkCtx({ repo: { init: { defaultBranch: 'main' } } })));

    expect(provider.create).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.repoUrl).toBeUndefined();
    expect(body.init).toEqual({ defaultBranch: 'main' });
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
      pushed: true,
    });
    expect(final?.pushError).toBeUndefined();
    expect(typeof final?.workspaceExpiresAt).toBe('string');
    expect(new Date(final!.workspaceExpiresAt!).getTime()).toBeGreaterThan(Date.now());

    // Success path: the sandbox survives past done, tagged with its expiry —
    // never destroyed in finally, and never billed here either — the sweep
    // bills it later at its true destroy (ADR-0004).
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.setMetadata).toHaveBeenCalledTimes(1);
    expect(provider.setMetadata).toHaveBeenCalledWith(HANDLE.sandboxId, 'forkai_expires_at', final!.workspaceExpiresAt);
    expect(onMachineDestroyBill).not.toHaveBeenCalled();
  });

  it('carries budgetExceeded through to AgentRunFinal when the sandbox runner reports it', async () => {
    fetchMock.mockResolvedValue(new Response(sse([{ ...RESULT_FRAME, budgetExceeded: true }]), { status: 200 }));

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.budgetExceeded).toBe(true);
  });

  it('omits budgetExceeded from AgentRunFinal when the sandbox runner does not report it', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.budgetExceeded).toBeUndefined();
  });

  it('sends the key in the /run body (never machine env) and appends the no-git-commit rule', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    await drain(runner.run(mkCtx()));

    // Machine env carries only the per-run, low-value tokens — the platform
    // key would be readable from the sandbox's own terminal (root VM).
    const machineEnv = provider.create.mock.calls[0][0].env as Record<string, string>;
    expect(Object.keys(machineEnv).sort()).toEqual(['IS_SANDBOX', 'RUN_TOKEN', 'VSCODE_TOKEN']);

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(`${HANDLE.baseUrl}/__forkai/run`);
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.anthropicApiKey).toBe(CFG.anthropicApiKey);
    expect(body.repoUrl).toBe('https://github.com/octocat/Hello-World.git');
    expect(body.branch).toBe('main');
    // Load-bearing suffix: runner.mjs only commits a dirty tree post-run — an
    // agent that self-commits would silently produce sha === baseSha.
    expect(body.instruction).toMatch(/Do NOT run `git commit`/);
  });

  it('passes billing identity (sub/sessionId/nodeId) to provider.create and model/maxBudgetUsd in the /run body', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    await drain(runner.run(mkCtx({ sub: 'user-1', sessionId: 'sess-1', runId: 'node-1', model: 'claude-sonnet-4-6', maxBudgetUsd: 0.5 })));

    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.maxBudgetUsd).toBe(0.5);
  });

  // WS-F: real boot-phase reporting — ctx.onPhase (nodes.service.ts's heartbeat
  // updater) must reach FlyProvider.create verbatim so its provisioning-boundary
  // calls actually update the heartbeat text.
  it('forwards ctx.onPhase through to provider.create', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));
    const onPhase = jest.fn();

    await drain(runner.run(mkCtx({ onPhase })));

    expect(provider.create).toHaveBeenCalledWith(expect.objectContaining({ onPhase }));
  });

  it('destroys the sandbox when the stream carries a runner error frame, and does NOT bill without ctx.sub', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'claude', line: { type: 'system', subtype: 'init', model: 'm' } }, { type: 'error', message: 'clone failed: boom' }]), {
        status: 200,
      }),
    );

    await expect(drain(runner.run(mkCtx()))).rejects.toThrow('clone failed: boom');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(provider.destroy).toHaveBeenCalledWith(HANDLE.sandboxId);
    expect(provider.setMetadata).not.toHaveBeenCalled();
    // mkCtx() carries no sub — the defensive skip (shouldn't happen for a
    // real cloud run) must never write a bad billing record.
    expect(onMachineDestroyBill).not.toHaveBeenCalled();
  });

  it('bills the destroyed sandbox on the error path when ctx.sub is present', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'claude', line: { type: 'system', subtype: 'init', model: 'm' } }, { type: 'error', message: 'clone failed: boom' }]), {
        status: 200,
      }),
    );

    await expect(drain(runner.run(mkCtx({ sub: 'user-1', sessionId: 'sess-1', runId: 'node-1' })))).rejects.toThrow('clone failed: boom');

    expect(onMachineDestroyBill).toHaveBeenCalledTimes(1);
    expect(onMachineDestroyBill).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-1',
        sandboxId: HANDLE.sandboxId, // "<appName>:<machineId>" — must match the sweep's own format exactly (shared MACHINEBILL# idempotency key)
        sessionId: 'sess-1',
        nodeId: 'node-1',
        createdAt: HANDLE.createdAt,
      }),
    );
  });

  it('does not let onMachineDestroyBill throwing mask the original run error', async () => {
    onMachineDestroyBill.mockRejectedValue(new Error('billing backend down'));
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'error', message: 'clone failed: boom' }]), { status: 200 }),
    );

    await expect(drain(runner.run(mkCtx({ sub: 'user-1', sessionId: 'sess-1' })))).rejects.toThrow('clone failed: boom');
    expect(onMachineDestroyBill).toHaveBeenCalledTimes(1);
  });

  it('does not bill when the sandbox destroy itself fails (machine stays alive for the sweep to bill instead)', async () => {
    provider.destroy.mockRejectedValue(new Error('Fly API DELETE → 500: boom'));
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'error', message: 'clone failed: boom' }]), { status: 200 }),
    );

    await expect(drain(runner.run(mkCtx({ sub: 'user-1', sessionId: 'sess-1' })))).rejects.toThrow('clone failed: boom');
    expect(onMachineDestroyBill).not.toHaveBeenCalled();
  });

  it('destroys the sandbox when the stream ends without a result frame (no commit worth keeping a workspace for)', async () => {
    fetchMock.mockResolvedValue(
      new Response(sse([{ type: 'claude', line: { type: 'system', subtype: 'init', model: 'm' } }]), { status: 200 }),
    );

    const items = await drain(runner.run(mkCtx({ sub: 'user-1', sessionId: 'sess-1', runId: 'node-1' })));

    expect(items.filter((i) => i.type === 'result')).toHaveLength(0);
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(provider.destroy).toHaveBeenCalledWith(HANDLE.sandboxId);
    expect(onMachineDestroyBill).toHaveBeenCalledTimes(1);
    expect(provider.setMetadata).not.toHaveBeenCalled();
  });

  // ADR-0004 redesign: a budget stop means claude's stream-json `result` line
  // never carries real usage (it's zeroed per the CLI's own behavior), so
  // inputTokens/outputTokens legitimately stay 0 for a budget-stopped run —
  // there is no metered fallback any more. The authoritative cost basis is
  // claudeCostUsd (runnerResult.claudeCostUsd), forwarded through untouched.
  it('carries claudeCostUsd through to AgentRunFinal, with zeroed tokens, on a budget-stopped run', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          { type: 'claude', line: { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' } },
          // No 'result'-type claude line with real usage — a budget stop's
          // result line reports zeroed usage, so extractResult contributes 0.
          { ...RESULT_FRAME, budgetExceeded: true, claudeCostUsd: 0.0258 },
        ]),
        { status: 200 },
      ),
    );

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.inputTokens).toBe(0);
    expect(final?.outputTokens).toBe(0);
    expect(final?.budgetExceeded).toBe(true);
    expect(final?.claudeCostUsd).toBe(0.0258);
  });

  it('carries claudeCostUsd alongside the SDK result-line token totals on a normal run', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          { type: 'claude', line: { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' } },
          { type: 'claude', line: { type: 'result', result: 'Done', usage: { input_tokens: 100, output_tokens: 50 } } },
          { ...RESULT_FRAME, claudeCostUsd: 0.0645 },
        ]),
        { status: 200 },
      ),
    );

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.inputTokens).toBe(100);
    expect(final?.outputTokens).toBe(50);
    expect(final?.claudeCostUsd).toBe(0.0645);
  });

  it('leaves claudeCostUsd undefined when the sandbox result frame does not report it (e.g. a CLAUDE_TIMEOUT_MS kill)', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.claudeCostUsd).toBeUndefined();
  });

  it('leaves the sandbox running on error setting metadata (best-effort — never destroys a successful run over it)', async () => {
    fetchMock.mockResolvedValue(new Response(sse([RESULT_FRAME]), { status: 200 }));
    provider.setMetadata.mockRejectedValue(new Error('Fly API POST /metadata → 500: boom'));

    const items = await drain(runner.run(mkCtx()));

    expect(items.filter((i) => i.type === 'result')).toHaveLength(1);
    expect(provider.setMetadata).toHaveBeenCalledTimes(1);
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  // v1.1 push-back (ADR-0002 amendment) — the sandbox's own runner.mjs owns
  // the actual `git push`; these three cases only verify CloudAgentRunner
  // faithfully carries the sandbox's pushed/pushError report through to
  // AgentRunFinal without altering it, and that a push failure never fails
  // the run itself (the sandbox is still kept, not destroyed).
  it('reports pushed: true on AgentRunFinal when the sandbox pushed the commit', async () => {
    fetchMock.mockResolvedValue(new Response(sse([{ ...RESULT_FRAME, pushed: true }]), { status: 200 }));

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.pushed).toBe(true);
    expect(final?.pushError).toBeUndefined();
    // A push outcome (success or failure) is not a run failure — the sandbox
    // is preserved exactly like any other successful run.
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.setMetadata).toHaveBeenCalledTimes(1);
  });

  it('reports pushed: false (no error surfaced) when the sandbox had no origin remote to push to', async () => {
    fetchMock.mockResolvedValue(new Response(sse([{ ...RESULT_FRAME, pushed: false }]), { status: 200 }));

    const items = await drain(runner.run(mkCtx({ repo: { init: { defaultBranch: 'main' } } })));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.pushed).toBe(false);
    expect(final?.pushError).toBeUndefined();
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  it('carries a redacted pushError through to AgentRunFinal and still completes the run successfully', async () => {
    const redactedError = 'git push origin main exited 128: fatal: unable to access https://***@github.com/octocat/Hello-World.git/: 403';
    fetchMock.mockResolvedValue(
      new Response(
        sse([
          { type: 'warn', message: `push to origin failed: ${redactedError}` },
          { ...RESULT_FRAME, pushed: false, pushError: redactedError },
        ]),
        { status: 200 },
      ),
    );

    const items = await drain(runner.run(mkCtx()));

    const final = items.find((i) => i.type === 'result')?.result;
    expect(final?.pushed).toBe(false);
    expect(final?.pushError).toBe(redactedError);
    // Never leaks a credential — the sandbox is responsible for redaction,
    // but assert the runner never reconstructs/appends anything un-redacted.
    expect(final?.pushError).not.toMatch(/x-access-token/);
    expect(final?.pushError).not.toMatch(/github_pat_|ghs_/);
    // The run still completes successfully — a push failure is not a run error.
    expect(items.filter((i) => i.type === 'result')).toHaveLength(1);
    expect(provider.destroy).not.toHaveBeenCalled();
  });
});
