# ADR 0001 — Share Token stored as opaque DB record, not a signed JWT

**Status:** Accepted

## Context

The share feature needs a credential that proves a bearer has access to a specific Session. Two options were considered: a signed JWT (stateless, embeds sessionId + ownerSub) or an opaque random token stored in DynamoDB.

## Decision

Use a 32-byte cryptographically random token (`crypto.randomBytes(32).toString('base64url')`) stored as a DynamoDB item:

```
PK: SHARE#<token>
SK: METADATA
sessionId, ownerSub, createdAt
```

## Reasons

- **Revocation**: the owner can stop sharing at any time by deleting the item. A signed JWT cannot be revoked without rotating the signing secret globally.
- **Opacity**: the token leaks nothing about the session or user. A JWT payload is base64-decodable by anyone who holds it.
- **One active token per session**: enforced by also storing `shareToken` on the SessionMeta item. Generating a new token overwrites the old one (old DB item deleted, new one written).

## Trade-offs accepted

- One extra DynamoDB point-read per guest request to resolve token → session. Cost is negligible at current scale.
- Tokens are permanent until revoked (no automatic expiry). Accepted — the owner has explicit "Stop sharing" control.
