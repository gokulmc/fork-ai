import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';

@Module({
  imports: [DynamoModule],
  providers: [GithubService],
  controllers: [GithubController],
  // ProjectsModule needs GithubService.getRepoSeed for D1 project seeding.
  exports: [GithubService],
})
export class GithubModule {}
