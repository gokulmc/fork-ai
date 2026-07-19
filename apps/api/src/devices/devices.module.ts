import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { ApnsService } from './apns.service';

@Module({
  imports: [DynamoModule],
  controllers: [DevicesController],
  providers: [DevicesService, ApnsService],
  exports: [ApnsService],
})
export class DevicesModule {}
