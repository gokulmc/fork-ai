// checkoutRunBranch's precedence (already-on-branch → existing branch → create
// → suffix fallback) is pure dispatch over git exit codes, so it's tested by
// mocking execFile — no real git is shelled out, per the local-runner test rule.
jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'child_process';
import { Logger } from '@nestjs/common';
import { checkoutRunBranch } from './workspace';

type GitCall = { args: string[] };

const execFileMock = execFile as unknown as jest.Mock;

// Scripts the mock: each git invocation is matched against `responses` by its
// joined argv; unmatched calls succeed with empty stdout. The promisified
// wrapper resolves with the callback's result arg, so success passes an
// { stdout } object to mirror child_process's own promisify custom.
function scriptGit(responses: Array<{ match: string; stdout?: string; fail?: boolean }>): GitCall[] {
  const calls: GitCall[] = [];
  execFileMock.mockImplementation((...invocation: unknown[]) => {
    const args = invocation[1] as string[];
    const cb = invocation[invocation.length - 1] as (err: Error | null, result?: { stdout: string }) => void;
    calls.push({ args });
    const joined = args.join(' ');
    const scripted = responses.find((r) => joined === r.match);
    if (scripted?.fail) cb(new Error(`git ${joined} failed`));
    else cb(null, { stdout: scripted?.stdout ?? '' });
  });
  return calls;
}

describe('checkoutRunBranch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when HEAD is already on branchName (default-branch clone, the most common path)', async () => {
    const calls = scriptGit([{ match: 'rev-parse --abbrev-ref HEAD', stdout: 'main\n' }]);
    await checkoutRunBranch('/ws', 'main', 'run01');
    expect(calls.map((c) => c.args.join(' '))).toEqual(['rev-parse --abbrev-ref HEAD']);
  });

  it('checks out an existing local branch instead of creating a suffixed copy', async () => {
    const calls = scriptGit([
      { match: 'rev-parse --abbrev-ref HEAD', stdout: 'main\n' },
      { match: 'rev-parse --verify refs/heads/feat-x', stdout: 'abc123\n' },
    ]);
    await checkoutRunBranch('/ws', 'feat-x', 'run01');
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      'rev-parse --abbrev-ref HEAD',
      'rev-parse --verify refs/heads/feat-x',
      'checkout feat-x',
    ]);
  });

  it('creates the branch when it does not exist yet', async () => {
    const calls = scriptGit([
      { match: 'rev-parse --abbrev-ref HEAD', stdout: 'main\n' },
      { match: 'rev-parse --verify refs/heads/feat-y', fail: true },
    ]);
    await checkoutRunBranch('/ws', 'feat-y', 'run01');
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      'rev-parse --abbrev-ref HEAD',
      'rev-parse --verify refs/heads/feat-y',
      'checkout -b feat-y',
    ]);
  });

  it('falls back to a runId-suffixed branch, with a warning, only when create fails', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const calls = scriptGit([
      { match: 'rev-parse --abbrev-ref HEAD', stdout: 'main\n' },
      { match: 'rev-parse --verify refs/heads/feat-z', fail: true },
      { match: 'checkout -b feat-z', fail: true },
    ]);
    await checkoutRunBranch('/ws', 'feat-z', 'run-ABCD');
    expect(calls[calls.length - 1].args).toEqual(['checkout', '-b', 'feat-z-ABCD']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('feat-z-ABCD'));
    warnSpy.mockRestore();
  });
});
