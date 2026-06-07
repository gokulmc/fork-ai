import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { BlogSubmissionsController } from './blog-submissions.controller';
import { BlogSubmissionsService } from './blog-submissions.service';

@Module({
  imports: [DynamoModule, LlmModule],
  controllers: [BlogSubmissionsController],
  providers: [BlogSubmissionsService],
})
export class BlogSubmissionsModule {}
