'use client';
import type { ForkNode } from '@/lib/types';
import { githubAppInstallUrl } from '@/lib/api';
import { GitMerge, ArrowRight, ArrowUpRight, Check } from './Icons';

interface PrPaneProps {
  node: ForkNode; // active MERGE node
  sourceNode: ForkNode | null; // resolved via nodes[node.mergeFromNodeId]
  mergedCommitNode: ForkNode | null; // the spawned CODE commit, once merged
  merging: boolean;
  mergeError: string | null;
  onMerge: () => void;
  onOpenCommit: (nodeId: string) => void;
}

// Any prError other than the "no GitHub App" pair gets a generic inline note
// — there's no separate guided action for 'exists'/'no_diff'/'failed', just
// an honest "this didn't work" (see fix-pr-states.html's (d) note).
const PR_ERROR_COPY: Record<NonNullable<ForkNode['prError']>, string> = {
  app_not_enabled: '',
  forbidden: '',
  exists: 'A pull request for this branch already exists on GitHub.',
  no_diff: "These branches have no differences to merge — there's nothing to open a PR for.",
  failed: "Couldn't open the pull request — try again from the map.",
};

export function PrPane({ node, sourceNode, mergedCommitNode, merging, mergeError, onMerge, onOpenCommit }: PrPaneProps) {
  const status = node.prStatus ?? 'open';
  const sourceBranch = sourceNode?.branchName ?? '—';
  const targetBranch = node.branchName ?? '—';
  const sourceSha = sourceNode?.commitSha ? sourceNode.commitSha.slice(0, 7) : null;

  // (d) App not enabled — no GitHub App connection on this project yet.
  if (node.prError === 'app_not_enabled' || node.prError === 'forbidden') {
    return (
      <div className="pr-pane">
        <div className="ws-meta">
          <span className="pill pill-kind pill-kind--merge"><GitMerge size={12} className="ic" /> Pull Request</span>
        </div>
        <p className="pr-pane-guide-text">PR support not enabled — connect the GitHub App to open and merge pull requests from here.</p>
        <a className="pr-guide-btn pr-guide-btn--primary" href={githubAppInstallUrl()}>Connect GitHub App</a>
      </div>
    );
  }

  return (
    <div className="pr-pane">
      <div className="ws-meta">
        <span className="pill pill-kind pill-kind--merge"><GitMerge size={12} className="ic" /> Pull Request</span>
        <span className={`pr-status-pill pr-status-pill--${status}`}>{status}</span>
      </div>

      <div className="pr-branches-row">
        <span className="commit-pill">⎇ {sourceBranch}{sourceSha ? ` · ${sourceSha}` : ''}</span>
        <ArrowRight size={14} className="pr-branches-arrow" />
        <span className="commit-pill">⎇ {targetBranch}</span>
      </div>

      {/* Any other PR failure (exists/no_diff/failed) — a plain inline note,
          not a dead end: the branch pills above still show what was attempted. */}
      {node.prError && PR_ERROR_COPY[node.prError] && (
        <p className="pr-merge-error">{PR_ERROR_COPY[node.prError]}</p>
      )}

      {status === 'open' ? (
        <>
          {/* (c) Exists — viewing the real GitHub PR and merging from here are
              both always available, not exclusive. */}
          <div className="pr-exists-actions">
            {node.prUrl && node.prNumber != null && (
              <a className="gh-btn" href={node.prUrl} target="_blank" rel="noopener noreferrer">
                View PR #{node.prNumber} <ArrowUpRight size={12} />
              </a>
            )}
            <button className="pr-merge-btn" onClick={onMerge} disabled={merging}>
              {merging ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <GitMerge size={14} />}
              Merge pull request
            </button>
          </div>
          {mergeError && <p className="pr-merge-error">{mergeError}</p>}
        </>
      ) : (
        <div className="pr-merged-row">
          <span className="pr-merged-badge"><Check size={12} /> Merged</span>
          {node.prUrl && node.prNumber != null && (
            <a className="pr-merged-link" href={node.prUrl} target="_blank" rel="noopener noreferrer">View PR #{node.prNumber} ↗</a>
          )}
          {mergedCommitNode && (
            <button
              type="button"
              className="pr-merged-link"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
              onClick={() => onOpenCommit(mergedCommitNode.id)}
            >
              View merge commit →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
