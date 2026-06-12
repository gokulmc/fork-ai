import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { NodesModule } from '@/nodes/nodes.module';
import { HighlightsModule } from '@/highlights/highlights.module';
import { UsersModule } from '@/users/users.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [DynamoModule, SessionsModule, NodesModule, HighlightsModule, UsersModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
