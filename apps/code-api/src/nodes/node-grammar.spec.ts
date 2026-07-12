import { BadRequestException } from '@nestjs/common';
import { NodeKind } from '@/llm/llm.types';
import { ALLOWED_CHILD_KINDS, assertKindAllowed, LEARN_KINDS } from './node-grammar';

const ALL_KINDS: NodeKind[] = ['QUERY', 'DEEPER', 'ASK', 'MIX', 'PLAN', 'CODE', 'BRANCH', 'MERGE'];

describe('node-grammar', () => {
  it('LEARN_KINDS is exactly the four research kinds', () => {
    expect(LEARN_KINDS.sort()).toEqual(['ASK', 'DEEPER', 'MIX', 'QUERY']);
  });

  // Full matrix: every (parent, child) pair either matches ALLOWED_CHILD_KINDS
  // (assertKindAllowed passes) or doesn't (assertKindAllowed throws 400). This
  // is the single source of truth for the grammar — any future change to
  // ALLOWED_CHILD_KINDS is automatically re-verified against every combination.
  describe.each(ALL_KINDS)('parent kind %s', (parentKind) => {
    it.each(ALL_KINDS)('child kind %s', (childKind) => {
      const isAllowed = ALLOWED_CHILD_KINDS[parentKind].includes(childKind);
      if (isAllowed) {
        expect(() => assertKindAllowed(parentKind, childKind)).not.toThrow();
      } else {
        expect(() => assertKindAllowed(parentKind, childKind)).toThrow(BadRequestException);
      }
    });
  });

  it('learn kinds allow DEEPER/ASK/MIX and nothing else', () => {
    for (const parent of LEARN_KINDS) {
      expect(ALLOWED_CHILD_KINDS[parent].sort()).toEqual(['ASK', 'DEEPER', 'MIX']);
    }
  });

  it('PLAN allows CODE/DEEPER/ASK', () => {
    expect(ALLOWED_CHILD_KINDS.PLAN.sort()).toEqual(['ASK', 'CODE', 'DEEPER']);
  });

  it('CODE allows CODE/BRANCH/DEEPER/ASK/QUERY', () => {
    expect(ALLOWED_CHILD_KINDS.CODE.sort()).toEqual(['ASK', 'BRANCH', 'CODE', 'DEEPER', 'QUERY']);
  });

  it('BRANCH allows CODE/DEEPER/ASK', () => {
    expect(ALLOWED_CHILD_KINDS.BRANCH.sort()).toEqual(['ASK', 'CODE', 'DEEPER']);
  });

  it('MERGE allows only CODE', () => {
    expect(ALLOWED_CHILD_KINDS.MERGE).toEqual(['CODE']);
  });

  it('rejects with a message naming both kinds', () => {
    expect(() => assertKindAllowed('BRANCH', 'MIX')).toThrow(/BRANCH/);
  });
});
