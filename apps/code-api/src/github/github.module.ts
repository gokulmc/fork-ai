import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { GithubService } from './github.service';
import { GithubAppService } from './github-app.service';
import { GithubController } from './github.controller';

@Module({
  imports: [DynamoModule],
  providers: [GithubService, GithubAppService],
  controllers: [GithubController],
  // ProjectsModule needs GithubService.getRepoSeed for D1 project seeding;
  // NodesModule needs GithubAppService.mintInstallationToken for private-repo clones.
  exports: [GithubService, GithubAppService],
})
export class GithubModule {}
