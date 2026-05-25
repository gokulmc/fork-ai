# ADR-0005 — Razorpay as payment provider (INR-only, USD-first)

## Status
Accepted

## Context
fork.ai needs real self-serve credit top-ups to replace the mailto recharge stub. The primary user base is India-based, and the operator has a standard Razorpay account (not Razorpay International). Payments must be processed in INR (Razorpay's only supported currency on standard accounts). However, Credit is stored and reasoned about in USD, and package prices are defined in USD ($5 / $10 / custom with $1 minimum) because Anthropic billing is USD-denominated and the Credit Multiplier is expressed as a USD ratio.

A secondary concern is reliability: if the user closes the browser immediately after payment but before the frontend sends a verification request, the credit must still be applied. Razorpay's webhook covers this gap.

## Decision

### Currency strategy: USD-first with live INR conversion
- Packages are defined in USD (`$5`, `$10`, or custom `≥ $1`).
- At order creation time, the server fetches the live USD→INR rate from `api.exchangerate-api.com` (free tier, no key required).
- `amountInr = Math.round(amountUsd * rate * 100)` (Razorpay expects paise).
- The USD amount is stored in Razorpay's order `notes.amountUsd` field, making it the canonical credit amount at verification time regardless of later rate changes.

### Razorpay standard account (INR only)
- `currency: 'INR'` on every order. No Razorpay International required.
- The frontend displays both the INR price (fetched from the order response) and the USD equivalent for clarity.

### Idempotent credit via DynamoDB PaymentItem
Both the direct-verify path and the webhook path write a `PaymentItem` (`PK: USER#{sub}, SK: PAYMENT#{paymentId}`) on first success. Before crediting, both check `db.getPayment(sub, paymentId)` — if the record already exists, the credit step is skipped. This prevents double-crediting regardless of which path wins the race.

### Both paths required
- **`POST /billing/verify`** (authenticated): called by the frontend immediately after the Razorpay modal's `onSuccess` callback. Provides sub-second latency for the happy path.
- **`POST /billing/webhook`** (`@Public()`): called by Razorpay on `payment.captured`. Catches the case where the user closes the browser before verification. Webhook signature is verified using `RAZORPAY_WEBHOOK_SECRET` (HMAC-SHA256 of the raw request body).

### Frontend: inline overlay expansion
The Razorpay checkout flow is embedded inline in the Billing Overlay — no redirect or new page. Clicking "Add Credit" expands the overlay to show the three package tiers. Selecting a tier calls `POST /billing/orders`, then opens `Razorpay({ key, order_id, … })` modal on top of the overlay. On `handler`, the frontend calls `POST /billing/verify` and refreshes the credit balance.

## Alternatives considered

### Razorpay International (multi-currency)
Would let us charge in USD directly. Requires a separate application to Razorpay and approval. Deferred — can be enabled later without changing the USD-first model.

### Stripe
Better multi-currency support. Significantly more complex onboarding for India-based businesses (KYC, GST). Razorpay is the standard choice for Indian SaaS.

### Polling instead of webhook
The verify endpoint is enough for the happy path. Polling does not cover the browser-close edge case. Webhook is the standard solution and costs nothing extra.

## Consequences
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` must be set in the API environment.
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` must be set in the web environment (used to initialise the Razorpay checkout.js modal).
- Exchange rate is fetched on each order creation — not cached — so it reflects the rate at the moment of purchase. Acceptable for low-volume top-ups.
- `PaymentItem` records are permanent; they are the idempotency log and must not be deleted.
