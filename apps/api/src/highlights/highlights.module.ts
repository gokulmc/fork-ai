import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';

@Module({
  imports: [DynamoModule, SessionsModule],
  controllers: [HighlightsController],
  providers: [HighlightsService],
})
export class HighlightsModule {}
