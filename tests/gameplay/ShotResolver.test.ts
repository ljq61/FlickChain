import { describe, expect, it } from 'vitest';
import { certainFouls, resolveShot } from '../../src/gameplay/ShotResolver';
import type { ShotFacts } from '../../src/types/contracts';
const facts = (contacts: [string, string][] = [], fallenCoinIds: string[] = [], timedOut = false): ShotFacts => ({ sourceCoinId: 'A', contacts, fallenCoinIds, timedOut });
describe('whole-shot public-coin rules', () => {
  it('deduplicates repeated A–B contact into exactly one point', () => {
    expect(resolveShot(facts([['A', 'B'], ['B', 'A'], ['A', 'B']]))).toEqual({ outcome: 'SUCCESS', sourceCoinId: 'A', targetCoinId: 'B', reasons: [] });
  });
  it('allows downstream B–C/D chain contacts after a single A–B target', () => {
    expect(resolveShot(facts([['A', 'B'], ['B', 'C'], ['C', 'D']]))).toEqual({ outcome: 'SUCCESS', sourceCoinId: 'A', targetCoinId: 'B', reasons: [] });
    expect(resolveShot(facts([['A', 'B'], ['B', 'D'], ['D', 'C']]))).toEqual({ outcome: 'SUCCESS', sourceCoinId: 'A', targetCoinId: 'B', reasons: [] });
  });
  it('counts multiple direct source targets as multi-hit', () => {
    expect(resolveShot(facts([['A', 'C'], ['A', 'B']])).reasons).toEqual(['MULTI_HIT']);
  });
  it('fails even when a non-source coin falls after a valid contact', () => {
    expect(resolveShot(facts([['A', 'B']], ['C']))).toMatchObject({ outcome: 'FOUL', reasons: ['FALL'] });
  });
  it('retains all reasons and does not announce MISS before settlement', () => {
    expect(certainFouls(facts())).toEqual([]);
    expect(resolveShot(facts([], ['A'], true)).reasons).toEqual(['MISS', 'FALL', 'TIMEOUT']);
  });
});
