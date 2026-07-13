import { parseNumstat, parseNameStatus, assembleDiffSummary } from './git-diff';

// Pure parser tests only — no shelling out to git, per plan. diffSummaryBetween
// itself (which does shell out) is exercised indirectly by these parsers plus
// manual verification; see the Step 1 report for how the join logic was checked.

describe('parseNumstat', () => {
  it('parses a normal add/modify line', () => {
    expect(parseNumstat('10\t2\tsrc/fetch.ts')).toEqual([{ path: 'src/fetch.ts', additions: 10, deletions: 2 }]);
  });

  it('treats "-" additions/deletions (binary files) as 0', () => {
    expect(parseNumstat('-\t-\tassets/logo.png')).toEqual([{ path: 'assets/logo.png', additions: 0, deletions: 0 }]);
  });

  it('resolves a full rename path ("old => new")', () => {
    expect(parseNumstat('5\t1\told/name.ts => new/name.ts')).toEqual([
      { path: 'new/name.ts', additions: 5, deletions: 1 },
    ]);
  });

  it('resolves a partial-path rename ("{old => new}/file.ts")', () => {
    expect(parseNumstat('3\t0\tsrc/{old => new}/file.ts')).toEqual([
      { path: 'src/new/file.ts', additions: 3, deletions: 0 },
    ]);
  });

  it('parses multiple lines and skips blank lines', () => {
    expect(parseNumstat('1\t1\ta.ts\n\n2\t0\tb.ts\n')).toEqual([
      { path: 'a.ts', additions: 1, deletions: 1 },
      { path: 'b.ts', additions: 2, deletions: 0 },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseNumstat('')).toEqual([]);
  });
});

describe('parseNameStatus', () => {
  it('maps A/M/D codes to added/modified/deleted', () => {
    expect(parseNameStatus('A\tsrc/new.ts\nM\tsrc/existing.ts\nD\tsrc/removed.ts')).toEqual([
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/existing.ts', status: 'modified' },
      { path: 'src/removed.ts', status: 'deleted' },
    ]);
  });

  it('maps a rename line (R100, with similarity score) to the new path with status "renamed"', () => {
    expect(parseNameStatus('R100\told/name.ts\tnew/name.ts')).toEqual([{ path: 'new/name.ts', status: 'renamed' }]);
  });

  it('maps a copy line (C) to the new path with status "copied"', () => {
    expect(parseNameStatus('C75\tsrc/a.ts\tsrc/b.ts')).toEqual([{ path: 'src/b.ts', status: 'copied' }]);
  });

  it('falls back to "modified" for an unrecognized code', () => {
    expect(parseNameStatus('T\tsrc/typechange.ts')).toEqual([{ path: 'src/typechange.ts', status: 'modified' }]);
  });

  it('returns [] for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('assembleDiffSummary', () => {
  it('joins numstat + name-status on path and recomputes totals from the files array', () => {
    const numstat = parseNumstat('10\t2\tsrc/fetch.ts\n5\t0\tsrc/fetch.test.ts');
    const nameStatus = parseNameStatus('M\tsrc/fetch.ts\nA\tsrc/fetch.test.ts');
    expect(assembleDiffSummary(numstat, nameStatus)).toEqual({
      filesChanged: 2,
      additions: 15,
      deletions: 2,
      files: [
        { path: 'src/fetch.ts', status: 'modified', additions: 10, deletions: 2 },
        { path: 'src/fetch.test.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
  });

  it('defaults a numstat path with no matching name-status entry to "modified"', () => {
    const summary = assembleDiffSummary([{ path: 'orphan.ts', additions: 1, deletions: 1 }], []);
    expect(summary.files).toEqual([{ path: 'orphan.ts', status: 'modified', additions: 1, deletions: 1 }]);
  });

  it('returns all-zero totals and an empty files array for no changes', () => {
    expect(assembleDiffSummary([], [])).toEqual({ filesChanged: 0, additions: 0, deletions: 0, files: [] });
  });
});
