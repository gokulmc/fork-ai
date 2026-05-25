# ADR-0003: Store Onboarding State in DynamoDB (UserMeta), Not localStorage

**Status:** Accepted

## Context

The Onboarding Tour must show exactly once per user — on their first login — and must be resettable via the Tweaks panel. The state needs to live somewhere persistent.

Two candidates:

| | localStorage | DynamoDB (UserMeta) |
|---|---|---|
| Complexity | None — read/write in the browser | Requires schema change + API endpoint |
| Scope | Device-scoped | User-scoped across all devices |
| Reset path | Clear the key | PATCH /users/me |
| Survives browser clear | No | Yes |

## Decision

Store `hasOnboarded: boolean` on `UserMetaItem` (`PK: USER#{sub}, SK: METADATA`).

`GET /users/me` returns it. `PATCH /users/me` allows the frontend to set it (on tour complete, skip, or restart).

Guests (no UserMeta row) are excluded from the tour entirely.

## Reasoning

A device-scoped flag would show the tour again on every new browser or device. fork.ai is a cloud research workspace — a user who logs in from a second device expecting their history and sessions should not be re-onboarded. The extra backend call is negligible: `GET /users/me` is already called on app mount to upsert the UserMeta row.

## Consequences

- `UserMetaItem` and `UserMetaSchema` gain a new optional `hasOnboarded` boolean field.
- The `null`-stripping pattern in `DynamoRepository.updateUserMeta` handles the boolean correctly (booleans are not subject to the `$REMOVE` null-stripping, only `null` string values are).
- `PATCH /users/me` must be added to `UsersController` (currently only `GET /users/me` exists).
