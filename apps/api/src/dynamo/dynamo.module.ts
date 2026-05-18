import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoRepository } from './dynamo.repository';

export const DYNAMO_CLIENT = 'DYNAMO_CLIENT';

@Module({
  providers: [
    {
      provide: DYNAMO_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const client = new DynamoDBClient({ region: cfg.get<string>('aws.region') });
        return DynamoDBDocumentClient.from(client, {
          marshallOptions: { removeUndefinedValues: true },
        });
      },
    },
    DynamoRepository,
  ],
  exports: [DynamoRepository],
})
export class DynamoModule {}
