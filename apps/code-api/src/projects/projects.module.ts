import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [DynamoModule, SessionsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
