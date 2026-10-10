import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/content/levels';
import { validateLevel } from '../../src/content/LevelValidator';

const sample = () => structuredClone(LEVELS[0]);
describe('level validation', () => {
  it('loads five unique wood/standard stages with a 2/2/3/4/5 coin progression', () => {
    expect(LEVELS.map((level) => level.coins.length)).toEqual([2, 2, 3, 4, 5]);
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(5);
    for (const level of LEVELS) expect(validateLevel(level)).toEqual(level);
  });
  it('rejects duplicate stable IDs, including coin/obstacle collisions', () => {
    const level = sample(); level.coins[1].id = level.coins[0].id;
    expect(() => validateLevel(level)).toThrow(/重复 ID/);
    const another = sample(); another.obstacles = [{ id: 'a', x: 0, z: -0.3, width: 0.1, depth: 0.1 }];
    expect(() => validateLevel(another)).toThrow(/重复 ID/);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite coordinates (%s)', (invalid) => {
    const level = sample(); level.coins[0].x = invalid;
    expect(() => validateLevel(level)).toThrow(/有限数字/);
  });
  it('rejects unknown material and missing active-coin references', () => {
    expect(() => validateLevel({ ...sample(), table: { width: 1.2, depth: 1.6, materialId: 'ice' } })).toThrow(/未知桌面材质/);
    const level = sample();
    expect(() => validateLevel({ ...level, coins: [{ ...level.coins[0], materialId: 'gold' }, level.coins[1]] })).toThrow(/未知硬币材质/);
    level.activeCoinId = 'missing'; expect(() => validateLevel(level)).toThrow(/存在的硬币/);
  });
  it('rejects coin overlap, edge placements, and a one-coin pseudo-level', () => {
    const level = sample(); level.coins[1].x = level.coins[0].x;
    expect(() => validateLevel(level)).toThrow(/重叠/);
    level.coins[1].x = 0.59; expect(() => validateLevel(level)).toThrow(/越界/);
    level.coins.pop(); expect(() => validateLevel(level)).toThrow(/至少需要两枚/);
  });
  it('rejects malformed schema, unknown keys and non-positive dimensions', () => {
    expect(() => validateLevel({ ...sample(), schemaVersion: 2 })).toThrow(/版本/);
    expect(() => validateLevel({ ...sample(), owner: 'player1' })).toThrow(/未知字段/);
    expect(() => validateLevel({ ...sample(), table: { width: 0, depth: 1, materialId: 'wood' } })).toThrow(/大于零/);
    expect(() => validateLevel({ ...sample(), coins: null })).toThrow(/数组/);
  });
  it('checks rotated obstacle footprint against coins, other obstacles and table edges', () => {
    const level = sample();
    level.obstacles = [{ id: 'box', x: -0.2, z: 0.1, width: 0.2, depth: 0.08, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/重叠/);
    level.obstacles = [{ id: 'box', x: 0.53, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/越界/);
    level.obstacles = [{ id: 'box1', x: 0, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 },
      { id: 'box2', x: 0.05, z: -0.4, width: 0.1, depth: 0.15, rotation: -Math.PI / 6 }];
    expect(() => validateLevel(level)).toThrow(/重叠/);
    level.obstacles = [{ id: 'box', x: 0, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 }];
    expect(validateLevel(level).obstacles.length).toBe(1);
  });
  it('uses the same positive-yaw geometry as Rapier for asymmetric rotated boxes', () => {
    const level = sample(); level.coins[0] = { id: 'a', x: 0.085, z: -0.385, materialId: 'standard' };
    level.obstacles = [{ id: 'box', x: 0, z: -0.3, width: 0.3, depth: 0.025, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/重叠/);
    level.coins[0].z = -0.215; expect(() => validateLevel(level)).not.toThrow();
  });
});
