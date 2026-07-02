import { Test, TestingModule } from '@nestjs/testing';
import { DynamoRepository } from './dynamo.repository';
import {
  DYNAMO_TABLE,
  USER_META_MODEL,
  SESSION_META_MODEL,
  NODE_MODEL,
  ANNOTATION_MODEL,
  HIGHLIGHT_MODEL,
  SHARE_TOKEN_MODEL,
  USAGE_EVENT_MODEL,
  PAYMENT_MODEL,
  ADMIN_AUDIT_MODEL,
  REFERRAL_MODEL,
  CREDIT_EVENT_MODEL,
  BLOG_SUBMISSION_MODEL,
  BLOG_VIEW_MODEL,
  TRIAL_SPEND_MODEL,
  PAGE_VIEW_MODEL,
} from './dynamo.constants';

// Factory for a Dynamoose-model-shaped mock with chainable query builder
function makeModelMock() {
  const mock = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    batchDelete: jest.fn(),
    query: jest.fn(),
  };
  // query().eq().using().sort().where().beginsWith().limit().all().exec() chain
  const queryChain = { eq: jest.fn(), using: jest.fn(), sort: jest.fn(), exec: jest.fn(), where: jest.fn(), beginsWith: jest.fn(), limit: jest.fn(), all: jest.fn() };
  queryChain.eq.mockReturnValue(queryChain);
  queryChain.using.mockReturnValue(queryChain);
  queryChain.sort.mockReturnValue(queryChain);
  queryChain.where.mockReturnValue(queryChain);
  queryChain.beginsWith.mockReturnValue(queryChain);
  queryChain.limit.mockReturnValue(queryChain);
  queryChain.all.mockReturnValue(queryChain);
  queryChain.exec.mockResolvedValue([]);
  mock.query.mockReturnValue(queryChain);
  return { mock, queryChain };
}

const SUB = 'user-123';
const SESSION_ID = 'sess-abc';
const NODE_ID = 'node-xyz';

