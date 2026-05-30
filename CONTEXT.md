# fork.ai — Domain Glossary

> **IMPORTANT — Trial Session branch fix:** When a Trial Session is created via `POST /share` (streaming), the done handler sets `guestToken` and must also set `hasLoadedShareRef.current = true` synchronously (before `setGuestToken`). Without this, the share load effect fires when `guestToken` changes from `null` → token, re-fetches the session from DB, briefly sets `loadingRoot = true`, and creates a timing window where the branch callbacks (`expandSectionAsChild`, `askFromHighlight`) close over stale state and silently no-op on the first click. The fix is in `submitRootQuery`'s done handler: `hasLoadedShareRef.current = true` is set before `setGuestToken(event.token)`.
>
> **IMPORTANT — First branch click silent failure (AskMe/Go Deeper):** The branch callbacks depend on `guestToken` being in their closure. For Trial Sessions, `guestToken` is `null` at session start and is set only in the `done` event of the root query stream. If the share load effect fires (because it watches `guestToken`) and overwrites state before the user can interact, `expandSectionAsChild`/`askFromHighlight` may capture a stale closure. Always guard against this by setting `hasLoadedShareRef.current = true` when storing the trial token. See commit history for `e4b15e5` (AskMe branch stale nodeId) and the trial branch for the `hasLoadedShareRef` fix.

## Session
A single research tree rooted at a user query. Contains a flat map of Nodes. Owned by one User (the creator). Can be shared via a Share Token.

## Node
One piece of research content — a query result, a deep-dive, or a follow-up. Always belongs to exactly one Session. Kind is one of `QUERY` (root), `DEEPER` (Go Deeper branch), or `ASK` (Ask AI branch). Nodes are never queried independently of their Session.

## Section
A heading + body block within a Node. All text content lives inside Sections. Sections are nested inside Nodes and never stored or queried independently.

## Share Token
An opaque, cryptographically random credential that grants its bearer read + LLM-branch access to a specific Session. One active token per Session at a time. Permanent until the owner revokes it. Does not embed any user or session information — it is a pure lookup key.

## Guest
A user accessing a Session via a Share Token without a Cognito identity. A Guest can view content, create Highlights, and create Nodes (Go Deeper, Ask AI). A Guest cannot rename Nodes, delete branches, or export to Notion without logging in. Guest-created Nodes are written directly into the original owner's Session in DynamoDB.

## Guest Mode
Frontend state where `guestToken` is set and `idToken` is null. All LLM and data operations route through the `/share/:token/*` API surface. Notion export is gated — it prompts the Guest to log in.

## Claim
The action of attaching a shared Session to an authenticated User's account so it appears in their History. Triggers automatically on: (a) load while already logged in with a share URL, or (b) successful login from Guest Mode. Creates a SessionMeta entry under the authenticated User's sub pointing to the shared Session.

## Highlight
A persistent text selection within a Section, stored with character offsets and colour. Applied client-side via the CSS Custom Highlight API. Belongs to a Session (not to a user), so Highlights created by a Guest are visible to the owner and vice-versa.

## Annotation
A user-created note or callout anchored to a Section passage. Kind is `note` or `callout`. Belongs to a Session.

## Parent Page
An existing Notion page the user selects in the Save-to-Notion picker; the exported Session is created as a child of it. Distinct from a Top-level Page, which is a brand-new page created at the workspace root (`parent: { workspace: true }`) when the user has no pages or chooses "+ Create a new page". The picker always offers Top-level Page creation; it requires workspace-level OAuth access.

## History
The list of Sessions accessible to a logged-in User — both Sessions they own and Sessions they have Claimed via a Share Token.

## Web Search
An optional mode on any LLM call that attaches the `web_search_20250305` Anthropic tool (max 3 uses per call). When active, the LLM may issue up to 3 search queries and weave live results into sections. Gated behind a toggle in the Tweaks panel. Persisted per-device in `localStorage` under `fork.ai.tweaks`. Disabled by default.

