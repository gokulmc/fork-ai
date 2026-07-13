import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';

// No `@anthropic-ai/claude-agent-sdk` import here — keeps this module loadable
// (and unit-testable) without the SDK devDependency present, same as git-diff.ts.
const execFileAsync = promisify(execFile);
const logger = new Logger('LocalAgentWorkspace');

const RUNS_ROOT = path.join(os.tmpdir(), 'forkai-runs');

export interface MaterializeWorkspaceOptions {
  runId: string;
  source: { localPath?: string; cloneUrl?: string };
  baseCommitSha: string | null;
  branchName: string;
}

// Clones the source repo into a fresh temp dir, checks out the run's base commit
// (falling back to the clone's default HEAD if the SHA doesn't exist — the map's
// baseCommitSha can be fake for nodes created before real runs existed) and a new
// branch, then returns the workspace dir and the TRUE diff base (rev-parse HEAD,
// not the possibly-fake requested SHA).
export async function materializeWorkspace(opts: MaterializeWorkspaceOptions): Promise<{ dir: string; baseSha: string }> {
  const cloneSource = opts.source.localPath ?? opts.source.cloneUrl;
  if (!cloneSource) throw new Error('materializeWorkspace requires source.localPath or source.cloneUrl');

  await fs.mkdir(RUNS_ROOT, { recursive: true });
  const dir = path.join(RUNS_ROOT, `forkai-run-${opts.runId}`);

  // execFile (never a shell string) so cloneSource/branchName/sha can't be
  // interpreted as shell syntax even though they ultimately come from user input.
  await execFileAsync('git', ['clone', '--no-hardlinks', cloneSource, dir]);

  if (opts.baseCommitSha) {
    try {
      await execFileAsync('git', ['checkout', opts.baseCommitSha], { cwd: dir });
    } catch (err) {
      logger.warn(
        `Could not check out baseCommitSha ${opts.baseCommitSha} — using clone HEAD instead (real lineage requires real runs from node 1): ${(err as Error).message}`,
      );
    }
  }

  await checkoutRunBranch(dir, opts.branchName, opts.runId);

  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, baseSha: stdout.trim() };
}

// Lands the workspace on branchName, in precedence order:
//   1. already on it (the clone's default branch — the most common path: a fresh
//      'new' project's first CODE node runs on 'main', which `git clone` has
//      already checked out; a blind `checkout -b main` here fails and used to
//      silently rename to 'main-<runId>', so the persisted NodeItem.branchName
//      no longer matched the workspace's actual HEAD) → do nothing; the clone
//      is disposable, working directly on the default branch is fine.
//   2. exists locally (re-running the same instruction lane) → check it out,
//      don't suffix.
//   3. new → create it.
// The runId-suffix fallback survives only as a last resort for an unforeseen
// checkout failure, and now warns with the actual branch name it landed on.
// Exported for unit tests (which mock execFile — no real git involved).
export async function checkoutRunBranch(dir: string, branchName: string, runId: string): Promise<void> {
  const { stdout: headOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  if (headOut.trim() === branchName) return;

  try {
    await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], { cwd: dir });
    await execFileAsync('git', ['checkout', branchName], { cwd: dir });
    return;
  } catch {
    // branch doesn't exist locally (or checkout failed) — fall through to create
  }

  try {
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: dir });
  } catch {
    const fallback = `${branchName}-${runId.slice(-4)}`;
    logger.warn(`Could not check out or create branch "${branchName}" — run is on "${fallback}" instead`);
    await execFileAsync('git', ['checkout', '-b', fallback], { cwd: dir });
  }
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Best-effort cleanup of workspaces orphaned by crashed/killed runs or a
// keepWorkspace=true run nobody came back to delete. Called once at boot.
export async function sweepStaleWorkspaces(maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(RUNS_ROOT);
  } catch {
    return; // no local runs have happened yet — nothing to sweep
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(RUNS_ROOT, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (Date.now() - stat.mtimeMs > maxAgeMs) {
          await fs.rm(entryPath, { recursive: true, force: true });
        }
      } catch {
        // a single stale/racing entry must not abort the sweep
      }
    }),
  );
}

export async function removeWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
