import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { GithubService } from '@/github/github.service';
import type { NodeItem, RepoRef } from '@/dynamo/dynamo.interfaces';

// Hard caps — a repo-import fan-out is bounded on every axis so one huge repo
// can't blow up a project-creation request into thousands of writes.
const TRUNK_CAP = 500;
const BRANCH_CAP = 50;
const TOTAL_CAP = 1000;
const BRANCH_COUNT_CAP = 20;
// Per-commit diff fetches are one extra GitHub API call each (§2c) — capped so
// import latency stays bounded even on a repo with hundreds of commits. Well
// within the 5000 req/hr OAuth budget either way.
const DIFF_FETCH_CAP = 40;

@Injectable()
export class RepoImportService {
  private readonly logger = new Logger(RepoImportService.name);

  constructor(private readonly github: GithubService) {}

  // Builds the full node list for an existing GitHub repo, or returns null to
  // tell ProjectsService to fall back to the existing getRepoSeed 2-node
  // seeding. Any failure (rate limit, revoked token, network blip) degrades
  // the same way — project creation must never fail because import failed.
  async buildImportedNodes(sub: string, repoRef: RepoRef, sessionId: string): Promise<NodeItem[] | null> {
    try {
      return await this.doBuild(sub, repoRef, sessionId);
    } catch (err) {
      this.logger.warn(`Repo import failed for ${repoRef.owner}/${repoRef.repo}: ${(err as Error).message}`);
      return null;
    }
  }

  private async doBuild(sub: string, repoRef: RepoRef, sessionId: string): Promise<NodeItem[] | null> {
    const { owner, repo, defaultBranch } = repoRef;
    const pk = `SESSION#${sessionId}`;

    // listCommits returns newest-first, capped — i.e. the most recent TRUNK_CAP
    // commits (older history beyond the cap is simply not fetched).
    const trunkNewestFirst = await this.github.listCommits(sub, owner, repo, defaultBranch, TRUNK_CAP);
    if (trunkNewestFirst.length === 0) return null; // empty repo — let the caller synthesize a seed instead

    const oldestFirst = [...trunkNewestFirst].reverse();
    const truncated = trunkNewestFirst.length >= TRUNK_CAP;

    const nodes: NodeItem[] = [];
    const shaToNodeId = new Map<string, string>();
    // Guarantees every node's createdAt is unique and monotonically increasing
    // along the order nodes are built in — buildChildMap on the frontend sorts
    // children by createdAt, so same-second commits (common in squash/rebase
    // history) must not collide.
    const usedMs = new Set<number>();

    let parentId: string | null = null;
    oldestFirst.forEach((c, i) => {
      const nodeId = ulid();
      const isRoot = i === 0;
      const title = commitTitle(c.message);
      const node: NodeItem = {
        PK: pk,
        SK: `NODE#${nodeId}`,
        nodeId,
        parentId: isRoot ? null : parentId,
        kind: 'CODE',
        title: isRoot && truncated ? `⋯ earlier history on GitHub · ${title}` : title,
        emoji: '',
        query: '',
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: nextCreatedAt(c.date, usedMs),
        commitSha: c.sha,
        commitMessage: c.message,
        branchName: defaultBranch,
        imported: true,
      };
      nodes.push(node);
      shaToNodeId.set(c.sha, nodeId);
      parentId = nodeId;
    });

    if (nodes.length >= TOTAL_CAP) return this.enrichRecentDiffs(sub, owner, repo, nodes);

    let branches: Array<{ name: string; headSha: string }>;
    try {
      branches = await this.github.listBranches(sub, owner, repo);
    } catch (err) {
      this.logger.warn(`listBranches failed for ${owner}/${repo}: ${(err as Error).message} — trunk-only import`);
      return this.enrichRecentDiffs(sub, owner, repo, nodes);
    }
    const nonDefaultBranches = branches.filter((b) => b.name !== defaultBranch).slice(0, BRANCH_COUNT_CAP);

    for (const branch of nonDefaultBranches) {
      if (nodes.length >= TOTAL_CAP) break;
      try {
        const cmp = await this.github.compareCommits(sub, owner, repo, defaultBranch, branch.name);
        const mergeBaseNodeId = shaToNodeId.get(cmp.mergeBaseSha);
        const mergeBaseNode = mergeBaseNodeId ? nodes.find((n) => n.nodeId === mergeBaseNodeId) : undefined;
        if (!mergeBaseNode) continue; // merge base was cut off by a cap — skip this branch entirely

        const branchNodeId = ulid();
        const branchNode: NodeItem = {
          PK: pk,
          SK: `NODE#${branchNodeId}`,
          nodeId: branchNodeId,
          parentId: mergeBaseNode.nodeId,
          kind: 'BRANCH',
          title: `Fork from ${cmp.mergeBaseSha.slice(0, 7)}`,
          emoji: '',
          query: `Fork from ${cmp.mergeBaseSha.slice(0, 7)}`,
          lede: '',
          sections: [],
          fromSection: null,
          fromText: null,
          // nextCreatedAt(mergeBaseNode.createdAt, ...) always nudges forward
          // by at least 1ms, since that timestamp is already reserved — i.e.
          // this naturally lands "just after" the merge-base commit.
          createdAt: nextCreatedAt(mergeBaseNode.createdAt, usedMs),
          commitSha: cmp.mergeBaseSha,
          branchName: branch.name,
          imported: true,
        };
        nodes.push(branchNode);

        // GitHub's compare response orders `commits` oldest→newest; keep the
        // commits closest to the branch's current HEAD when over cap (drop the
        // oldest, since they're closest to the already-imported merge base).
        const branchCommits = cmp.commits.length > BRANCH_CAP ? cmp.commits.slice(-BRANCH_CAP) : cmp.commits;

        let branchParentId = branchNodeId;
        for (const c of branchCommits) {
          if (nodes.length >= TOTAL_CAP) break;
          const nodeId = ulid();
          const node: NodeItem = {
            PK: pk,
            SK: `NODE#${nodeId}`,
            nodeId,
            parentId: branchParentId,
            kind: 'CODE',
            title: commitTitle(c.message),
            emoji: '',
            query: '',
            lede: '',
            sections: [],
            fromSection: null,
            fromText: null,
            createdAt: nextCreatedAt(c.date, usedMs),
            commitSha: c.sha,
            commitMessage: c.message,
            branchName: branch.name,
            imported: true,
          };
          nodes.push(node);
          // So a later branch can fork off a commit made on THIS branch, not
          // just off the trunk.
          shaToNodeId.set(c.sha, nodeId);
          branchParentId = nodeId;
        }
      } catch (err) {
        this.logger.warn(`Branch import failed for ${owner}/${repo}@${branch.name}: ${(err as Error).message} — skipping branch`);
      }
    }

    return this.enrichRecentDiffs(sub, owner, repo, nodes);
  }

