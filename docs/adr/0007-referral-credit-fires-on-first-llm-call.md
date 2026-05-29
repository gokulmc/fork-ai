# ADR 0007 — Referral credit fires on referred user's first LLM call, not on signup

**Status:** Accepted

## Context

The referral program awards the referring User a credit bonus when someone they invited signs up. The question is *when* to trigger the award.

Awarding credit immediately on signup creates a trivial fraud surface: a bad actor creates many fake Cognito accounts in a loop to accumulate credit for themselves at zero cost. Cognito signup is free and requires no payment or identity verification.

## Decision

Award the referral credit to the referrer when the referred User makes their **first LLM call** (i.e. when `billUsage` records their first `UsageEvent`).

Implementation:

- `UserMetaItem` carries two new fields: `referredBy` (the referrer's `sub`, set at account creation) and `referralCreditAwarded` (boolean, set to `true` after the first award).
- `UsersService.billUsage` calls `maybeAwardReferralCredit(sub)` fire-and-forget after the credit deduction and usage event are written.
- `maybeAwardReferralCredit` reads `referredBy` and `referralCreditAwarded`; if the credit is due, atomically credits the referrer and sets the flag.
- Credit amount is configured via `REFERRAL_CREDIT_USD` (default $5), matching the existing `SIGNUP_CREDIT_USD` pattern.

## Consequences

**Good:**
- Signup farms are neutralised: fake accounts must spend real credit on an LLM call to trigger the referral reward, which immediately costs the attacker more than they could gain.
- First LLM call is a low bar for genuine users — typically reached within minutes of signing up.
- Fire-and-forget pattern keeps the billing hot path unblocked; referral award failure is logged but does not fail the user's query.

**Trade-offs:**
- Slight double-award risk on concurrent first calls (same tolerance as the existing brief credit over-draft on `deductCredit`). The `referralCreditAwarded` flag is set in a `Promise.all` alongside the credit add, but there is no distributed lock — two racing calls could both read `referralCreditAwarded: false` and both award. At current scale this is acceptable.
- Referrers must wait until their contact actually uses the product, not just signs up.
