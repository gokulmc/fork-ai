import { Module } from '@nestjs/common';
import { LlmModule } from '@/llm/llm.module';
import { MockAgentService } from './mock-agent.service';

@Module({
  imports: [LlmModule],
  providers: [MockAgentService],
  exports: [MockAgentService],
})
export class AgentModule {}