## Model
The model that serves a given LLM call, across two providers (**Anthropic Claude** and **Google Gemini**). Six aliases: Claude `haiku` (default), `sonnet`, `opus`; Gemini `gemini-flash-lite`, `gemini-flash`, `gemini-pro`. The **root query (`QUERY`) is always Claude Sonnet** and is not user-selectable. **Branch calls (`DEEPER` and `ASK`) honour a single per-device "Model" tweak** in the Tweaks panel, persisted in `localStorage` under `fork.ai.tweaks`, default `haiku`. The client sends the alias, never a raw model id; the server validates it against a fixed allowlist and maps it to a concrete model id, falling back to `haiku` if absent or invalid. A **Guest is clamped to the mid tier within the chosen provider** — `/share/:token/*` downgrades a top-tier request (`opus`→`sonnet`, `gemini-pro`→`gemini-flash`), because Guest branches spend the owner's Credit and the owner never opted into top-tier-priced calls. `LlmService` dispatches to the right provider by model id; the serving Model is recorded on the Usage Event and determines the rate used by the Credit Multiplier formula. **Web Search** with a Gemini model uses Google Search grounding (vs Anthropic's web-search tool); grounding results are mapped to the same `CitationSource` footnotes. (Gemini 2.5 forbids grounding together with JSON-output mode, so grounded Gemini calls rely on prompt-based JSON + the `parseJson` fallback.)

## CitationSource
A `{ title, url }` pair that records one web source actually cited in a Web Search response. Only sources that appear inside a `<cite>` tag in the raw LLM output are included — unused search results are discarded. Stored as `sources[]` on the Node in DynamoDB. Rendered as a numbered footnote list below the last section; each footnote number is a clickable link to the source URL. The inline citation markers are `<sup class="cite-ref"><a …>[N]</a></sup>` injected server-side by `processCitations` in `LlmService`.

## Onboarding Tour
A progressive, floating-tooltip walkthrough shown once to each authenticated User on their first login. Covers 8 steps: query input, section viewer, mind map, highlight menu, Ask AI branch, Save to Notion, share button, and history. Step 1 appears on the Landing page; steps 2–7 appear after the user's first query loads. Skipping or completing the tour marks the User as onboarded in DynamoDB. Guests do not see the tour — they have no UserMeta row. The tour can be restarted via a "Restart tour" button in the Tweaks panel, which resets the onboarded flag in the DB and reloads the page.

## Credit
A monetary balance in USD held against a User's account, used to pay for LLM calls. Every new User receives a one-time signup Credit on first account creation. The amount is set by the `SIGNUP_CREDIT_USD` environment variable (default $5.00). Credit is stored as a floating-point number (`creditUsd`) on the User's `UserMetaItem` in DynamoDB. LLM calls are blocked (HTTP 402) when `creditUsd <= 0`; concurrent calls may briefly over-draft by one call's worth due to optimistic deduction. Guests have no Credit of their own — their LLM calls are charged against the session owner's Credit.

## Billing Overlay
A modal panel in the Account popover (same interaction pattern as the Change Password overlay) that shows the User's current Credit balance, a chronological list of Usage Events (date and cost per call, newest first, capped at 50), and an "Add Credit" button. Clicking "Add Credit" expands the overlay to show three recharge tiers ($5 / $10 / custom, minimum $1 USD). Selecting a tier creates a Recharge Order and opens the Razorpay payment modal. On payment success, the credit balance updates in real time. When `creditUsd <= 0`, the balance line is replaced with a "Out of credit — recharge to continue" prompt. Accessible only to authenticated Users (Guests have no account panel).

## Credit Multiplier
A scalar applied on top of the raw Anthropic API cost to compute how much Credit is deducted per LLM call. Formula: `deduction = (inputTokens × inRate + outputTokens × outRate) × multiplier`, where `inRate`/`outRate` are the **per-model** Anthropic token rates for the model that actually served the call (see Model). Configured via the `CREDIT_MULTIPLIER` env var (default `1.5`). Server-side only — not stored per-user or per-call. The per-model rate table is server-side and is the single source of truth for cost; the client-selected model never sets the price.

## Usage Event
A record of a single LLM call made by or on behalf of a User. Stored in DynamoDB at `PK: USER#{sub}, SK: USAGE#{ulid}`. Fields: `inputTokens`, `outputTokens`, `costUsd` (post-multiplier deduction), `kind` (QUERY/DEEPER/ASK), `model` (the Model that served the call — determines the rate used), `sessionId`, `nodeId`, `createdAt`. Usage Events are append-only and are never updated or deleted. They power the usage history shown in the Billing overlay.

## Recharge Order
A server-side Razorpay order created when a User initiates a credit top-up. The order amount is always in INR (paise), derived from the chosen USD package via a live exchange rate fetched from `api.exchangerate-api.com`. The USD amount is stored in Razorpay's order `notes` field so the credit amount is unambiguous at verification time. One order per top-up attempt; unconfirmed orders are abandoned if the user closes the Razorpay modal.

