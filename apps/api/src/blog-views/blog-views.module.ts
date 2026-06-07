import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { BlogViewsController } from './blog-views.controller';
import { BlogViewsService } from './blog-views.service';

@Module({
  imports: [DynamoModule],
  controllers: [BlogViewsController],
  providers: [BlogViewsService],
})
export class BlogViewsModule {}
