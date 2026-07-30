import { Test, TestingModule } from '@nestjs/testing';
import { DynamoRepository } from './dynamo.repository';
import {
  DYNAMO_TABLE,
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
  GITHUB_INSTALLATION_MODEL,
  HOLD_MODEL,
  MACHINE_BILL_MODEL,
  DEVICE_MODEL,
} from './dynamo.constants';

// Factory for a Dynamoose-model-shaped mock with chainable query/scan builder
function makeModelMock() {
  const mock = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    batchDelete: jest.fn(),
    batchPut: jest.fn(),
    query: jest.fn(),
    scan: jest.fn(),
  };
  // query().eq().using().sort().where().beginsWith().limit().all().exec() chain
  // (scan reuses the same chain shape: .beginsWith().and().where().eq()/.lt().all().exec())
  const queryChain = { eq: jest.fn(), using: jest.fn(), sort: jest.fn(), exec: jest.fn(), where: jest.fn(), beginsWith: jest.fn(), limit: jest.fn(), all: jest.fn(), and: jest.fn(), lt: jest.fn() };
  queryChain.eq.mockReturnValue(queryChain);
  queryChain.using.mockReturnValue(queryChain);
  queryChain.sort.mockReturnValue(queryChain);
  queryChain.where.mockReturnValue(queryChain);
  queryChain.beginsWith.mockReturnValue(queryChain);
  queryChain.limit.mockReturnValue(queryChain);
  queryChain.all.mockReturnValue(queryChain);
  queryChain.and.mockReturnValue(queryChain);
  queryChain.lt.mockReturnValue(queryChain);
  queryChain.exec.mockResolvedValue([]);
  mock.query.mockReturnValue(queryChain);
  mock.scan.mockReturnValue(queryChain);
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
  let usageEvent: ReturnType<typeof makeModelMock>;
  let payment: ReturnType<typeof makeModelMock>;
  let creditEvent: ReturnType<typeof makeModelMock>;
  let project: ReturnType<typeof makeModelMock>;
  let agentRun: ReturnType<typeof makeModelMock>;
  let githubInstallation: ReturnType<typeof makeModelMock>;
  let hold: ReturnType<typeof makeModelMock>;
  let machineBill: ReturnType<typeof makeModelMock>;
  let device: ReturnType<typeof makeModelMock>;

  beforeEach(async () => {
    userMeta = makeModelMock();
    sessionMeta = makeModelMock();
    node = makeModelMock();
    annotation = makeModelMock();
    highlight = makeModelMock();
    usageEvent = makeModelMock();
    payment = makeModelMock();
    creditEvent = makeModelMock();
    project = makeModelMock();
    agentRun = makeModelMock();
    githubInstallation = makeModelMock();
    hold = makeModelMock();
    machineBill = makeModelMock();
    device = makeModelMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamoRepository,
        { provide: DYNAMO_TABLE, useValue: 'test-table' },
        { provide: USER_META_MODEL, useValue: userMeta.mock },
        { provide: SESSION_META_MODEL, useValue: sessionMeta.mock },
        { provide: NODE_MODEL, useValue: node.mock },
        { provide: ANNOTATION_MODEL, useValue: annotation.mock },
        { provide: HIGHLIGHT_MODEL, useValue: highlight.mock },
        { provide: USAGE_EVENT_MODEL, useValue: usageEvent.mock },
        { provide: PAYMENT_MODEL, useValue: payment.mock },
        { provide: CREDIT_EVENT_MODEL, useValue: creditEvent.mock },
        { provide: PROJECT_MODEL, useValue: project.mock },
        { provide: AGENT_RUN_MODEL, useValue: agentRun.mock },
        { provide: GITHUB_INSTALLATION_MODEL, useValue: githubInstallation.mock },
        { provide: HOLD_MODEL, useValue: hold.mock },
        { provide: MACHINE_BILL_MODEL, useValue: machineBill.mock },
        { provide: DEVICE_MODEL, useValue: device.mock },
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

    // REGRESSION: Dynamoose strips a null parentId on write, so a root node
    // round-trips with no parentId property at all — callers that do a strict
    // `=== null` check (SessionsService's fill-root gate) must see null, not
    // undefined, or they misidentify the session as having no root node.
    it('normalizes a missing parentId to null (Dynamoose null-stripping)', async () => {
      node.mock.get.mockResolvedValue({ nodeId: NODE_ID }); // no parentId key at all
      const result = await repo.getNode(SESSION_ID, NODE_ID);
      expect(result?.parentId).toBeNull();
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

    // REGRESSION: same null-stripping gotcha as getNode, but for the list path.
    it('normalizes a missing parentId to null on every returned node', async () => {
      node.queryChain.exec.mockResolvedValue([{ nodeId: NODE_ID }]); // no parentId key
      const result = await repo.queryNodes(SESSION_ID);
      expect(result[0].parentId).toBeNull();
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

  describe('batchPutNodes', () => {
    it('does nothing for empty array', async () => {
      await repo.batchPutNodes([]);
      expect(node.mock.batchPut).not.toHaveBeenCalled();
    });

    it('chunks into groups of 25', async () => {
      node.mock.batchPut.mockResolvedValue({});
      const items = Array.from({ length: 30 }, (_, i) => ({ PK: `SESSION#${SESSION_ID}`, SK: `NODE#n${i}`, nodeId: `n${i}` }));
      await repo.batchPutNodes(items as never);
      expect(node.mock.batchPut).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateNode', () => {
    it('wraps updates in an uppercase $SET (mirrors updateSessionMeta)', async () => {
      node.mock.update.mockResolvedValue({});
      await repo.updateNode(SESSION_ID, NODE_ID, { title: 'New title' });
      expect(node.mock.update).toHaveBeenCalledWith(
        { PK: `SESSION#${SESSION_ID}`, SK: `NODE#${NODE_ID}` },
        { $SET: { title: 'New title' } },
      );
    });

    // REGRESSION: PATCH /sessions/:id/nodes/:nodeId with an `okr` body 500'd
    // with `TypeMismatch: Expected okr to be of type object, instead found
    // type OkrDto`. class-validator's `@Type(() => OkrDto)` hands
    // NodesService.updateNode an OkrDto *class instance*, not a plain
    // object; Dynamoose's Object-type checker does a strict constructor
    // check on nested Object attributes and rejects anything that isn't
    // `Object`, even with the exact right shape. updateNode must strip the
    // DTO prototype (JSON round-trip) before handing the value to Dynamoose.
    it('strips a class-instance prototype off nested Object fields (okr) before calling Dynamoose', async () => {
      node.mock.update.mockResolvedValue({});
      class OkrDto {
        objective = 'Ship the retry logic';
        keyResults = ['p99 < 200ms', 'zero flaky tests'];
      }
      const okrInstance = new OkrDto();
      expect(okrInstance.constructor.name).toBe('OkrDto'); // sanity: not a plain object

      await repo.updateNode(SESSION_ID, NODE_ID, { okr: okrInstance as never });

      const [, updateArg] = node.mock.update.mock.calls[0];
      expect(updateArg.$SET.okr.constructor.name).toBe('Object');
      expect(updateArg.$SET.okr).toEqual({
        objective: 'Ship the retry logic',
        keyResults: ['p99 < 200ms', 'zero flaky tests'],
      });
    });

    it('leaves starred updates working unchanged', async () => {
      node.mock.update.mockResolvedValue({});
      await repo.updateNode(SESSION_ID, NODE_ID, { starred: true });
      expect(node.mock.update).toHaveBeenCalledWith(
        { PK: `SESSION#${SESSION_ID}`, SK: `NODE#${NODE_ID}` },
        { $SET: { starred: true } },
      );
    });
  });

  describe('putProject / getProject / listProjects', () => {
    const PROJECT_ID = 'proj-1';

    it('puts a project with overwrite', async () => {
      project.mock.create.mockResolvedValue({});
      await repo.putProject({
        PK: `USER#${SUB}`, SK: `PROJECT#${PROJECT_ID}`, projectId: PROJECT_ID, name: 'P',
        repoRef: { provider: 'github-mock', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://mock.git/acme/widgets' },
        plugins: [], sessionId: SESSION_ID, createdAt: 'now', updatedAt: 'now',
      });
      expect(project.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID }),
        { overwrite: true },
      );
    });

    it('returns null when project not found', async () => {
      project.mock.get.mockResolvedValue(null);
      expect(await repo.getProject(SUB, PROJECT_ID)).toBeNull();
    });

    it('lists projects for the user', async () => {
      project.queryChain.exec.mockResolvedValue([{ projectId: PROJECT_ID }]);
      const result = await repo.listProjects(SUB);
      expect(project.mock.query).toHaveBeenCalledWith('PK');
      expect(project.queryChain.beginsWith).toHaveBeenCalledWith('PROJECT#');
      expect(result).toHaveLength(1);
    });

    it('bumps branchCount via an uppercase $ADD (same operator as deductCredit/addCredit)', async () => {
      project.mock.update.mockResolvedValue({});
      await repo.incrementProjectBranchCount(SUB, PROJECT_ID, 1);
      expect(project.mock.update).toHaveBeenCalledWith(
        { PK: `USER#${SUB}`, SK: `PROJECT#${PROJECT_ID}` },
        { '$ADD': { branchCount: 1 } },
      );
    });

    it('updateProjectRepo sets repoRef, repoAttachedAt, and updatedAt together', async () => {
      project.mock.update.mockResolvedValue({});
      const repoRef = { provider: 'github' as const, owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets', private: true };
      await repo.updateProjectRepo(SUB, PROJECT_ID, repoRef, '2026-01-01T00:00:00.000Z');
      expect(project.mock.update).toHaveBeenCalledWith(
        { PK: `USER#${SUB}`, SK: `PROJECT#${PROJECT_ID}` },
        { repoRef: { ...repoRef }, repoAttachedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      );
    });
  });

  describe('putAgentRun / getAgentRun / updateAgentRun', () => {
    it('puts an AgentRun with overwrite', async () => {
      agentRun.mock.create.mockResolvedValue({});
      await repo.putAgentRun({ PK: `SESSION#${SESSION_ID}`, SK: `AGENTRUN#${NODE_ID}`, nodeId: NODE_ID, status: 'running', events: '[]', createdAt: 'now', updatedAt: 'now' });
      expect(agentRun.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: NODE_ID, status: 'running' }),
        { overwrite: true },
      );
    });

    it('returns null when no AgentRun exists', async () => {
      agentRun.mock.get.mockResolvedValue(null);
      expect(await repo.getAgentRun(SESSION_ID, NODE_ID)).toBeNull();
    });

    it('updates status and events', async () => {
      agentRun.mock.update.mockResolvedValue({});
      await repo.updateAgentRun(SESSION_ID, NODE_ID, { status: 'done', events: '[]' });
      expect(agentRun.mock.update).toHaveBeenCalledWith(
        { PK: `SESSION#${SESSION_ID}`, SK: `AGENTRUN#${NODE_ID}` },
        { status: 'done', events: '[]' },
      );
    });
  });

  describe('putGithubInstallation / listGithubInstallations', () => {
    it('puts an installation with overwrite', async () => {
      githubInstallation.mock.create.mockResolvedValue({});
      await repo.putGithubInstallation({
        PK: `USER#${SUB}`, SK: 'GHINST#12345', installationId: '12345', accountLogin: 'acme', createdAt: 'now',
      });
      expect(githubInstallation.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ installationId: '12345', accountLogin: 'acme' }),
        { overwrite: true },
      );
    });

    it('lists installations for the user', async () => {
      githubInstallation.queryChain.exec.mockResolvedValue([{ installationId: '12345', accountLogin: 'acme' }]);
      const result = await repo.listGithubInstallations(SUB);
      expect(githubInstallation.mock.query).toHaveBeenCalledWith('PK');
      expect(githubInstallation.queryChain.eq).toHaveBeenCalledWith(`USER#${SUB}`);
      expect(githubInstallation.queryChain.beginsWith).toHaveBeenCalledWith('GHINST#');
      expect(result).toHaveLength(1);
    });
  });

  describe('deductCreditIfSufficient', () => {
    // Money-correctness guard #3 (ADR-0004, fix I1/M1) — atomic
    // check-and-deduct for placeHold's strict pre-auth gate.
    it('deducts and returns true when the condition passes (sufficient balance)', async () => {
      userMeta.mock.update.mockResolvedValue({});
      const result = await repo.deductCreditIfSufficient(SUB, 1.0);
      expect(result).toBe(true);
      expect(userMeta.mock.update).toHaveBeenCalledWith(
        { PK: `USER#${SUB}`, SK: 'METADATA' },
        { '$ADD': { creditUsd: -1.0 } },
        expect.objectContaining({ condition: expect.anything() }),
      );
    });

    it('returns false (not throw) when the condition fails — insufficient balance', async () => {
      const err = Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });
      userMeta.mock.update.mockRejectedValue(err);
      const result = await repo.deductCreditIfSufficient(SUB, 100);
      expect(result).toBe(false);
    });

    // The condition requires creditUsd to EXIST (not just >= amount) — a user
    // whose creditUsd attribute was never set must fail the same way an
    // insufficient balance does, not throw an unhandled error.
    it('returns false (not throw) when creditUsd is entirely absent on the item', async () => {
      const err = Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });
      userMeta.mock.update.mockRejectedValue(err);
      const result = await repo.deductCreditIfSufficient(SUB, 0.01);
      expect(result).toBe(false);
    });

    it('rethrows any other error', async () => {
      userMeta.mock.update.mockRejectedValue(new Error('network blip'));
      await expect(repo.deductCreditIfSufficient(SUB, 1.0)).rejects.toThrow('network blip');
    });
  });

  describe('putHold / getHold', () => {
    it('creates a hold with overwrite', async () => {
      hold.mock.create.mockResolvedValue({});
      await repo.putHold({ PK: `USER#${SUB}`, SK: `HOLD#${NODE_ID}`, sub: SUB, nodeId: NODE_ID, sessionId: SESSION_ID, holdUsd: 1, status: 'held', model: 'm', createdAt: 'now', updatedAt: 'now' });
      expect(hold.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: NODE_ID, status: 'held' }),
        { overwrite: true },
      );
    });

    it('returns null when no hold exists', async () => {
      hold.mock.get.mockResolvedValue(null);
      expect(await repo.getHold(SUB, NODE_ID)).toBeNull();
    });
  });

  describe('reconcileHoldStatus', () => {
    // Money-correctness guard #1 (ADR-0004) — verifies the exact Dynamoose v4
    // conditional-update shape: `model.update(key, updateObj, { condition })`.
    it('flips held→reconciled with a status=held condition and returns true', async () => {
      hold.mock.update.mockResolvedValue({});
      const result = await repo.reconcileHoldStatus(SUB, NODE_ID);
      expect(result).toBe(true);
      expect(hold.mock.update).toHaveBeenCalledWith(
        { PK: `USER#${SUB}`, SK: `HOLD#${NODE_ID}` },
        expect.objectContaining({ status: 'reconciled' }),
        expect.objectContaining({ condition: expect.anything() }),
      );
    });

    it('returns false (not throw) when the condition fails — a concurrent caller already flipped it', async () => {
      const err = Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });
      hold.mock.update.mockRejectedValue(err);
      expect(await repo.reconcileHoldStatus(SUB, NODE_ID)).toBe(false);
    });

    it('rethrows any other error', async () => {
      hold.mock.update.mockRejectedValue(new Error('network blip'));
      await expect(repo.reconcileHoldStatus(SUB, NODE_ID)).rejects.toThrow('network blip');
    });
  });

  describe('putMachineBill', () => {
    // Money-correctness guard #2 (ADR-0004) — verifies `create(item, { overwrite: false })`.
    it('creates with overwrite:false and returns true on success', async () => {
      machineBill.mock.create.mockResolvedValue({});
      const result = await repo.putMachineBill({ PK: `USER#${SUB}`, SK: 'MACHINEBILL#sbx-1', sub: SUB, sandboxId: 'sbx-1', sessionId: SESSION_ID, nodeId: NODE_ID, machineSeconds: 60, costUsd: 0.01, createdAt: 'now' });
      expect(result).toBe(true);
      expect(machineBill.mock.create).toHaveBeenCalledWith(
        expect.objectContaining({ sandboxId: 'sbx-1' }),
        { overwrite: false },
      );
    });

    it('returns false (not throw) when the item already exists', async () => {
      const err = Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });
      machineBill.mock.create.mockRejectedValue(err);
      const result = await repo.putMachineBill({ PK: `USER#${SUB}`, SK: 'MACHINEBILL#sbx-1', sub: SUB, sandboxId: 'sbx-1', sessionId: SESSION_ID, nodeId: NODE_ID, machineSeconds: 60, costUsd: 0.01, createdAt: 'now' });
      expect(result).toBe(false);
    });
  });

  describe('deleteUserPartition', () => {
    it('does nothing when the partition is empty', async () => {
      userMeta.queryChain.exec.mockResolvedValue([]);
      await repo.deleteUserPartition(SUB);
      expect(userMeta.mock.batchDelete).not.toHaveBeenCalled();
    });

    it('queries PK only (no SK filter) and batchDeletes every key found, chunked by 25', async () => {
      const items = Array.from({ length: 30 }, (_, i) => ({ PK: `USER#${SUB}`, SK: `USAGE#u${i}` }));
      userMeta.queryChain.exec.mockResolvedValue(items);
      userMeta.mock.batchDelete.mockResolvedValue({});

      await repo.deleteUserPartition(SUB);

      expect(userMeta.mock.query).toHaveBeenCalledWith('PK');
      expect(userMeta.queryChain.eq).toHaveBeenCalledWith(`USER#${SUB}`);
      expect(userMeta.queryChain.beginsWith).not.toHaveBeenCalled();
      expect(userMeta.mock.batchDelete).toHaveBeenCalledTimes(2);
    });
  });

  describe('scanHeldHolds', () => {
    it('scans SK beginsWith HOLD#, filtered by status=held and updatedAt<cutoff', async () => {
      hold.queryChain.exec.mockResolvedValue([{ sub: SUB, nodeId: NODE_ID, status: 'held' }]);
      const result = await repo.scanHeldHolds('2026-07-13T00:00:00.000Z');
      expect(hold.mock.scan).toHaveBeenCalledWith('SK');
      expect(hold.queryChain.beginsWith).toHaveBeenCalledWith('HOLD#');
      expect(hold.queryChain.eq).toHaveBeenCalledWith('held');
      expect(hold.queryChain.lt).toHaveBeenCalledWith('2026-07-13T00:00:00.000Z');
      expect(result).toHaveLength(1);
    });
  });
});
