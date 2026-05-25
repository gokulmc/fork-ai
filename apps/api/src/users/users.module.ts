import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [DynamoModule, ConfigModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
