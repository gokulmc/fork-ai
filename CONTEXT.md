# fork.ai — Domain Glossary

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

## History
The list of Sessions accessible to a logged-in User — both Sessions they own and Sessions they have Claimed via a Share Token.

## Web Search
An optional mode on any LLM call that attaches the `web_search_20250305` Anthropic tool (max 3 uses per call). When active, the LLM may issue up to 3 search queries and weave live results into sections. Gated behind a toggle in the Tweaks panel. Persisted per-device in `localStorage` under `fork.ai.tweaks`. Disabled by default.

## CitationSource
A `{ title, url }` pair that records one web source actually cited in a Web Search response. Only sources that appear inside a `<cite>` tag in the raw LLM output are included — unused search results are discarded. Stored as `sources[]` on the Node in DynamoDB. Rendered as a numbered footnote list below the last section; each footnote number is a clickable link to the source URL. The inline citation markers are `<sup class="cite-ref"><a …>[N]</a></sup>` injected server-side by `processCitations` in `LlmService`.

## Onboarding Tour
A progressive, floating-tooltip walkthrough shown once to each authenticated User on their first login. Covers 8 steps: query input, section viewer, mind map, highlight menu, Ask AI branch, Save to Notion, share button, and history. Step 1 appears on the Landing page; steps 2–7 appear after the user's first query loads. Skipping or completing the tour marks the User as onboarded in DynamoDB. Guests do not see the tour — they have no UserMeta row. The tour can be restarted via a "Restart tour" button in the Tweaks panel, which resets the onboarded flag in the DB and reloads the page.
