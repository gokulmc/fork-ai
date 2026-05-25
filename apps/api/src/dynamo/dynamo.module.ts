import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import * as dynamoose from 'dynamoose';
import {
  USER_META_MODEL,
  SESSION_META_MODEL,
  NODE_MODEL,
  ANNOTATION_MODEL,
  HIGHLIGHT_MODEL,
  SHARE_TOKEN_MODEL,
  USAGE_EVENT_MODEL,
  DYNAMO_TABLE,
} from './dynamo.constants';
import {
  UserMetaSchema,
  SessionMetaSchema,
  NodeSchema,
  AnnotationSchema,
  HighlightSchema,
  ShareTokenSchema,
  UsageEventSchema,
} from './dynamo.schemas';
import { DynamoRepository } from './dynamo.repository';

const DYNAMO_CONFIGURED = 'DYNAMO_CONFIGURED';

@Module({
  providers: [
    {
      provide: DYNAMO_CONFIGURED,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): true => {
        dynamoose.aws.ddb.set(new DynamoDB({ region: cfg.get<string>('aws.region') }));
        return true;
      },
    },
    {
      provide: USER_META_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('UserMeta', UserMetaSchema),
    },
    {
      provide: SESSION_META_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('SessionMeta', SessionMetaSchema),
    },
    {
      provide: NODE_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('Node', NodeSchema),
    },
    {
      provide: ANNOTATION_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('Annotation', AnnotationSchema),
    },
    {
      provide: HIGHLIGHT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('Highlight', HighlightSchema),
    },
    {
      provide: SHARE_TOKEN_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('ShareToken', ShareTokenSchema),
    },
    {
      provide: USAGE_EVENT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('UsageEvent', UsageEventSchema),
    },
    {
      // Binds all models to the physical DynamoDB table.
      // DynamoRepository injects this to guarantee the Table is set up first.
      provide: DYNAMO_TABLE,
      inject: [
        DYNAMO_CONFIGURED,
        USER_META_MODEL,
        SESSION_META_MODEL,
        NODE_MODEL,
        ANNOTATION_MODEL,
        HIGHLIGHT_MODEL,
        SHARE_TOKEN_MODEL,
        USAGE_EVENT_MODEL,
        ConfigService,
      ],
      useFactory: (
        _: true,
        userMeta: any,
        sessionMeta: any,
        node: any,
        annotation: any,
        highlight: any,
        shareToken: any,
        usageEvent: any,
        cfg: ConfigService,
      ) =>
        new dynamoose.Table(
          cfg.get<string>('dynamo.tableName')!,
          [userMeta, sessionMeta, node, annotation, highlight, shareToken, usageEvent],
          { create: false, waitForActive: false },
        ),
    },
    DynamoRepository,
  ],
  exports: [DynamoRepository],
})
export class DynamoModule {}
