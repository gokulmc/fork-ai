import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { UsersModule } from '@/users/users.module';
import { SessionsController } from './sessions.controller';
import { ActivityController } from './activity.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [DynamoModule, LlmModule, UsersModule],
  controllers: [SessionsController, ActivityController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
