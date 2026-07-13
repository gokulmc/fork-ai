// Illustrative story content for the /welcome onboarding page — a fictional
// but realistic "add rate limiting" coding session. Grounded in real product
// vocabulary (node kind labels, model pricing) pulled from apps/code-web's
// TweaksPanel.tsx MODEL_OPTIONS and apps/code-api/src/llm/models.ts. Keep
// shapes stable (consumed by StoryContext/BigMap/Constellation).

export const ROOT_QUERY = 'Add rate limiting to my Express API — per-user quotas';

export interface StorySection {
  num: string;
  heading: string;
  body: string;
}

export const SECTIONS: StorySection[] = [
  {
    num: '1',
    heading: 'Fixed Window Counters',
    body: 'The simplest approach counts requests in fixed-size buckets — a Redis key like ratelimit:user:42:2026-07-13T21 that increments on each request and expires after 60 seconds. It’s cheap: one INCR, one EXPIRE, O(1) per request. The cost shows up at the edge of the window, where two full bursts can land back-to-back with nothing in between to catch them…',
  },
  {
    num: '2',
    heading: 'Sliding Window & the Boundary Burst',
    body: 'A sliding window log recomputes the count from precise timestamps instead of a fixed bucket, which actually fixes the edge case — but storing a timestamp per request gets expensive at scale. The cheaper middle ground, a sliding window counter, weights the previous window’s count by how much of it still overlaps the current one. Either way: fixed windows let a client send double its limit in the two seconds either side of the reset…',
  },
  {
    num: '3',
    heading: 'Token Bucket',
    body: 'A token bucket takes a different approach: fill a bucket with tokens at a steady refill rate (say, 10/second) up to some burst capacity (say, 20), and each request spends one token. It tolerates a legitimate burst — a user who’s been idle can spend a backlog of saved-up tokens all at once — while still holding the same average rate over time. The cost is a second knob, refill rate, that has to be tuned rather than read off the requirement…',
  },
  {
    num: '4',
    heading: 'Per-User Keys & Storage',
    body: 'Whichever algorithm wins, the counter has to be keyed per user, not per route — ratelimit:{userId}:{window} in Redis, falling back to a hashed IP where there’s no user id yet. Redis is the default store because the counter has to be shared across every API replica behind the load balancer; an in-process counter would hand each replica its own separate quota. TTL matches the window size, so stale keys expire on their own instead of needing a cleanup job…',
  },
  {
    num: '5',
    heading: '429s, Headers & Backoff',
    body: 'Over quota, the API returns 429 Too Many Requests with a Retry-After header and, ideally, X-RateLimit-Remaining / X-RateLimit-Reset, so a well-behaved client backs off instead of hammering the endpoint again immediately. Skipping these headers is the single most common review comment on rate-limiter PRs — without them every client has to guess its own backoff, usually either too aggressive or too conservative…',
  },
];

// The sentence Alex selects in the "Sliding Window" section and branches
// "Ask AI" on — the exact claim her fix depends on.
export const FORK_PASSAGE =
  'Fixed windows let a client send double its limit in the two seconds either side of the reset.';

// Ask AI · answers "what actually breaks at the window boundary?"
export const ASK_AI_ANSWER =
  'At a 100 requests/minute limit, a client can send 100 requests at 11:59:59 — the tail of one window — and another 100 at 12:00:01, the head of the next: 200 requests in two seconds against a stated 100/minute cap. The fix in this branch is a Redis-backed sliding window counter — it keeps the current bucket’s count plus a weighted fraction of the previous bucket’s, so the effective limit degrades smoothly across the boundary instead of resetting to zero. Cost: one extra GET per request, still O(1).';

// Go Deeper · production-hardening detail on the sliding window counter.
export const GO_DEEPER_ANSWER =
  'In production the sliding-window counter has to be atomic across replicas — a naive GET-then-INCR from two API instances can race, and both can pass a check that should have failed one of them. The fix is a single Redis Lua script (EVAL) that reads the previous bucket, computes the weighted count, and increments the current bucket in one round trip, so the check-and-increment can’t interleave. Clock skew between app servers is the usual failure mode in review: if two instances disagree on which 60-second bucket a request falls into by even a second, users near the boundary get double- or under-counted. Redis’s own TIME command sidesteps this by using the server’s clock instead of each app instance’s.';

