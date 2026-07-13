import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from '@/llm/llm.module';
import { MockAgentService } from './mock-agent.service';
import { MockAgentRunner } from './mock-agent-runner';
import type { AgentRunner } from './agent-runner';
import { AGENT_RUNNER_REGISTRY, RunnerRegistry, RunnerEnvironment } from './runner-registry';

@Module({
  imports: [LlmModule],
  providers: [
    MockAgentService,
    {
      provide: AGENT_RUNNER_REGISTRY,
      inject: [MockAgentService, ConfigService],
      useFactory: async (mock: MockAgentService, config: ConfigService) => {
        const runners: Partial<Record<RunnerEnvironment, AgentRunner>> = {
          mock: new MockAgentRunner(mock), // always available — the safe fallback
        };

        // local is dev-opt-in only, via the env default (AGENT_RUNNER=local) — it
        // is NOT reachable through the dto, so don't build it otherwise (it'd
        // load the SDK devDependency in environments that will never use it).
        if (process.env.NODE_ENV !== 'production' && process.env.AGENT_RUNNER === 'local') {
          // Lazy import: @anthropic-ai/claude-agent-sdk is a devDependency (prod
          // images run `npm install --omit=dev`), so a static import here would
          // crash prod boot even though this branch never runs there.
          const { LocalAgentRunner } = await import('./local/local-agent-runner');
          const { sweepStaleWorkspaces } = await import('./local/workspace');
          void sweepStaleWorkspaces(); // best-effort cleanup of orphaned workspaces
          runners.local = new LocalAgentRunner({
            anthropicApiKey: config.get<string>('anthropic.apiKey')!,
            openVsCode: process.env.LOCAL_AGENT_OPEN_VSCODE === '1',
            keepWorkspace: process.env.LOCAL_AGENT_KEEP_WORKSPACE !== '0',
          });
        }

        const apiToken = process.env.FLY_API_TOKEN;
        const image = process.env.FLY_SANDBOX_IMAGE;
        if (apiToken && image) {
          // Lazy import to mirror 'local' — not for an SDK dependency (the
          // cloud path has none) but so the mock-only default path never loads
          // provider code it doesn't use.
          const { CloudAgentRunner } = await import('./cloud/cloud-agent-runner');
          const { FlyProvider } = await import('./cloud/fly-provider');
          const { startSandboxSweep } = await import('./cloud/sandbox-sweep');
          const orgSlug = process.env.FLY_ORG ?? 'personal';
          // FLY_REGIONS (comma-separated, tried in order on
          // insufficient_capacity — see FlyProvider.createMachineWithRegionFallback)
          // takes priority; falls back to the single FLY_REGION. sin, not bom
          // as the ultimate default: bom returned insufficient_capacity for
          // shared-cpu-2x on 2026-07-13; sin passed the live spike.
          const regionsList = process.env.FLY_REGIONS?.split(',')
            .map((r) => r.trim())
            .filter(Boolean);
          const regions = regionsList?.length ? regionsList : [process.env.FLY_REGION ?? 'sin'];
          runners.cloud = new CloudAgentRunner({
            apiToken,
            orgSlug,
            image,
            regions,
            anthropicApiKey: config.get<string>('anthropic.apiKey')!,
            ttlMinutes: Number(process.env.SANDBOX_TTL_MINUTES ?? 20),
          });
          // Own FlyProvider instance (stateless — just wraps fetch with the
          // same token/org) rather than reaching into CloudAgentRunner's
          // private one, so the sweep and the runner stay decoupled.
          startSandboxSweep(new FlyProvider({ apiToken, orgSlug }), new Logger('CloudSandboxSweep'));
        }

        // Fail fast at bootstrap if the server's own default names a runner it
        // didn't just build (misconfig) — same spirit as the old per-mode guards.
        const defaultEnv = (process.env.AGENT_RUNNER as RunnerEnvironment | undefined) ?? 'mock';
        if (!runners[defaultEnv]) throw new Error(`AGENT_RUNNER=${defaultEnv} but that runner is not configured on this server`);

        return new RunnerRegistry(runners, defaultEnv);
      },
    },
  ],
  exports: [MockAgentService, AGENT_RUNNER_REGISTRY],
})
export class AgentModule {}
