import { BadRequestException } from '@nestjs/common';
import type { AgentRunner } from './agent-runner';

export type RunnerEnvironment = 'mock' | 'cloud' | 'local';

const RUNNER_ENVIRONMENTS: RunnerEnvironment[] = ['mock', 'cloud', 'local'];

export interface AgentRunnerRegistry {
  resolve(environment?: string): AgentRunner;
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
}