export const MIX_QUESTION =
  "Open the PR — what's going in, and what's staying on the branch?";

// The agent's own narration of the commit — split sentence-by-sentence in
// SceneSources so each step can cite the file it touched (receipts = diffs
// and test runs, not citations). Keep free of stray "." characters (no
// decimals, no dotted filenames) — the split is a naive `.split('.')`.
export const WEB_ANSWER =
  'It adds a Redis-backed sliding-window counter in a new rate limiter module. It writes a matching test file covering the boundary case where fixed windows used to double-count. It wires the middleware into the Express app ahead of the existing routes. The first run fails on a TTL type mismatch — FAIL — the fix casts the argument to a number, and the suite goes green: PASS.';

// The PR's own synthesis — what's shipping vs. what's staying on the branch.
export const MIX_ANSWER =
  "The PR ships the Redis-backed sliding-window counter — src/rateLimiter.ts, keyed per user id with an IP fallback, TTL matched to the window, guarded by a single Lua script so concurrent replicas can't race the check-and-increment. Token bucket was considered for burst tolerance, but it adds a second tunable (refill rate) with no measured benefit at current traffic, so it's cut from this round — the branch stays open for later. 429 responses carry Retry-After and X-RateLimit-Remaining so clients back off correctly. The new test file covers the boundary case directly: exactly the limit, then one more request a second later, expecting exactly one rejection.";

export interface StorySource {
  n: number;
  path: string;
  diffStat: string;
  url: string;
}

// The three files touched by the commit — real diff-summary shape (path +
// +/− counts), linked to an illustrative (not live) GitHub blob URL.
export const SOURCES: StorySource[] = [
  {
    n: 1,
    path: 'src/rateLimiter.ts',
    diffStat: '+58 −0',
    url: 'https://github.com/acme-labs/billing-service/blob/7c3a9f1/src/rateLimiter.ts',
  },
  {
    n: 2,
    path: 'src/rateLimiter.test.ts',
    diffStat: '+34 −0',
    url: 'https://github.com/acme-labs/billing-service/blob/7c3a9f1/src/rateLimiter.test.ts',
  },
  {
    n: 3,
    path: 'src/app.ts',
    diffStat: '+6 −1',
    url: 'https://github.com/acme-labs/billing-service/blob/7c3a9f1/src/app.ts',
  },
];

// forkai code has no public share/guest links (guest & share mode were
// stripped from this fork — see root CLAUDE.md) — always null, so the
// epilogue's secondary CTA is omitted rather than pointing at a fake link.
export const SHARE_URL: string | null = null;

export const RECEIPT_ITEMS: [string, string][] = [
  ['1× opening question', '$0.01'],
  ['3× agent commits', '$0.21'],
  ['2× follow-ups (Gemini Flash-Lite)', '$0.01'],
  ['1× deep dive (Sonnet)', '$0.07'],
  ['1× PR merge synthesis', '$0.03'],
];

export const RECEIPT_TOTAL = '$0.33';

// Card metadata for the BigMap/Constellation mind-map renderers. Keyed by the
// story node id (see StoryContext addNode call sites) — nodes not listed here
// (visitor highlights, unknown ids) fall back to their own `label` at render
// time in BigMap/Constellation. Ids are kept stable across this file and the
// scenes/*.tsx addNode() calls — StoryContext.tsx's ensureStoryNodes()
// catch-up list hardcodes 'root'/'moderating-factors'/'web-branch', so this
// map's entries must keep those exact keys even as their meaning changes.
export const NODE_META: Record<string, { emoji?: string; title: string; kicker: string }> = {
  root: { emoji: '🚦', title: 'Rate Limiting: Per-User Quotas', kicker: 'ROOT' },
  'moderating-factors': { title: 'Sliding Window, in Production', kicker: 'DEEP DIVE' },
  'web-branch': { title: 'Add per-user rate limiter', kicker: 'COMMIT' },
  mix: { title: 'Rate limiter → main', kicker: 'PR' },
  teammate: { title: 'Priya · code review', kicker: 'REVIEW' },
};
