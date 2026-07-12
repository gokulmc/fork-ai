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

export const AGENT_RUNNER = Symbol('AGENT_RUNNER');

export type { AgentRunContext };
