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
  USAGE_EVENT_MODEL,
  PAYMENT_MODEL,
  CREDIT_EVENT_MODEL,
  PROJECT_MODEL,
  AGENT_RUN_MODEL,
  DYNAMO_TABLE,
} from './dynamo.constants';
import {
  UserMetaSchema,
  SessionMetaSchema,
  NodeSchema,
  AnnotationSchema,
  HighlightSchema,
  UsageEventSchema,
  PaymentSchema,
  CreditEventSchema,
  ProjectSchema,
  AgentRunSchema,
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
      provide: USAGE_EVENT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('UsageEvent', UsageEventSchema),
    },
    {
      provide: PAYMENT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('Payment', PaymentSchema),
    },
    {
      provide: CREDIT_EVENT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('CreditEvent', CreditEventSchema),
    },
    {
      provide: PROJECT_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('Project', ProjectSchema),
    },
    {
      provide: AGENT_RUN_MODEL,
      inject: [DYNAMO_CONFIGURED],
      useFactory: () => dynamoose.model('AgentRun', AgentRunSchema),
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
        USAGE_EVENT_MODEL,
        PAYMENT_MODEL,
        CREDIT_EVENT_MODEL,
        PROJECT_MODEL,
        AGENT_RUN_MODEL,
        ConfigService,
      ],
      useFactory: (
        _: true,
        userMeta: any,
        sessionMeta: any,
        node: any,
        annotation: any,
        highlight: any,
        usageEvent: any,
        payment: any,
        creditEvent: any,
        project: any,
        agentRun: any,
        cfg: ConfigService,
      ) =>
        new dynamoose.Table(
          cfg.get<string>('dynamo.tableName')!,
          [userMeta, sessionMeta, node, annotation, highlight, usageEvent, payment, creditEvent, project, agentRun],
          { create: false, waitForActive: false },
        ),
    },
    DynamoRepository,
  ],
  exports: [DynamoRepository],
})
export class DynamoModule {}
