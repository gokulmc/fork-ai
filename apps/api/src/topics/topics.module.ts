import { Module } from '@nestjs/common';
import { LlmModule } from '@/llm/llm.module';
import { TopicsController } from './topics.controller';

@Module({
  imports: [LlmModule],
  controllers: [TopicsController],
})
export class TopicsModule {}
