import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { NotionService } from './notion.service';
import { NotionController } from './notion.controller';

@Module({
  imports: [DynamoModule],
  providers: [NotionService],
  controllers: [NotionController],
})
export class NotionModule {}
