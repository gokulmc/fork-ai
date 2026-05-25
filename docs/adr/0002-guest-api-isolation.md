# ADR 0002 — Guest API as an isolated `/share/:token/*` surface

**Status:** Accepted

## Context

Guest users (Share Token holders without a Cognito identity) need to read sessions, create nodes, and manage highlights. The global `JwtAuthGuard` rejects all requests without a valid Cognito JWT. Two options were considered: (A) separate `@Public()` endpoints under `/share/:token/*`, or (B) modify `JwtAuthGuard` to accept either a Cognito JWT or a share token.

## Decision

Option A: a dedicated `ShareModule` with its own controller exposing `@Public()` routes under `/share/:token/*`. The authenticated session endpoints (`/sessions/*`) are not modified.

## Reasons

- **Hard boundary**: the guest-accessible API surface is explicit. A guard bug cannot accidentally open authenticated endpoints to guests.
- **Zero regression risk**: existing controllers, services, and the JWT guard are untouched.
- **Audit clarity**: guest traffic is identifiable by route prefix in logs.
- **Future-proof**: adding or removing guest capabilities means adding/removing routes in one module, not auditing every existing endpoint.

## Trade-offs accepted

- Some logic is duplicated between `ShareController` and the authenticated controllers (node creation, highlight CRUD). Both delegate to the same underlying service methods, so duplication is shallow.
