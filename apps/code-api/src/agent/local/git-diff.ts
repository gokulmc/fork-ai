import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';

// No SDK import here — same import-safety reasoning as workspace.ts.
const execFileAsync = promisify(execFile);

// Stages and commits everything the agent changed. Returns null (not an error)
// when the agent made no edits — commitSha then falls back to baseSha and the
// diff is all zeros, which is a legitimate outcome, not a failure.
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
  if (!statusOut.trim()) return null;

  // Fixed author identity — this is the harness committing on the agent's
  // behalf, not a real contributor.
  await execFileAsync(
    'git',
    ['-c', 'user.name=forkai agent', '-c', 'user.email=agent@forkai.dev', 'commit', '-m', message],
    { cwd: dir },
  );
  const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return shaOut.trim();
}

export interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

export interface NameStatusEntry {
  path: string;
  status: string;
}

const STATUS_WORDS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted' };

// Handles both full renames ("old.ts => new.ts") and git's partial-path rename
// shorthand ("{old => new}/file.ts") so a numstat path key-matches the same
// file's entry from `git diff --name-status`.
function resolveRenamePath(raw: string): string {
  const brace = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) {
    const [, prefix, , newPart, suffix] = brace;
    return `${prefix}${newPart}${suffix}`;
  }
  const arrow = raw.indexOf(' => ');
  return arrow === -1 ? raw : raw.slice(arrow + 4).trim();
}

// `git diff --numstat` output: "<added>\t<deleted>\t<path>", '-' for binary files.
export function parseNumstat(output: string): NumstatEntry[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [addRaw, delRaw, ...pathParts] = line.split('\t');
      return {
        path: resolveRenamePath(pathParts.join('\t')),
        additions: addRaw === '-' ? 0 : parseInt(addRaw, 10),
        deletions: delRaw === '-' ? 0 : parseInt(delRaw, 10),
      };
    });
}

// `git diff --name-status` output: "<code>\t<path>", or "<code>\t<old>\t<new>"
// for renames/copies (code carries a trailing similarity score, e.g. "R100").
export function parseNameStatus(output: string): NameStatusEntry[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split('\t');
      const code = parts[0][0];
      if (code === 'R' || code === 'C') {
        return { path: parts[2], status: code === 'R' ? 'renamed' : 'copied' };
      }
      return { path: parts[1], status: STATUS_WORDS[code] ?? 'modified' };
    });
}

// Additions/deletions come from --numstat, path/status from --name-status —
// joined on path since neither alone carries both. Totals are always recomputed
// from `files`, mirroring MockAgentService.parseAndValidate's "never trust the
// model's own arithmetic" rule (here: never trust either single git invocation).
// Pure (no git call) so the assembly logic is unit-testable via parseNumstat/
// parseNameStatus fixtures alone.
export function assembleDiffSummary(numstat: NumstatEntry[], nameStatus: NameStatusEntry[]): DiffSummary {
  const statusByPath = new Map(nameStatus.map((f) => [f.path, f.status]));
  const files = numstat.map((f) => ({
    path: f.path,
    status: statusByPath.get(f.path) ?? 'modified',
    additions: f.additions,
    deletions: f.deletions,
  }));

  return {
    filesChanged: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    files,
  };
}

export async function diffSummaryBetween(dir: string, baseSha: string, headSha: string): Promise<DiffSummary> {
  const [{ stdout: numstatOut }, { stdout: nameStatusOut }] = await Promise.all([
    execFileAsync('git', ['diff', '--numstat', baseSha, headSha], { cwd: dir }),
    execFileAsync('git', ['diff', '--name-status', baseSha, headSha], { cwd: dir }),
  ]);
  return assembleDiffSummary(parseNumstat(numstatOut), parseNameStatus(nameStatusOut));
}
