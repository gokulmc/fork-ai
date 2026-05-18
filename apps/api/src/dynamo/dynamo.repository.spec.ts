import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from './dynamo.repository';
import { DYNAMO_CLIENT } from './dynamo.module';

const mockSend = jest.fn();
const mockClient = { send: mockSend };
const mockCfg = { get: () => 'test-table' };

describe('DynamoRepository', () => {
  let repo: DynamoRepository;

  beforeEach(async () => {
    mockSend.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamoRepository,
        { provide: DYNAMO_CLIENT, useValue: mockClient },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    repo = module.get<DynamoRepository>(DynamoRepository);
  });

  describe('put', () => {
    it('sends PutCommand with table name', async () => {
      mockSend.mockResolvedValue({});
      await repo.put({ PK: 'USER#1', SK: 'METADATA', name: 'Alice' });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.TableName).toBe('test-table');
      expect(cmd.input.Item.PK).toBe('USER#1');
    });
  });

  describe('get', () => {
    it('returns the item when found', async () => {
      mockSend.mockResolvedValue({ Item: { PK: 'pk', SK: 'sk', data: 42 } });
      const result = await repo.get('pk', 'sk');
      expect(result).toEqual({ PK: 'pk', SK: 'sk', data: 42 });
    });

    it('returns null when item does not exist', async () => {
      mockSend.mockResolvedValue({});
      const result = await repo.get('pk', 'sk');
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('queries by PK only when no skPrefix given', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await repo.query('SESSION#abc');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.KeyConditionExpression).toBe('PK = :pk');
      expect(cmd.input.ExpressionAttributeValues[':sk']).toBeUndefined();
    });

    it('queries with begins_with when skPrefix is given', async () => {
      mockSend.mockResolvedValue({ Items: [{ PK: 'p', SK: 'NODE#1' }] });
      const results = await repo.query('SESSION#abc', 'NODE#');
      expect(cmd(0).input.KeyConditionExpression).toContain('begins_with');
      expect(results).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('builds SET expression for each field', async () => {
      mockSend.mockResolvedValue({});
      await repo.update('pk', 'sk', { title: 'New title', updatedAt: '2026-01-01' });
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toContain('SET');
      expect(cmd.input.UpdateExpression).toContain('#title');
      expect(cmd.input.UpdateExpression).toContain('#updatedAt');
    });
  });

  describe('delete', () => {
    it('sends DeleteCommand with correct key', async () => {
      mockSend.mockResolvedValue({});
      await repo.delete('pk', 'sk');
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ PK: 'pk', SK: 'sk' });
    });
  });

  describe('batchDelete', () => {
    it('does nothing for empty array', async () => {
      await repo.batchDelete([]);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('chunks keys into groups of 25', async () => {
      mockSend.mockResolvedValue({});
      const keys = Array.from({ length: 30 }, (_, i) => ({ pk: `pk${i}`, sk: `sk${i}` }));
      await repo.batchDelete(keys);
      // 30 keys → 2 chunks (25 + 5)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('sends correct DeleteRequest shape', async () => {
      mockSend.mockResolvedValue({});
      await repo.batchDelete([{ pk: 'pk1', sk: 'sk1' }]);
      const sent = mockSend.mock.calls[0][0];
      const requests = sent.input.RequestItems['test-table'];
      expect(requests[0].DeleteRequest.Key).toEqual({ PK: 'pk1', SK: 'sk1' });
    });
  });
});

// Helper to get nth call's command
function cmd(n: number) { return mockSend.mock.calls[n][0]; }
