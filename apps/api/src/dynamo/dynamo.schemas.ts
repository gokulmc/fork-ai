import * as dynamoose from 'dynamoose';

export const UserMetaSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  sub: String,
  email: String,
  createdAt: String,
  updatedAt: String,
  notionAccessToken: { type: String, required: false },
  hasOnboarded: { type: Boolean, required: false },
  creditUsd: { type: Number, required: false },
  signupIp: { type: String, required: false },
  signupCountry: { type: String, required: false },
  signupCity: { type: String, required: false },
});

export const AdminAuditSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  auditId: String,
  actorSub: String,
  actorEmail: String,
  action: String,
  targetSub: String,
  detail: String,
  createdAt: String,
});

export const UsageEventSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  usageId: String,
  sub: String,
  inputTokens: Number,
  outputTokens: Number,
  costUsd: Number,
  kind: String,
  sessionId: String,
  nodeId: String,
  createdAt: String,
});

export const PaymentSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  paymentId: String,
  orderId: String,
  sub: String,
  amountUsd: Number,
  amountInr: Number,
  createdAt: String,
});

export const SessionMetaSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  sessionId: String,
  title: String,
  emoji: String,
  lede: String,
  rootNodeId: String,
  nodeCount: Number,
  notionPageUrl: { type: String, required: false },
  shareToken: { type: String, required: false },
  ownerSub: { type: String, required: false },
  isTrial: { type: Boolean, required: false },
  createdAt: String,
  updatedAt: String,
  gsi1pk: {
    type: String,
    index: [{ name: 'gsi1', type: 'global', rangeKey: 'gsi1sk' }],
  },
  gsi1sk: String,
});

export const ShareTokenSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  token: String,
  sessionId: String,
  ownerSub: String,
  createdAt: String,
});

export const NodeSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  nodeId: String,
  parentId: { type: String, required: false },
  kind: String,
  title: String,
  emoji: { type: String, required: false },
  query: String,
  lede: String,
  sections: {
    type: Array,
    schema: [
      {
        type: Object,
        schema: {
          id: String,
          heading: String,
          body: String,
        },
      },
    ],
  },
  fromSection: { type: String, required: false },
  fromText: { type: String, required: false },
  createdAt: String,
  sources: {
    type: Array,
    required: false,
    schema: [
      {
        type: Object,
        schema: {
          title: String,
          url: String,
        },
      },
    ],
  },
});

export const AnnotationSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  annId: String,
  kind: String,
  text: String,
  fromTitle: String,
  nodeId: String,
  sectionId: String,
  createdAt: String,
});

export const HighlightSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  hlId: String,
  nodeId: String,
  sectionId: String,
  text: String,
  start: { type: Number, required: false },
  end: { type: Number, required: false },
  bg: { type: String, required: false },
  fg: { type: String, required: false },
  createdAt: String,
});
