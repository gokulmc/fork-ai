import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBranchNodeDto } from './create-branch-node.dto';

async function errorsFor(branchName: unknown): Promise<number> {
  const dto = plainToInstance(CreateBranchNodeDto, { parentNodeId: 'p1', branchName });
  const errors = await validate(dto);
  return errors.length;
}

describe('CreateBranchNodeDto', () => {
  it.each(['feature/retry-logic', 'fix-bug', 'v1.2.3', 'ns/sub_branch-01'])(
    'accepts git-ref-safe branch name %s',
    async (branchName) => {
      expect(await errorsFor(branchName)).toBe(0);
    },
  );

  it.each([
    'has spaces',
    'has:colon',
    'has~tilde',
    'has^caret',
    'has*asterisk',
    'emoji🚀branch',
    '',
  ])('rejects invalid branch name %j', async (branchName) => {
    expect(await errorsFor(branchName)).toBeGreaterThan(0);
  });

  it('rejects a branch name over 100 characters', async () => {
    expect(await errorsFor('a'.repeat(101))).toBeGreaterThan(0);
  });
});
