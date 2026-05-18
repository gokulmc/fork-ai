import * as dynamoose from 'dynamoose';

export const UserMetaSchema = new dynamoose.Schema({
  PK: { type: String, hashKey: true },
  SK: { type: String, rangeKey: true },
  sub: String,
  email: String,
  createdAt: String,
  updatedAt: String,
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
  bg: { type: String, required: false },
  fg: { type: String, required: false },
  createdAt: String,
});
