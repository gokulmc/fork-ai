import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { UsersModule } from '@/users/users.module';
import { AgentModule } from '@/agent/agent.module';
import { GithubModule } from '@/github/github.module';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [DynamoModule, LlmModule, SessionsModule, UsersModule, AgentModule, GithubModule],
  controllers: [NodesController],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}
