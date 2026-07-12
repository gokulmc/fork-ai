import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { GithubModule } from '@/github/github.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RepoImportService } from './repo-import.service';

@Module({
  imports: [DynamoModule, SessionsModule, GithubModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, RepoImportService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
