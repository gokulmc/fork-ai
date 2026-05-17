You are about to start an implementation task. Before writing a single line of code, your job is to ask sharp clarifying questions so you build exactly the right thing.

## Instructions

Read the user's request carefully. Then ask **only the questions whose answers would materially change what you build** — not questions you can answer yourself from context or convention.

Group your questions into at most **3–4 focused questions** using the `AskUserQuestion` tool. Each question must have concrete options (2–4 choices) — no open-ended text fields unless truly necessary.

### What to grill on

For **new features or modules**, ask about:
- Scope boundaries — what's explicitly out of scope?
- Data ownership and relationships — who owns what, can things be shared?
- Error handling expectations — silent fail, user-facing error, retry?
- Edge cases the user may not have considered

For **API or backend work**, ask about:
- Auth requirements — who can call this endpoint?
- Pagination / limits — how large can responses get?
- Idempotency — what happens if called twice?
- Consistency requirements — eventual or strong?

For **frontend work**, ask about:
- Loading and empty states — what does the UI show while waiting?
- Responsive behaviour — mobile, tablet, or desktop only?
- Interaction details — optimistic updates, undo, confirmation dialogs?

For **data model changes**, ask about:
- Migration path — existing data, backwards compatibility?
- Access patterns not yet discussed?
- Soft-delete vs hard-delete?

### Rules

- Do NOT ask questions you can infer from CLAUDE.md, the existing codebase, or general best practice
- Do NOT ask "should I use TypeScript?" or other questions that are already decided by the project
- Do NOT ask more than 4 questions total
- After the user answers, summarise what you will build in 3–5 bullet points and confirm before starting
- If the user types "skip" or "defaults", proceed with sensible defaults and state your assumptions explicitly

## Trigger

Run this whenever the user invokes `/grill-me` before describing a task, or appends `/grill-me` to a task description.
