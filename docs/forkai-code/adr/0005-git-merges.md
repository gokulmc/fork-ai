# ADR-0005: Merge commits are out of the node model (for now)

**Status:** Proposed (deferred until a real use case forces the issue)
**Date:** 2026-07-11

## Context

Every node — learn, plan, code, branch — has exactly one `parentId`, and the MVP's map layout renders the tree as strictly forking lanes fanning out from a single ancestor, the same flat `{ [id]: node }` reconstruction-by-`parentId` model fork.ai uses for its research tree. A real git merge commit has **two** parents. Nothing in the MVP produces one (the mocked agent only ever commits linearly), but two concrete future paths will surface one: a real runtime (ADR-0001) merging one BRANCH lane back into another, or an imported repo (ADR-0002) whose actual git history already contains merge commits. Neither exists yet, so this ADR is a placeholder decision, not an urgent one.

## Decision

**Defer.** Two shapes were weighed for when this becomes necessary:

- **(a) `mergeFromNodeId?` optional field on CODE nodes.**

  ```ts
  interface ForkNode {
    parentId: string | null;       // unchanged — primary lineage
    mergeFromNodeId?: string;      // new — the branch tip that was merged in
    // ...
  }
  ```

  The node keeps its single `parentId` (its primary lineage) and gains an optional second pointer to the branch it merged in. The map renders a second incoming elbow into the same node for the merge edge, purely as an extra visual edge — it does not change how the node participates in `groupBy parentId` reconstruction. Cheap: no change to `parentId`, no change to any existing single-parent tree walk (breadcrumbs, ancestor collection for LLM context) — those keep following `parentId` only and simply don't see the merge edge.
- **(b) Full `parentIds[]` migration.** The honest model — a commit really can have N parents — but it touches every place that currently assumes one parent: tree reconstruction (`groupBy parentId`), breadcrumb walk-up, ancestor-context assembly for LLM calls, and the map layout algorithm itself. It is also the only shape that can represent an octopus merge (>2 parents), which (a) cannot — an edge case not worth designing for yet.

**Lean (a) first**, if and when a merge needs to be representable at all. It is additive (existing single-parent code keeps working unmodified) versus (b)'s cross-cutting migration, and it defers the harder layout question (how do two incoming lanes visually merge) to the point where there's a real merge to look at, not a hypothetical one.

## Consequences

- **Warning for layout code:** the map layout algorithm must not be written in a way that assumes a node can only ever have one incoming edge — e.g. don't key per-node layout state by "the one parent lane" in a way that has no slot for a second edge later. This ADR is explicitly *not* a decision to treat single-parent as permanent; it's a decision to not build (a) or (b) until there's a concrete merge to render.
- No schema change ships with this ADR. `mergeFromNodeId` is not added to the Node schema now — this document only records which shape to reach for when the need arrives.
- Import (ADR-0002) currently only seeds linear commit history per branch; if an imported repo's history includes merges, those either need (a) implemented first or are flattened/dropped on import, whichever ships sooner.
- Ancestor-context assembly for LLM calls (the ancestor chain fed into ADR-style `expandSection`/`followUpFromHighlight`-equivalent prompts) should keep walking `parentId` only, even after (a) ships — a merge edge is a graph-rendering concern, not a lineage-for-context concern, and conflating the two would silently double a node's LLM context on every merge.
