import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [DynamoModule, LlmModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
