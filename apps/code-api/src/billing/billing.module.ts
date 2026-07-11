import { Module } from '@nestjs/common';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [DynamoModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
