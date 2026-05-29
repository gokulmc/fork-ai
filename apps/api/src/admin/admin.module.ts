import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DynamoModule, SessionsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
