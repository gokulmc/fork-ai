import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { AnnotationsController } from './annotations.controller';
import { AnnotationsService } from './annotations.service';

@Module({
  imports: [DynamoModule, SessionsModule],
  controllers: [AnnotationsController],
  providers: [AnnotationsService],
})
export class AnnotationsModule {}
