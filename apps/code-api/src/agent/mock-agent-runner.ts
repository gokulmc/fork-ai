import { Injectable } from '@nestjs/common';
import type { AgentRunner, AgentRunFinal, RunnerYield } from './agent-runner';
import { MockAgentService, type AgentRunContext } from './mock-agent.service';

// Pacing between replayed agent events on the CODE-node stream — simulates a
// live run instead of dumping the whole mocked transcript at once. Lives here
// (not in NodesService) because pacing is a property of the mock backend, not
// of the SSE consumer — a real runner streams events as they actually happen.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function jitterMs(): number {
  return 100 + Math.floor(Math.random() * 500);
}

@Injectable()
export class MockAgentRunner implements AgentRunner {
  constructor(private readonly mockAgent: MockAgentService) {}

  async *run(ctx: AgentRunContext): AsyncIterable<RunnerYield> {
    const result = await this.mockAgent.generate(ctx);
    for (const event of result.events) {
      await sleep(jitterMs());
      yield { type: 'event', event };
    }
    const final: AgentRunFinal = {
      commitMessage: result.commitMessage,
      commitSha: null, // no real git backend yet — the caller fabricates one
      diffSummary: result.diffSummary,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    };
    yield { type: 'result', result: final };
  }
}
