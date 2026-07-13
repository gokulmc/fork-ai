import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from '@/llm/llm.module';
import { MockAgentService } from './mock-agent.service';
import { MockAgentRunner } from './mock-agent-runner';
import { AGENT_RUNNER } from './agent-runner';

@Module({
  imports: [LlmModule],
  providers: [
    MockAgentService,
    {
      provide: AGENT_RUNNER,
      inject: [MockAgentService, ConfigService],
      useFactory: async (mock: MockAgentService, config: ConfigService) => {
        const mode = process.env.AGENT_RUNNER ?? 'mock';
        if (mode === 'local') {
          if (process.env.NODE_ENV === 'production') throw new Error('AGENT_RUNNER=local is dev-only');
          // Lazy import: @anthropic-ai/claude-agent-sdk is a devDependency (prod
          // images run `npm install --omit=dev`), so a static import here would
          // crash prod boot even though this branch never runs there.
          const { LocalAgentRunner } = await import('./local/local-agent-runner');
          const { sweepStaleWorkspaces } = await import('./local/workspace');
          void sweepStaleWorkspaces(); // best-effort cleanup of orphaned workspaces
          return new LocalAgentRunner({
            anthropicApiKey: config.get<string>('anthropic.apiKey')!,
            openVsCode: process.env.LOCAL_AGENT_OPEN_VSCODE === '1',
            keepWorkspace: process.env.LOCAL_AGENT_KEEP_WORKSPACE !== '0',
          });
        }
        if (mode === 'cloud') {
          // Allowed in production — this IS the production runner.
          const apiToken = process.env.FLY_API_TOKEN;
          const image = process.env.FLY_SANDBOX_IMAGE;
          if (!apiToken) throw new Error('AGENT_RUNNER=cloud requires FLY_API_TOKEN');
          if (!image) throw new Error('AGENT_RUNNER=cloud requires FLY_SANDBOX_IMAGE');
          // Lazy import to mirror 'local' — not for an SDK dependency (the
          // cloud path has none) but so the mock-only default path never loads
          // provider code it doesn't use.
          const { CloudAgentRunner } = await import('./cloud/cloud-agent-runner');
          return new CloudAgentRunner({
            apiToken,
            orgSlug: process.env.FLY_ORG ?? 'personal',
            image,
            // sin, not bom: bom returned insufficient_capacity for
            // shared-cpu-2x on 2026-07-13; sin passed the live spike.
            region: process.env.FLY_REGION ?? 'sin',
            anthropicApiKey: config.get<string>('anthropic.apiKey')!,
          });
        }
        // Unknown values fall back to mock.
        return new MockAgentRunner(mock);
      },
    },
  ],
  exports: [MockAgentService, AGENT_RUNNER],
})
export class AgentModule {}
