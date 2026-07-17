import { BadRequestException } from '@nestjs/common';
import type { AgentRunner } from './agent-runner';

export type RunnerEnvironment = 'mock' | 'cloud' | 'local' | 'blaxel';

const RUNNER_ENVIRONMENTS: RunnerEnvironment[] = ['mock', 'cloud', 'local', 'blaxel'];

// The environments that run a real single-use VM the user is billed for, and so
// go through the ADR-0004 pre-auth hold/reconcile path (not the bare
// checkCredit gate). 'cloud' (Fly) and 'blaxel' both qualify; 'mock'/'local' do
// not. Kept as a set so isCloud() and any future call site agree.
const BILLED_CLOUD_ENVIRONMENTS: ReadonlySet<RunnerEnvironment> = new Set(['cloud', 'blaxel']);

export interface AgentRunnerRegistry {
  resolve(environment?: string): AgentRunner;
  isCloud(environment?: string): boolean;
}

export const AGENT_RUNNER_REGISTRY = Symbol('AGENT_RUNNER_REGISTRY');

// Holds every runner this server has configured (built once at bootstrap by
// agent.module.ts's factory) and resolves a per-request environment against
// it. An explicit but unavailable environment must 400, never silently fall
// back to another runner — a user who asked for cloud must not get a mock
// commit. No environment given ⇒ the server's own default (AGENT_RUNNER env).
export class RunnerRegistry implements AgentRunnerRegistry {
  constructor(
    private readonly runners: Partial<Record<RunnerEnvironment, AgentRunner>>,
    private readonly defaultEnv: RunnerEnvironment,
  ) {}

  resolve(environment?: string): AgentRunner {
    if (!environment) {
      const runner = this.runners[this.defaultEnv];
      if (!runner) throw new Error(`Default agent runner '${this.defaultEnv}' is not configured on this server`);
      return runner;
    }
    if (!RUNNER_ENVIRONMENTS.includes(environment as RunnerEnvironment) || !this.runners[environment as RunnerEnvironment]) {
      throw new BadRequestException(`Execution environment '${environment}' is not available on this server`);
    }
    return this.runners[environment as RunnerEnvironment]!;
  }

  // Lets nodes.service.ts branch hold-vs-billUsage (ADR-0004) without
  // string-sniffing the environment itself — mirrors resolve()'s own
  // explicit-or-default fallback so the two never disagree on which runner a
  // given request would actually get. True for any billed-VM runner (Fly cloud
  // OR Blaxel), so a Blaxel run gets the same hold/reconcile treatment.
  isCloud(environment?: string): boolean {
    return BILLED_CLOUD_ENVIRONMENTS.has((environment ?? this.defaultEnv) as RunnerEnvironment);
  }
}
