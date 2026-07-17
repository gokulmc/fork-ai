import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCodeNodeDto } from './create-code-node.dto';

async function errorsFor(body: Record<string, unknown>): Promise<number> {
  const dto = plainToInstance(CreateCodeNodeDto, { parentNodeId: 'p1', instruction: 'do the thing', ...body });
  const errors = await validate(dto);
  return errors.length;
}

describe('CreateCodeNodeDto', () => {
  it('accepts a 10,000 character instruction', async () => {
    expect(await errorsFor({ instruction: 'a'.repeat(10000) })).toBe(0);
  });

  it('rejects an instruction over 10,000 characters', async () => {
    expect(await errorsFor({ instruction: 'a'.repeat(10001) })).toBeGreaterThan(0);
  });

  it('accepts up to 3 attachments', async () => {
    const attachments = [
      { name: 'a.ts', content: 'const a = 1;' },
      { name: 'b.ts', content: 'const b = 2;' },
      { name: 'c.ts', content: 'const c = 3;' },
    ];
    expect(await errorsFor({ attachments })).toBe(0);
  });

  it('rejects more than 3 attachments', async () => {
    const attachments = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.ts`, content: 'x' }));
    expect(await errorsFor({ attachments })).toBeGreaterThan(0);
  });

  it('rejects an attachment whose content exceeds 65536 characters', async () => {
    const attachments = [{ name: 'big.txt', content: 'a'.repeat(65537) }];
    expect(await errorsFor({ attachments })).toBeGreaterThan(0);
  });

  it('rejects an attachment with an empty name', async () => {
    const attachments = [{ name: '', content: 'x' }];
    expect(await errorsFor({ attachments })).toBeGreaterThan(0);
  });

  it('accepts each valid environment (cloud, mock, blaxel)', async () => {
    expect(await errorsFor({ environment: 'cloud' })).toBe(0);
    expect(await errorsFor({ environment: 'mock' })).toBe(0);
    expect(await errorsFor({ environment: 'blaxel' })).toBe(0);
  });

  it('rejects an unknown environment', async () => {
    expect(await errorsFor({ environment: 'local' })).toBeGreaterThan(0);
    expect(await errorsFor({ environment: 'gcp' })).toBeGreaterThan(0);
  });
});