describe('DynamoRepository', () => {
  let repo: DynamoRepository;
  let userMeta: ReturnType<typeof makeModelMock>;
  let sessionMeta: ReturnType<typeof makeModelMock>;
  let node: ReturnType<typeof makeModelMock>;
  let annotation: ReturnType<typeof makeModelMock>;
  let highlight: ReturnType<typeof makeModelMock>;
  let shareToken: ReturnType<typeof makeModelMock>;
  let usageEvent: ReturnType<typeof makeModelMock>;
  let payment: ReturnType<typeof makeModelMock>;
  let adminAudit: ReturnType<typeof makeModelMock>;
  let referral: ReturnType<typeof makeModelMock>;
  let creditEvent: ReturnType<typeof makeModelMock>;
  let blogSubmission: ReturnType<typeof makeModelMock>;
  let blogView: ReturnType<typeof makeModelMock>;
  let trialSpend: ReturnType<typeof makeModelMock>;
  let pageView: ReturnType<typeof makeModelMock>;

  beforeEach(async () => {
    userMeta = makeModelMock();
    sessionMeta = makeModelMock();
    node = makeModelMock();
    annotation = makeModelMock();
    highlight = makeModelMock();
    shareToken = makeModelMock();
    usageEvent = makeModelMock();
    payment = makeModelMock();
    adminAudit = makeModelMock();
    referral = makeModelMock();
    creditEvent = makeModelMock();
    blogSubmission = makeModelMock();
    blogView = makeModelMock();
    trialSpend = makeModelMock();
    pageView = makeModelMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamoRepository,
        { provide: DYNAMO_TABLE, useValue: 'test-table' },
        { provide: USER_META_MODEL, useValue: userMeta.mock },
        { provide: SESSION_META_MODEL, useValue: sessionMeta.mock },
        { provide: NODE_MODEL, useValue: node.mock },
        { provide: ANNOTATION_MODEL, useValue: annotation.mock },
        { provide: HIGHLIGHT_MODEL, useValue: highlight.mock },
        { provide: SHARE_TOKEN_MODEL, useValue: shareToken.mock },
        { provide: USAGE_EVENT_MODEL, useValue: usageEvent.mock },
        { provide: PAYMENT_MODEL, useValue: payment.mock },
        { provide: ADMIN_AUDIT_MODEL, useValue: adminAudit.mock },
        { provide: REFERRAL_MODEL, useValue: referral.mock },
        { provide: CREDIT_EVENT_MODEL, useValue: creditEvent.mock },
        { provide: BLOG_SUBMISSION_MODEL, useValue: blogSubmission.mock },
        { provide: BLOG_VIEW_MODEL, useValue: blogView.mock },
        { provide: TRIAL_SPEND_MODEL, useValue: trialSpend.mock },
        { provide: PAGE_VIEW_MODEL, useValue: pageView.mock },
      ],
    }).compile();
    repo = module.get<DynamoRepository>(DynamoRepository);
  });

  describe('getUserMeta', () => {
    it('returns null when not found', async () => {
      userMeta.mock.get.mockResolvedValue(null);
      const result = await repo.getUserMeta(SUB);
      expect(result).toBeNull();
    });

    it('returns plain item when found', async () => {
      userMeta.mock.get.mockResolvedValue({ PK: `USER#${SUB}`, SK: 'METADATA', email: 'a@b.com' });
      const result = await repo.getUserMeta(SUB);
      expect(result?.email).toBe('a@b.com');
    });
  });

  describe('putUserMeta', () => {
    it('calls create with cleaned data', async () => {
      userMeta.mock.create.mockResolvedValue({});
      await repo.putUserMeta({ PK: `USER#${SUB}`, SK: 'METADATA', sub: SUB, email: 'a@b.com', createdAt: 'now', updatedAt: 'now' });
      expect(userMeta.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ PK: `USER#${SUB}` }),
        { overwrite: true },
      );
    });
  });

  describe('getSessionMeta', () => {
    it('returns null when not found', async () => {
      sessionMeta.mock.get.mockResolvedValue(null);
      const result = await repo.getSessionMeta(SUB, SESSION_ID);
      expect(result).toBeNull();
    });

    it('returns item when found', async () => {
      sessionMeta.mock.get.mockResolvedValue({ PK: `USER#${SUB}`, SK: `SESSION#${SESSION_ID}`, sessionId: SESSION_ID, title: 'T' });
      const result = await repo.getSessionMeta(SUB, SESSION_ID);
      expect(result?.sessionId).toBe(SESSION_ID);
    });
  });

  describe('listSessionMeta', () => {
    it('queries GSI descending and returns items', async () => {
      sessionMeta.queryChain.exec.mockResolvedValue([{ sessionId: SESSION_ID }]);
      const result = await repo.listSessionMeta(SUB);
      expect(sessionMeta.mock.query).toHaveBeenCalledWith('gsi1pk');
      expect(sessionMeta.queryChain.eq).toHaveBeenCalledWith(`USER#${SUB}`);
      expect(result).toHaveLength(1);
    });
  });

  describe('updateSessionMeta', () => {
    it('sends set fields normally', async () => {
      sessionMeta.mock.update.mockResolvedValue({});
      await repo.updateSessionMeta(SUB, SESSION_ID, { title: 'New' });
      expect(sessionMeta.mock.update).toHaveBeenCalledWith(
        { PK: `USER#${SUB}`, SK: `SESSION#${SESSION_ID}` },
        expect.objectContaining({ title: 'New' }),
      );
    });

    it('translates null values into $REMOVE', async () => {
      sessionMeta.mock.update.mockResolvedValue({});
      await repo.updateSessionMeta(SUB, SESSION_ID, { shareToken: null });
      const op = sessionMeta.mock.update.mock.calls[0][1];
      expect(op.$REMOVE).toContain('shareToken');
    });

    it('does nothing when updates object is empty', async () => {
      await repo.updateSessionMeta(SUB, SESSION_ID, {});
      expect(sessionMeta.mock.update).not.toHaveBeenCalled();
    });
  });

  describe('putNode', () => {
    it('creates node with overwrite', async () => {
      node.mock.create.mockResolvedValue({});
      await repo.putNode({ PK: `SESSION#${SESSION_ID}`, SK: `NODE#${NODE_ID}`, nodeId: NODE_ID, kind: 'QUERY', title: 'T', query: 'Q', lede: 'L', sections: [], createdAt: 'now' });
      expect(node.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: NODE_ID }),
        { overwrite: true },
      );
    });
  });

  describe('getNode', () => {
    it('returns null when not found', async () => {
      node.mock.get.mockResolvedValue(null);
      expect(await repo.getNode(SESSION_ID, NODE_ID)).toBeNull();
    });

    it('returns item when found', async () => {
      node.mock.get.mockResolvedValue({ nodeId: NODE_ID });
      const result = await repo.getNode(SESSION_ID, NODE_ID);
      expect(result?.nodeId).toBe(NODE_ID);
    });
  });

  describe('queryNodes', () => {
    it('queries PK beginsWith NODE#', async () => {
      node.queryChain.exec.mockResolvedValue([{ nodeId: NODE_ID }]);
      const result = await repo.queryNodes(SESSION_ID);
      expect(node.mock.query).toHaveBeenCalledWith('PK');
      expect(node.queryChain.beginsWith).toHaveBeenCalledWith('NODE#');
      expect(result).toHaveLength(1);
    });

    // REGRESSION: must paginate past DynamoDB's 1MB Query limit, else a session
    // over 1MB silently drops its newest nodes on load (rendered after creation,
    // gone on refresh).
    it('paginates with .all() so large sessions are fully loaded', async () => {
      await repo.queryNodes(SESSION_ID);
      expect(node.queryChain.all).toHaveBeenCalled();
    });
  });

  describe('batchDeleteNodes', () => {
    it('does nothing for empty array', async () => {
      await repo.batchDeleteNodes(SESSION_ID, []);
      expect(node.mock.batchDelete).not.toHaveBeenCalled();
    });

    it('chunks into groups of 25', async () => {
      node.mock.batchDelete.mockResolvedValue({});
      const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
      await repo.batchDeleteNodes(SESSION_ID, ids);
      expect(node.mock.batchDelete).toHaveBeenCalledTimes(2);
    });
  });

  describe('putShareToken / getShareToken / deleteShareToken', () => {
    it('puts a share token record', async () => {
      shareToken.mock.create.mockResolvedValue({});
      await repo.putShareToken('tok123', SESSION_ID, SUB);
      expect(shareToken.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'tok123', sessionId: SESSION_ID }),
        { overwrite: true },
      );
    });

    it('returns null for missing share token', async () => {
      shareToken.mock.get.mockResolvedValue(null);
      expect(await repo.getShareToken('tok')).toBeNull();
    });

    it('deletes share token by value', async () => {
      shareToken.mock.delete.mockResolvedValue({});
      await repo.deleteShareToken('tok123');
      expect(shareToken.mock.delete).toHaveBeenCalledWith({ PK: 'SHARE#tok123', SK: 'METADATA' });
    });
  });
});
