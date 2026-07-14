import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBranchNodeDto } from './create-branch-node.dto';

async function errorsFor(title: unknown): Promise<number> {
  const dto = plainToInstance(CreateBranchNodeDto, { parentNodeId: 'p1', title });
  const errors = await validate(dto);
  return errors.length;
}

describe('CreateBranchNodeDto', () => {
  it.each(['Retry logic for flaky uploads', 'fix bug', 'v1.2.3', 'emoji 🚀 branch'])(
    'accepts free-text title %j — slugifying happens server-side, not here',
    async (title) => {
      expect(await errorsFor(title)).toBe(0);
    },
  );

  it('rejects an empty title', async () => {
    expect(await errorsFor('')).toBeGreaterThan(0);
  });

  it('rejects a non-string title', async () => {
    expect(await errorsFor(42)).toBeGreaterThan(0);
  });

  it('rejects a title over 100 characters', async () => {
    expect(await errorsFor('a'.repeat(101))).toBeGreaterThan(0);
  });
});
