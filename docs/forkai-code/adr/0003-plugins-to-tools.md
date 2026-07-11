# ADR-0003: Project plugins resolve to agent tool allowlists

**Status:** Proposed (deferred until post-MVP — no real tool execution exists yet)
**Date:** 2026-07-11

## Context

The MVP UI already stores `Project.plugins[]` — a curated set of plugin ids (`mem-palace`, `graphify`, `playwright-testing`) a user toggles on for a project — but nothing consumes the list yet, since the agent is mocked. Once a real `AgentRunner` (ADR-0001) executes, each plugin needs to translate into something the agent can actually call.

## Decision

`Project.plugins[]` resolves at run start to a **tool/MCP allowlist** injected into the `AgentRunner` context:

- `mem-palace` → memory-search MCP tool
- `graphify` → AST-index tool over the repo (structural search/navigation)
- `playwright-testing` → browser-test tool

The mapping is a **static registry** in code-api (plugin id → tool/MCP definition), not per-user configuration:

```ts
const PLUGIN_REGISTRY: Record<PluginId, ToolDef[]> = {
  'mem-palace': [memorySearchTool],
  'graphify': [astIndexTool],
  'playwright-testing': [browserTestTool],
};
```

Adding a plugin means adding a registry entry plus a UI toggle row — nothing else changes in the run path. Resolution happens once, at run start, by mapping the project's enabled plugin ids through this table into the concrete tool list handed to `AgentRunner.run(context)`; a plugin toggled mid-run has no effect on the run already in flight.

**No per-user arbitrary MCP config for the MVP or its near-term successor.** Letting a user point the agent at an arbitrary MCP server was considered and rejected: it turns every agent run into an open security surface (arbitrary network egress, arbitrary tool calls from inside a sandbox that also holds a GitHub installation token) and an open support surface (debugging a user's third-party MCP server is not this product's job).

## Alternatives considered

- **Per-user arbitrary MCP config:** most flexible, but rejected on security and support-cost grounds above.
- **No plugin system — hardcode the tool list per agent run:** simplest, but the MVP UI already commits to per-project plugin toggles; not building the resolution step would leave that UI dead.
- **Plugin registry stored in DynamoDB instead of code:** allows adding plugins without a deploy, but plugins gate real tool/MCP wiring (new dependencies, new sandbox permissions) that inherently needs a code change anyway — a DB-driven registry would imply a flexibility the system doesn't actually have.

## Consequences

- The plugin ids already persisted by the MVP UI need no migration — this ADR only defines what happens to them once a run can act on them.
- A project with no plugins enabled resolves to an empty allowlist beyond the agent's base toolset (file read/write, shell, git) — plugins are additive, never a prerequisite for a run.
- Registry entries are the enforcement point for "MCP config is not user-arbitrary" — any future request to expose raw MCP server URLs to end users is a reversal of this decision and should get its own ADR.
- Each plugin's tool(s) become part of what a sandbox run (ADR-0001) can do and what tokens it needs custody of — e.g. `mem-palace` implies the sandbox can reach whatever backs memory-search. Registry entries should be reviewed for the credential/network surface they open, the same way ADR-0002 scopes GitHub token custody.
