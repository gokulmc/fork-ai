import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [DynamoModule, SessionsModule, ConfigModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