  // §2c — imported commits carry no diff by default (compareCommits/listCommits
  // never fetch files[]). Backfill the HEAD-most DIFF_FETCH_CAP CODE commits
  // (trunk + branches together, ranked by real commit date via createdAt, not
  // just the trunk's tail) with a real per-commit diff, fetched in parallel —
  // this is what lets the commit page (§3) show DIFF SUMMARY instead of falling
  // back to the provenance card for a freshly imported repo's recent history.
  // Older/beyond-cap commits are left diffSummary-less on purpose; a failed
  // fetch (getCommitDiff never throws) degrades the same way. Mutates `nodes`
  // in place — they're freshly built, not yet persisted.
  private async enrichRecentDiffs(sub: string, owner: string, repo: string, nodes: NodeItem[]): Promise<NodeItem[]> {
    const codeNodes = nodes.filter((n) => n.kind === 'CODE' && n.commitSha);
    const recent = [...codeNodes]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, DIFF_FETCH_CAP);

    const diffs = await Promise.all(recent.map((n) => this.github.getCommitDiff(sub, owner, repo, n.commitSha!)));
    let fetched = 0;
    recent.forEach((n, i) => {
      const diff = diffs[i];
      if (diff) {
        n.diffSummary = diff;
        fetched++;
      }
    });
    this.logger.log(
      `Repo import diffs for ${owner}/${repo}: ${fetched}/${recent.length} fetched, ` +
      `${codeNodes.length - recent.length} older commits left diff-less (cap ${DIFF_FETCH_CAP})`,
    );
    return nodes;
  }
}

// Truncates a commit message to ~5 words for a CODE node's map-card title —
// duplicated from SessionsService.commitTitle (private there) since this is
// the only other place that needs it.
function commitTitle(message: string): string {
  return message.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || 'Initial commit';
}

// Parses `dateIso` to epoch ms and, if that ms is already taken, nudges
// forward 1ms at a time until free — guarantees every createdAt used in one
// import is unique while preserving real chronological order (nudges only
// ever move a timestamp later, and imports are built oldest→newest).
function nextCreatedAt(dateIso: string, usedMs: Set<number>): string {
  let ms = Date.parse(dateIso);
  if (Number.isNaN(ms)) ms = Date.now();
  while (usedMs.has(ms)) ms += 1;
  usedMs.add(ms);
  return new Date(ms).toISOString();
}
