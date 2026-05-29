# ADR-0006: Trial Session implemented as House-Account Share Token

**Status:** Accepted

## Context

New unauthenticated visitors should be able to run one research session (up to 5 nodes) before being asked to log in. On login, the session must transfer to their account. The system needs a way to:

1. Create a session with no Cognito identity on the calling side.
2. Run LLM calls without a real user's credit balance.
3. Gate further node creation at 5 nodes.
4. Claim the session to a real user on login.

## Decision

Reuse the existing Share Token infrastructure with two additions:

1. **`POST /share` (new, `@Public()`)** — creates a session under the House Account sub (`TRIAL_HOUSE_SUB` env var), runs the root LLM query (streaming, same as `POST /sessions/stream`), and returns a trial token. The token is stored as a normal `SHARE#<token>` DynamoDB item pointing to the new session. An `isTrial: true` flag is written on the session's `SessionMetaItem` and returned on `GET /share/:token`.

2. **5-node backend gate in `ShareController.createNode`** — if `session.isTrial && session.nodeCount >= 5`, return HTTP 402. Frontend also checks client-side for a smoother UX.

Everything else — `GET /share/:token`, `POST /share/:token/nodes`, highlights, and `POST /share/:token/claim` — works unchanged.

## Reasons

- **Zero new API surface for the happy path**: all post-creation operations already exist under `/share/:token/*`. ADR-0002's isolation principle is preserved.
- **Credit path unchanged**: `LlmService` bills `TRIAL_HOUSE_SUB` exactly as it bills any session owner. No new bypass logic.
- **Claim path unchanged**: `claimSession` already moves any share-token session to an authenticated user's account. Trial is just a special case of this.
- **Minimal frontend delta**: the trial token is stored in `localStorage` as `guestToken`, identical to how share URLs set `guestToken` today. The only new frontend state is `isTrial` (from session response) which drives the Trial Limit Overlay and suppresses the Share button.

## Trade-offs accepted

- House Account credit must be manually topped up in DynamoDB. Acceptable — cost is visible via Usage Events under `TRIAL_HOUSE_SUB`.
- A visitor who clears `localStorage` can start a second trial. Accepted — the node-count gate is the real enforcement; a second 5-node trial is not a meaningful exploit.
- `SessionMetaItem` gains an optional `isTrial` boolean field. Existing sessions are unaffected (field absent = not a trial).
