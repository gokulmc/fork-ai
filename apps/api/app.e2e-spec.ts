// Set env vars before any imports so ConfigModule validation passes
process.env['COGNITO_USER_POOL_ID'] = 'ap-south-1_TESTPOOL';
process.env['COGNITO_CLIENT_ID'] = 'test-client-id';
process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
process.env['DYNAMO_TABLE_NAME'] = 'forkai-main-test';

// jwks-rsa uses the ESM-only 'jose' package; mock it to avoid transform issues in tests
jest.mock('jwks-rsa', () => ({
  passportJwtSecret: jest.fn(() => (_header: unknown, done: (err: Error | null, secret?: string) => void) => {
    done(null, 'test-secret');
  }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';

// Stub guard: always allows requests so we can test the routing/business layer
class AlwaysAllowGuard {
  canActivate() { return true; }
}

// Cognito user injected by the guard stub
const TEST_USER = { sub: 'test-sub-abc', email: 'test@example.com' };

const mockDb = {
  put: jest.fn(),
  get: jest.fn(),
  query: jest.fn(),
  queryGsi: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  batchDelete: jest.fn(),
};

const mockLlm = {
  answerQuery: jest.fn(),
  expandSection: jest.fn(),
  followUpFromHighlight: jest.fn(),
};

const LLM_RESULT = {
  title: 'Neural Networks',
  emoji: '🧠',
  lede: 'The basics of neural networks.',
  sections: [
    { heading: 'What is a neuron?', body: 'A neuron receives inputs...' },
    { heading: 'Activation functions', body: 'Sigmoid, ReLU, and tanh...' },
  ],
};

describe('fork.ai e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Bypass the JWT guard before compiling so passport.authenticate is never called
    jest.spyOn(JwtAuthGuard.prototype, 'canActivate').mockImplementation(() => true);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DynamoRepository)
      .useValue(mockDb)
      .overrideProvider(LlmService)
      .useValue(mockLlm)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    // Inject a fake user so @CurrentUser() returns something meaningful
    app.use((req: any, _res: any, next: any) => {
      req.user = TEST_USER;
      next();
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Sessions ────────────────────────────────────────────────────────────────

  describe('POST /sessions', () => {
    it('creates a session and returns the full session with root node', async () => {
      mockLlm.answerQuery.mockResolvedValue(LLM_RESULT);
      mockDb.put.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .send({ query: 'How do neural networks work?' })
        .expect(201);

      expect(res.body.title).toBe('Neural Networks');
      expect(res.body.nodes).toHaveLength(1);
      expect(res.body.nodes[0].kind).toBe('QUERY');
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('How do neural networks work?', 5);
    });

    it('returns 400 when query is missing', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({})
        .expect(400);
    });

    it('returns 400 when query is shorter than 3 chars', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({ query: 'Hi' })
        .expect(400);
    });
  });

  describe('GET /sessions', () => {
    it('returns a list of session summaries', async () => {
      const fakeMeta = {
        SK: 'SESSION#sess1',
        sessionId: 'sess1',
        title: 'ML Basics',
        emoji: '🤖',
        lede: 'Learning basics.',
        createdAt: '2026-05-17T10:00:00Z',
        updatedAt: '2026-05-17T10:05:00Z',
        nodeCount: 3,
      };
      mockDb.queryGsi.mockResolvedValue([fakeMeta]);

      const res = await request(app.getHttpServer())
        .get('/sessions')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].sessionId).toBe('sess1');
      expect(res.body[0].nodeCount).toBe(3);
    });
  });

  describe('GET /sessions/:sessionId', () => {
    it('returns 404 when session does not exist', async () => {
      mockDb.get.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/sessions/non-existent-id')
        .expect(404);
    });

    it('returns the full session', async () => {
      const sessionMeta = {
        sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l',
        createdAt: '2026-05-17T10:00:00Z', updatedAt: '2026-05-17T10:00:00Z', nodeCount: 1,
      };
      mockDb.get.mockResolvedValue(sessionMeta);
      mockDb.query.mockResolvedValue([
        { SK: 'NODE#n1', nodeId: 'n1' },
      ]);

      const res = await request(app.getHttpServer())
        .get('/sessions/sess1')
        .expect(200);

      expect(res.body.sessionId).toBe('sess1');
      expect(res.body.nodes).toHaveLength(1);
      expect(res.body.annotations).toHaveLength(0);
    });
  });

  describe('PATCH /sessions/:sessionId', () => {
    it('renames a session', async () => {
      mockDb.get.mockResolvedValue({ sessionId: 'sess1' });
      mockDb.update.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .patch('/sessions/sess1')
        .send({ title: 'New Session Name' })
        .expect(200);

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('returns 400 when title exceeds max length', async () => {
      await request(app.getHttpServer())
        .patch('/sessions/sess1')
        .send({ title: 'x'.repeat(101) })
        .expect(400);
    });
  });

  describe('DELETE /sessions/:sessionId', () => {
    it('deletes the session and returns 204', async () => {
      mockDb.get.mockResolvedValue({ sessionId: 'sess1' });
      mockDb.query.mockResolvedValue([{ PK: 'SESSION#sess1', SK: 'NODE#n1' }]);
      mockDb.batchDelete.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/sessions/sess1')
        .expect(204);
    });
  });

  // ── Nodes ───────────────────────────────────────────────────────────────────

  describe('POST /sessions/:sessionId/nodes', () => {
    const SESSION_META = {
      sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l',
      createdAt: '2026-05-17T10:00:00Z', updatedAt: '2026-05-17T10:00:00Z', nodeCount: 1,
    };
    const PARENT_NODE = {
      PK: 'SESSION#sess1', SK: 'NODE#parent1', nodeId: 'parent1', query: 'Root query',
    };

    it('creates a DEEPER node', async () => {
      mockDb.get
        .mockResolvedValueOnce(SESSION_META) // getSession call
        .mockResolvedValueOnce(PARENT_NODE);  // parent node lookup
      mockLlm.expandSection.mockResolvedValue(LLM_RESULT);
      mockDb.put.mockResolvedValue(undefined);
      mockDb.update.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/sessions/sess1/nodes')
        .send({
          kind: 'DEEPER',
          parentNodeId: 'parent1',
          fromSection: 'sec-1',
          query: 'Backpropagation',
          sectionBody: 'Backprop is the algorithm...',
        })
        .expect(201);

      expect(res.body.kind).toBe('DEEPER');
      expect(res.body.title).toBe('Neural Networks');
      expect(mockLlm.expandSection).toHaveBeenCalled();
    });

    it('creates an ASK node from a highlight', async () => {
      mockDb.get
        .mockResolvedValueOnce(SESSION_META)
        .mockResolvedValueOnce(PARENT_NODE);
      mockLlm.followUpFromHighlight.mockResolvedValue(LLM_RESULT);
      mockDb.put.mockResolvedValue(undefined);
      mockDb.update.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/sessions/sess1/nodes')
        .send({
          kind: 'ASK',
          parentNodeId: 'parent1',
          fromSection: 'sec-1',
          query: 'Why does gradient descent work?',
          highlightText: 'gradient descent minimizes loss',
        })
        .expect(201);

      expect(res.body.kind).toBe('ASK');
      expect(mockLlm.followUpFromHighlight).toHaveBeenCalled();
    });

    it('returns 400 for an invalid kind', async () => {
      await request(app.getHttpServer())
        .post('/sessions/sess1/nodes')
        .send({ kind: 'UNKNOWN', parentNodeId: 'p1', fromSection: 's1', query: 'q' })
        .expect(400);
    });
  });

  describe('PATCH /sessions/:sessionId/nodes/:nodeId', () => {
    it('renames a node', async () => {
      const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 1 };
      mockDb.get
        .mockResolvedValueOnce(SESSION_META)
        .mockResolvedValueOnce({ nodeId: 'n1', title: 'Old' });
      mockDb.update.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .patch('/sessions/sess1/nodes/n1')
        .send({ title: 'New Name' })
        .expect(200);
    });
  });

  describe('DELETE /sessions/:sessionId/nodes/:nodeId', () => {
    it('deletes a branch and returns 204', async () => {
      const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 3 };
      mockDb.get.mockResolvedValue(SESSION_META);
      const allNodes = [
        { nodeId: 'n1', parentId: null, SK: 'NODE#n1' },
        { nodeId: 'n2', parentId: 'n1', SK: 'NODE#n2' },
      ];
      mockDb.query
        .mockResolvedValueOnce(allNodes)  // getSession's query (loads all items)
        .mockResolvedValueOnce(allNodes)  // deleteBranch's query for NODE# (all nodes in session)
        .mockResolvedValueOnce([]);        // deleteBranch's query for ANN/HL items
      mockDb.batchDelete.mockResolvedValue(undefined);
      mockDb.update.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/sessions/sess1/nodes/n1')
        .expect(204);
    });
  });

  // ── Annotations ─────────────────────────────────────────────────────────────

  describe('POST /sessions/:sessionId/annotations', () => {
    const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 1 };

    it('creates a note annotation', async () => {
      mockDb.get.mockResolvedValue(SESSION_META);
      mockDb.query.mockResolvedValue([{ SK: 'NODE#n1', nodeId: 'n1' }]);
      mockDb.put.mockResolvedValue(undefined);
      mockDb.update.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/sessions/sess1/annotations')
        .send({
          kind: 'note',
          text: 'This is a highlighted passage.',
          fromTitle: 'Neural Networks',
          nodeId: 'n1',
          sectionId: 'sec-1',
        })
        .expect(201);

      expect(res.body.kind).toBe('note');
      expect(res.body.annId).toBeDefined();
    });

    it('returns 400 for an invalid kind', async () => {
      await request(app.getHttpServer())
        .post('/sessions/sess1/annotations')
        .send({ kind: 'bookmark', text: 't', fromTitle: 'f', nodeId: 'n', sectionId: 's' })
        .expect(400);
    });
  });

  describe('GET /sessions/:sessionId/annotations', () => {
    it('returns all annotations for the session', async () => {
      const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 1 };
      mockDb.get.mockResolvedValue(SESSION_META);
      mockDb.query
        .mockResolvedValueOnce([{ SK: 'NODE#n1', nodeId: 'n1' }]) // getSession query
        .mockResolvedValueOnce([{ SK: 'ANN#a1', annId: 'a1', kind: 'note', text: 'text' }]); // annotations query

      const res = await request(app.getHttpServer())
        .get('/sessions/sess1/annotations')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── Highlights ───────────────────────────────────────────────────────────────

  describe('POST /sessions/:sessionId/highlights', () => {
    const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 1 };

    it('creates a highlight mark', async () => {
      mockDb.get.mockResolvedValue(SESSION_META);
      mockDb.query.mockResolvedValue([{ SK: 'NODE#n1', nodeId: 'n1' }]);
      mockDb.put.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/sessions/sess1/highlights')
        .send({
          nodeId: 'n1',
          sectionId: 'sec-1',
          text: 'gradient descent',
          bg: '#fef08a',
        })
        .expect(201);

      expect(res.body.hlId).toBeDefined();
      expect(res.body.bg).toBe('#fef08a');
    });
  });

  describe('DELETE /sessions/:sessionId/highlights/:hlId', () => {
    it('deletes a highlight and returns 204', async () => {
      const SESSION_META = { sessionId: 'sess1', title: 'ML', emoji: '🤖', lede: 'l', createdAt: 'c', updatedAt: 'u', nodeCount: 1 };
      mockDb.get
        .mockResolvedValueOnce(SESSION_META) // getSession
        .mockResolvedValueOnce({ SK: 'NODE#n1', nodeId: 'n1' }) // inner getSession query
        .mockResolvedValueOnce({ hlId: 'h1' }); // highlight lookup
      mockDb.query.mockResolvedValue([{ SK: 'NODE#n1', nodeId: 'n1' }]);
      mockDb.delete.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/sessions/sess1/highlights/h1')
        .expect(204);
    });
  });
});
