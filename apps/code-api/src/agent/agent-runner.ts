import type { DiffSummary } from '@/dynamo/dynamo.interfaces';
import type { AgentEvent } from './agent-run.util';
import type { AgentRunContext } from './mock-agent.service';

// The runner interface every agent backend (mock, future local sandbox, future
// cloud sandbox) implements — see docs/forkai-code/adr/0001. Swapping which
// implementation NodesService talks to is a single provider factory
// (agent.module.ts), not a call-site change.
export interface AgentRunFinal {
  commitMessage: string;
  commitSha: string | null;      // null ⇒ caller fabricates (mock path only)
  diffSummary: DiffSummary;
  inputTokens: number;
  outputTokens: number;
  model: string;
  workspace?:
    | { kind: 'local'; path: string }
    | { kind: 'cloud'; sandboxId: string; vscodeUrl: string };
  // ISO timestamp — cloud only (local workspaces don't expire). Set alongside
  // `workspace` on a successful cloud run; see CloudAgentRunner.
  workspaceExpiresAt?: string;
  // GitHub push-back (ADR-0002 amendment, v1.1) — cloud-only. Set from the
  // sandbox runner's `result` frame: `git push origin <branch>` is attempted
  // after a successful commit, reusing the same installation-token remote
  // the repo was cloned from. `false` is not itself an error — it also
  // covers the expected no-op case of a 'new'-project run with no origin
  // remote. Read-only plumbing for now: not yet surfaced in product UI or
  // persisted to NodeItem/Dynamo (see docs/forkai-code/adr/0002).
  pushed?: boolean;
  pushError?: string;
}

// A discriminated union rather than a generator return value: `for await`
// never sees a generator's `return`, so the final result has to travel as a
// yielded item like any other, tagged so the consumer can tell it apart from
// a mid-run event.
export type RunnerYield =
  | { type: 'event'; event: AgentEvent }
  | { type: 'result'; result: AgentRunFinal };

export interface AgentRunner {
  run(ctx: AgentRunContext): AsyncIterable<RunnerYield>;
}

export type { AgentRunContext };
