'use client';
import type { ForkNode } from '@/lib/types';
import { GitMerge, ArrowRight, Check } from './Icons';

interface PrPaneProps {
  node: ForkNode; // active MERGE node
  sourceNode: ForkNode | null; // resolved via nodes[node.mergeFromNodeId]
  mergedCommitNode: ForkNode | null; // the spawned CODE commit, once merged
  merging: boolean;
  mergeError: string | null;
  onMerge: () => void;
  onOpenCommit: (nodeId: string) => void;
}

export function PrPane({ node, sourceNode, mergedCommitNode, merging, mergeError, onMerge, onOpenCommit }: PrPaneProps) {
  const status = node.prStatus ?? 'open';
  const sourceBranch = sourceNode?.branchName ?? '—';
  const targetBranch = node.branchName ?? '—';
  const sourceSha = sourceNode?.commitSha ? sourceNode.commitSha.slice(0, 7) : null;

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

      {status === 'open' ? (
        <>
          <button className="pr-merge-btn" onClick={onMerge} disabled={merging}>
            {merging ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <GitMerge size={14} />}
            Merge pull request
          </button>
          {mergeError && <p className="pr-merge-error">{mergeError}</p>}
        </>
      ) : (
        <div
          className="pr-merged-row"
          role="button"
          tabIndex={0}
          onClick={() => mergedCommitNode && onOpenCommit(mergedCommitNode.id)}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && mergedCommitNode) onOpenCommit(mergedCommitNode.id); }}
        >
          <span className="pr-merged-badge"><Check size={12} /> Merged</span>
          {mergedCommitNode && <span className="pr-merged-link">View merge commit →</span>}
        </div>
      )}
    </div>
  );
}
