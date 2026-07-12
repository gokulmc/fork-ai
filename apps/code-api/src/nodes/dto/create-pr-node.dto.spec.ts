import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePrNodeDto } from './create-pr-node.dto';

async function errorsFor(body: Record<string, unknown>): Promise<number> {
  const dto = plainToInstance(CreatePrNodeDto, { sourceNodeId: 'src1', targetNodeId: 'tgt1', ...body });
  const errors = await validate(dto);
  return errors.length;
}

describe('CreatePrNodeDto', () => {
  it('accepts a valid source/target pair', async () => {
    expect(await errorsFor({})).toBe(0);
  });

  it('rejects an empty sourceNodeId', async () => {
    expect(await errorsFor({ sourceNodeId: '' })).toBeGreaterThan(0);
  });

  it('rejects an empty targetNodeId', async () => {
    expect(await errorsFor({ targetNodeId: '' })).toBeGreaterThan(0);
  });

  it('rejects a missing sourceNodeId', async () => {
    expect(await errorsFor({ sourceNodeId: undefined })).toBeGreaterThan(0);
  });
});
