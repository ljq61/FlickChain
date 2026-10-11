import { describe, expect, it } from 'vitest';
import { generateBattle, generateBattleRefill, generateOpening, OPENING_START_Z } from '../../src/content/BattleGenerator';
import { validateLevel } from '../../src/content/LevelValidator';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { CoinTransform } from '../../src/types/contracts';
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
describe('random battle board', () => {
  it('validates 400 nine-coin random layouts and covers both tables, coin kinds and every cup count', () => {
    const tables = new Set(), kinds = new Set(), cups = new Set();
    for (let seed = 1; seed <= 400; seed++) {
      const level = generateBattle(seeded(seed * 9187));
      expect(validateLevel(level)).toEqual(level);
      expect(level.coins).toHaveLength(9);
      expect(level.obstacles.length).toBeGreaterThanOrEqual(1);
      expect(level.obstacles.length).toBeLessThanOrEqual(5);
      expect(level.obstacles.every((cup) => cup.kind === 'glass')).toBe(true);
      tables.add(level.table.materialId); cups.add(level.obstacles.length);
      level.coins.forEach((coin) => kinds.add(coin.materialId));
    }
    expect(tables.size).toBe(2); expect(kinds.size).toBe(2); expect(cups.size).toBe(5);
  });
  it.each([0, 0.5, 1, -1, 2])('uses bounded fallback for a constant RNG of %s', (value) => {
    let calls = 0;
    const level = generateBattle(() => { calls++; return value; });
    expect(validateLevel(level)).toEqual(level);
    expect(level.coins).toHaveLength(9);
    expect(calls).toBeLessThan(3000);
  });
  it('preserves an edge survivor, table and cups exactly when filling to nine, without mutating inputs', () => {
    const level = generateBattle(seeded(456));
    const survivor: CoinTransform = { id: level.coins[0].id, materialId: 'iron', position: { x: 0.799, y: 0.004, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const original = structuredClone({ level, survivor });
    const refill = generateBattleRefill(level, [survivor], () => 1);
    expect(refill.coins).toHaveLength(9);
    expect(refill.coins[0]).toEqual({ id: survivor.id, materialId: 'iron', x: 0.799, z: 0 });
    expect(refill.table).toEqual(level.table); expect(refill.obstacles).toEqual(level.obstacles);
    expect({ level, survivor }).toEqual(original);
    expect(validateLevel(refill, new Set([survivor.id]), new Set(level.obstacles.map((cup) => cup.id)))).toEqual(refill);
    expect(refill.coins.slice(1).every((coin) => !level.coins.some((old) => old.id === coin.id))).toBe(true);
    expect(generateBattleRefill(level, [], () => 0).coins).toHaveLength(9);
  });
  it('uses the exact same bottom-side gold start for both opening attempts', async () => {
    for (const materialId of ['wood', 'marble'] as const) {
      const table = { shape: 'circle' as const, width: 1.6, depth: 1.6, materialId };
      const first = generateOpening(table), second = generateOpening(table);
      expect(first.table).toEqual(second.table);
      expect(first.coins[0]).toMatchObject({ x: 0, z: OPENING_START_Z, materialId: 'standard' });
      expect(second.coins[0]).toMatchObject({ x: 0, z: OPENING_START_Z, materialId: 'standard' });
      expect(first.obstacles).toEqual([]); expect(first.purpose).toBe('opening');
      const world = await PhysicsWorld.create(first);
      try { expect(world.isSettled()).toBe(true); } finally { world.dispose(); }
    }
  });
  it('starts ten random battle layouts settled in production Rapier without contact or fall', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const world = await PhysicsWorld.create(generateBattle(seeded(seed * 991)));
      try {
        expect(world.isSettled()).toBe(true);
        for (let step = 0; step < 60; step++) {
          const events = world.step(); expect(events.contacts).toEqual([]); expect(events.fallenCoinIds).toEqual([]);
        }
      } finally { world.dispose(); }
    }
  }, 10000);
  it('rejects nonfinite RNG and invalid retained coins rather than generating malformed layouts', () => {
    expect(() => generateBattle(() => NaN)).toThrow(/随机数/);
    expect(() => generateBattle(() => Infinity)).toThrow(/随机数/);
    const level = generateBattle(() => 0);
    const bad = { id: 'bad', materialId: 'iron', position: { x: 0.8, y: 0.004, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } as CoinTransform;
    expect(() => generateBattleRefill(level, [bad])).toThrow(/无效/);
    expect(() => generateBattleRefill(level, [bad, bad])).toThrow(/只能保留/);
  });
});
