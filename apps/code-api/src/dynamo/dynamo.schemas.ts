import * as dynamoose from 'dynamoose';

// Shared nested-schema fragment for NodeItem.diffSummary and AgentRunItem.diffSummary
// (see DiffSummary in dynamo.interfaces.ts) — kept in one place so the two stay in sync.
const DIFF_SUMMARY_SCHEMA = {
  filesChanged: Number,
  additions: Number,
  deletions: Number,
  files: {
    type: Array,
    schema: [
      {
        type: Object,
        schema: {
          path: String,
          status: String,
          additions: Number,
          deletions: Number,
        },
      },
    ],
  },
};

export const UserMetaSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  sub: String,
  email: String,
  createdAt: String,
  updatedAt: String,
  hasOnboarded: { type: Boolean, required: false },
  creditUsd: { type: Number, required: false },
  signupIp: { type: String, required: false },
  signupCountry: { type: String, required: false },
  signupCity: { type: String, required: false },
  persona: { type: String, required: false },
});

export const CreditEventSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  creditEventId: String,
  sub: String,
  type: String,
  amountUsd: Number,
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
  // Without this, Dynamoose (saveUnknown:false) silently drops `model` on write,
  // so every usage event lands model-less and gets attributed to the default provider.
  model: { type: String, required: false },
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
  createdAt: String,
  updatedAt: String,
  gsi1pk: {
    type: String,
    index: [{ name: 'gsi1', type: 'global', rangeKey: 'gsi1sk' }],
  },
  gsi1sk: String,
  projectId: { type: String, required: false },
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
  model: { type: String, required: false },
  starred: { type: Boolean, required: false },
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
  commitSha: { type: String, required: false },
  branchName: { type: String, required: false },
  commitMessage: { type: String, required: false },
  diffSummary: { type: Object, required: false, schema: DIFF_SUMMARY_SCHEMA },
  agentStatus: { type: String, required: false },
  imported: { type: Boolean, required: false },
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

export const ProjectSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  projectId: String,
  name: String,
  repoRef: {
    type: Object,
    schema: {
      provider: String,
      owner: String,
      repo: String,
      defaultBranch: String,
      url: String,
    },
  },
  plugins: { type: Array, schema: [String] },
  sessionId: String,
  createdAt: String,
  updatedAt: String,
});

export const AgentRunSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  nodeId: String,
  status: String,
  events: String,
  commitSha: { type: String, required: false },
  branchName: { type: String, required: false },
  commitMessage: { type: String, required: false },
  diffSummary: { type: Object, required: false, schema: DIFF_SUMMARY_SCHEMA },
  createdAt: String,
  updatedAt: String,
});