## Payment
A record of a successfully captured Razorpay payment, stored in DynamoDB at `PK: USER#{sub}, SK: PAYMENT#{razorpayPaymentId}`. Fields: `paymentId`, `orderId`, `sub`, `amountUsd`, `amountInr`, `createdAt`. Used as an idempotency key — both the direct verification endpoint and the Razorpay webhook check for an existing Payment record before crediting the User, so a User is never double-credited regardless of which path processes the event first.

## Change Password
The flow by which an already-authenticated User replaces their password by supplying their current one. Lives in the Account popover. Requires an active session. Distinct from Forgot Password, which is unauthenticated. Not offered for accounts that sign in via Google — they have no native password.

## Forgot Password
The self-service flow by which an unauthenticated person recovers an account whose native password they cannot supply. Identity is proven by a one-time code emailed to the account address; on success the person chooses a new password and is signed in. Offered only after an incorrect-password attempt during sign-in. Distinct from Change Password, which requires the current password. Not available for accounts that sign in via Google — there is no native password to reset.

## Support Ticket
A message submitted by any user (authenticated or guest) via the Contact Support form in the Tweaks panel. Fields: name, email, subject (Bug / Billing / Feature Request / Other), and free-text message. Delivered to `info@stemlabs.co.in` via Amazon SES; the submitter's email is set as Reply-To so replies go directly to them. Not stored in DynamoDB — fire-and-forget delivery only.

## Terms & Conditions
The legal agreement between fork ai and its users, operated by CURIOSTEM LEARNING PRIVATE LIMITED (Erode, Tamil Nadu, India; GST: 33AAMCC6984A1ZM). Covers account eligibility, credits and billing (Razorpay, non-refundable, credit multiplier), acceptable use, guest access, intellectual property, liability cap, privacy, termination, and governing law (courts of Erode). Accessible via the Account popover. Contact for legal matters: `info@stemlabs.co.in`.

## Trial Session
A Session created by an unauthenticated visitor (no Share Token URL, no Cognito identity) via the trial flow. Owned by the House Account in DynamoDB. Subject to a 5-node limit — further node creation is blocked until the visitor logs in or signs up. Converted to a regular user-owned Session on login via the standard Claim flow.

## Trial Token
An opaque, cryptographically random credential (same format as a Share Token) that grants an unauthenticated visitor access to their Trial Session. Created lazily on the visitor's first query submission via `POST /share` (no existing token). Stored in `localStorage` so the visitor returns to the same Trial Session on revisit. Indistinguishable from a Share Token in structure; identified as a trial by the `isTrial: true` flag returned on `GET /share/:token`.

## House Account
A synthetic `UserMetaItem` in DynamoDB (not a real Cognito identity) whose sub is configured via the `TRIAL_HOUSE_SUB` environment variable. Holds a `creditUsd` balance that absorbs the LLM cost of all Trial Session calls. Pre-funded manually via the DynamoDB console. Usage Events for trial calls are written under this sub, providing full cost visibility.

## Trial Limit Overlay
A blocking UI overlay shown when a trial user hits the 5-node limit. Displays "Limit reached — login or signup to continue (your session will be saved)" with a single CTA that triggers the standard login/signup flow. On successful login, the Trial Session is Claimed and attached to the new user's account.

## Referral Slug
A URL-safe identifier derived from a User's email local-part (lowercase, non-alphanumeric stripped). Used to construct the User's personal Referral Link. Generated lazily the first time the User clicks "Refer". Stored at `PK: REFERRAL#{slug}, SK: METADATA` in DynamoDB. Unique — collisions resolved by appending an incrementing numeric suffix (e.g. `johndoe` → `johndoe1`).

## Referral Link
A URL of the form `<appUrl>?ref=<slug>` shared by a User to invite others. Clicking it saves the slug to `localStorage` so attribution survives Google OAuth redirects and the Trial→signup conversion flow.

## Referral Credit
A one-time Credit bonus awarded to the referring User when the User they referred makes their first LLM call. Amount configured via `REFERRAL_CREDIT_USD` (default $5). Distinct from Signup Credit (which the referred User receives at account creation). Tracked by `referralCreditAwarded` on the referred User's `UserMetaItem` to prevent double-award.
