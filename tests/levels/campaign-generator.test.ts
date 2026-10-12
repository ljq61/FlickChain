import { describe, expect, it } from 'vitest';
import { generateRound, generateRevival, GLASS_DIAMETER, RETAINED_COIN_EXCLUSION,
  OPENING_TARGET_MIN_DISTANCE, OPENING_TARGET_MAX_DISTANCE } from '../../src/content/CampaignGenerator';
import { coinRadius, PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import { tableClearance } from '../../src/physics/TableGeometry';
import type { CoinConfig, CoinTransform, LevelConfig } from '../../src/types/contracts';
import { validateLevel } from '../../src/content/LevelValidator';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { GameSession } from '../../src/core/GameSession';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function transform(coin: CoinConfig): CoinTransform {
  return { id: coin.id, materialId: coin.materialId, position: { x: coin.x, y: 0.004, z: coin.z },
    rotation: { x: 0, y: 0, z: 0, w: 1 } };
}
function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function segmentDistance(point: { x: number; z: number }, start: CoinConfig, target: CoinConfig): number {
  const length = distance(start, target);
  const forward = ((point.x - start.x) * (target.x - start.x) + (point.z - start.z) * (target.z - start.z)) / length;
  if (forward < 0) return distance(point, start);
  if (forward > length) return distance(point, target);
  return Math.abs((point.x - start.x) * (target.z - start.z) - (point.z - start.z) * (target.x - start.x)) / length;
}
function safeLayout(level: LevelConfig, retained: CoinTransform[] = []): void {
  const retainedIds = new Set(retained.map((coin) => coin.id));
  expect(validateLevel(level, retainedIds)).toEqual(level);
  const ids = [...level.coins, ...level.obstacles].map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(level.coins.some((coin) => coin.id === level.activeCoinId)).toBe(true);
  for (const [index, coin] of level.coins.entries()) {
    const radius = coinRadius(coin.materialId);
    expect(tableClearance(level.table, coin.x, coin.z)).toBeGreaterThan(retainedIds.has(coin.id) ? 0 : radius + PHYSICS_CONFIG.initialClearance);
    for (const other of level.coins.slice(index + 1)) {
      expect(distance(coin, other)).toBeGreaterThan(radius + coinRadius(other.materialId) + PHYSICS_CONFIG.initialClearance);
    }
    if (!retainedIds.has(coin.id)) for (const carry of retained) {
      expect(distance(coin, { x: carry.position.x, z: carry.position.z })).toBeGreaterThan(RETAINED_COIN_EXCLUSION);
    }
    for (const glass of level.obstacles) {
      expect(distance(coin, glass)).toBeGreaterThan(radius + glass.width / 2 + PHYSICS_CONFIG.initialClearance);
    }
  }
  for (const [index, glass] of level.obstacles.entries()) {
    expect(glass.kind).toBe('glass');
    expect(glass.width).toBe(GLASS_DIAMETER);
    expect(glass.depth).toBe(GLASS_DIAMETER);
    expect(Math.hypot(glass.x, glass.z)).toBeLessThanOrEqual(0.42 + 1e-12);
    for (const other of level.obstacles.slice(index + 1)) expect(distance(glass, other)).toBeGreaterThan(GLASS_DIAMETER);
  }
}

describe('continuous campaign generation', () => {
  it('starts and stays settled in production Rapier for 50 layouts across all round recipes', async () => {
    for (let seed = 1; seed <= 5; seed++) for (let round = 1; round <= 10; round++) {
      const layout = generateRound(round, [], seeded(seed * 1000 + round));
      const world = await PhysicsWorld.create(layout);
      try {
        expect(world.isSettled()).toBe(true);
        const original = world.frame.coins.map((coin) => ({ ...coin.position }));
        for (let step = 0; step < 120; step++) {
          const events = world.step();
          expect(events.fallenCoinIds).toEqual([]);
          expect(events.contacts).toEqual([]);
        }
        expect(world.isSettled()).toBe(true);
        for (const [index, coin] of world.frame.coins.entries()) {
          expect(distance(coin.position, original[index])).toBeLessThan(1e-5);
        }
      } finally { world.dispose(); }
    }
  }, 10000);

  it('satisfies every round recipe and geometric constraints for 100 seeds through round 10', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = seeded(seed);
      let retained: CoinTransform[] = [];
      for (let round = 1; round <= 10; round++) {
        const level = generateRound(round, retained, random);
        const added = level.coins.filter((coin) => coin.id !== retained[0]?.id);
        expect(added.length).toBe(round === 1 ? 4 : round < 4 ? 6 : round < 7 ? 7 : added.length);
        if (round >= 7) expect(added.length).toBeGreaterThanOrEqual(5);
        if (round >= 7) expect(added.length).toBeLessThanOrEqual(9);
        if (round < 4) expect(added.every((coin) => coin.materialId === 'standard')).toBe(true);
        if (round === 4 || round === 5) expect(added.filter((coin) => coin.materialId === 'iron')).toHaveLength(2);
        expect(level.table.materialId).toBe(round < 5 ? 'wood' : round < 7 ? 'marble' : level.table.materialId);
        expect(['wood', 'marble']).toContain(level.table.materialId);
        if (round < 7) expect(level.obstacles).toHaveLength(round === 3 ? 2 : round === 6 ? 3 : 0);
        else { expect(level.obstacles.length).toBeGreaterThanOrEqual(3); expect(level.obstacles.length).toBeLessThanOrEqual(6); }
        if (round === 2) expect(added.filter((coin) => Math.hypot(coin.x, coin.z) >= 0.68 - 1e-12).length).toBeGreaterThanOrEqual(1);
        safeLayout(level, retained);
        if (retained.length) {
          expect(level.coins[0]).toEqual({ id: retained[0].id, x: retained[0].position.x, z: retained[0].position.z, materialId: retained[0].materialId });
          expect(level.activeCoinId).toBe(retained[0].id);
          const [source, target] = level.coins;
          expect(distance(source, target)).toBeGreaterThanOrEqual(OPENING_TARGET_MIN_DISTANCE - 1e-12);
          expect(distance(source, target)).toBeLessThanOrEqual(OPENING_TARGET_MAX_DISTANCE + 1e-12);
          for (const glass of level.obstacles) expect(segmentDistance(glass, source, target)).toBeGreaterThan(glass.width / 2 + coinRadius(source.materialId));
          for (const coin of level.coins.slice(2)) expect(segmentDistance(coin, source, target)).toBeGreaterThan(coinRadius(coin.materialId) + coinRadius(source.materialId));
        }
        retained = [transform(added[seed % added.length])];
      }
    }
  });

  it('preserves near-edge iron survivors without moving them or mutating the supplied transform', () => {
    for (const x of [0, 0.77, 0.799]) {
      const carry = transform({ id: 'survivor', x, z: 0, materialId: 'iron' });
      const original = structuredClone(carry);
      for (const round of [2, 3, 4, 5, 6, 7, 10]) {
        const level = generateRound(round, [carry], seeded(round));
        expect(level.coins[0]).toEqual({ id: 'survivor', x, z: 0, materialId: 'iron' });
        expect(carry).toEqual(original);
        safeLayout(level, [carry]);
      }
    }
  });

  it('provides a successful production first shot for the formerly unreachable near-edge iron seed', async () => {
    const carry = transform({ id: 'carry', x: 0.74, z: 0, materialId: 'iron' });
    const layout = generateRound(7, [carry], seeded(364 * 9137));
    expect(layout.table.materialId).toBe('wood');
    const [source, target] = layout.coins;
    expect(distance(source, target)).toBeLessThanOrEqual(OPENING_TARGET_MAX_DISTANCE);
    const game = await GameSession.create(layout, 'challenge');
    try {
      expect(game.selectCoin(source.id)).toBe(true);
      // Fixed replay independently verified against production Rapier and complete-shot resolution.
      expect(game.shoot({ x: -0.19398228435526343, z: -0.4737135147953113 }, 0.76)).toBe(true);
      for (let tick = 0; tick < 1200 && game.view.phase === 'simulating'; tick++) game.tick(1 / 60);
      expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: target.id, foulReasons: [] });
      expect(game.view.lastResult?.outcome).toBe('SUCCESS');
      expect(game.frame.coins.some((coin) => coin.id === source.id)).toBe(false);
    } finally { game.dispose(); }
  }, 10000);

  it.each([0, 1, 3, 7])('revives with exactly %i replacement gold coins and preserves the settled board', (fallenCount) => {
    const level = generateRound(7, [], seeded(74));
    const retained = level.coins.slice(0, 2).map(transform);
    retained[0].position.x = 0.77; retained[0].position.z = 0;
    const original = structuredClone({ level, retained });
    const revived = generateRevival(level, retained, fallenCount, seeded(9));
    expect(revived.coins).toHaveLength(retained.length + fallenCount);
    expect(revived.coins.slice(0, retained.length)).toEqual(retained.map(({ id, materialId, position }) => ({ id, materialId, x: position.x, z: position.z })));
    expect(revived.coins.slice(retained.length).every((coin) => coin.materialId === 'standard')).toBe(true);
    expect(revived.table).toEqual(level.table);
    expect(revived.obstacles).toEqual(level.obstacles);
    expect({ level, retained }).toEqual(original);
    expect(revived.id).not.toBe(level.id);
    for (const added of revived.coins.slice(retained.length)) expect(level.coins.some((coin) => coin.id === added.id)).toBe(false);
    safeLayout(revived, retained);
  });

  it('supports an all-fallen revival and makes IDs unique across repeated generation and revival', () => {
    const first = generateRound(1, [], () => 0);
    const revived = generateRevival(first, [], 4, () => 0);
    const again = generateRevival(first, [], 4, () => 0);
    const next = generateRound(1, [], () => 0);
    const ids = [first, revived, again, next].flatMap((level) => level.coins.map((coin) => coin.id));
    expect(new Set(ids).size).toBe(ids.length);
    safeLayout(revived);
  });

  it('retains existing solver contacts while newly revived coins still avoid those coins and obstacles', () => {
    const level = generateRound(3, [], seeded(13));
    const retained = level.coins.slice(0, 2).map(transform);
    const glass = level.obstacles[0];
    retained[0].position.x = glass.x + glass.width / 2 + coinRadius(retained[0].materialId) - 0.001;
    retained[0].position.z = glass.z;
    retained[1].position.x = retained[0].position.x + coinRadius(retained[0].materialId) + coinRadius(retained[1].materialId) - 0.001;
    retained[1].position.z = glass.z;
    const revived = generateRevival(level, retained, 2, seeded(5));
    const retainedIds = new Set(retained.map((coin) => coin.id));
    expect(validateLevel(revived, retainedIds, new Set(level.obstacles.map((obstacle) => obstacle.id)))).toEqual(revived);
    expect(revived.coins[0].x).toBe(retained[0].position.x);
    expect(revived.coins[1].x).toBe(retained[1].position.x);
    for (const added of revived.coins.slice(2)) for (const coin of revived.coins.slice(0, 2)) {
      expect(distance(added, coin)).toBeGreaterThan(RETAINED_COIN_EXCLUSION);
    }
  });

  it('produces varying layouts and both late table materials across seeds', () => {
    const levels = Array.from({ length: 30 }, (_, index) => generateRound(7, [], seeded(index + 1)));
    expect(new Set(levels.map((level) => JSON.stringify(level.coins.map(({ x, z, materialId }) => [x, z, materialId])))).size).toBe(30);
    // First LCG values for adjacent tiny seeds are similar; use widely separated seeds for material coverage.
    expect(new Set([1, 1000, 10000, 100000, 1000000].map((seed) => generateRound(7, [], seeded(seed)).table.materialId)).size).toBe(2);
  });

  it.each([0, 0.5, 1, -1, 2])('finishes all recipes with a constant RNG of %s within a bounded call count', (value) => {
    for (let round = 1; round <= 10; round++) {
      let calls = 0;
      const retained = round === 1 ? [] : [transform({ id: 'constant-survivor', x: 0.77, z: 0, materialId: 'iron' })];
      const level = generateRound(round, retained, () => { calls++; return value; });
      expect(calls).toBeLessThan(4000);
      safeLayout(level, retained);
    }
  });

  it('rejects malformed round/count/RNG/retention inputs without unbounded work', () => {
    for (const round of [0, -1, 1.5, NaN, Infinity]) expect(() => generateRound(round)).toThrow(/Round/);
    const level = generateRound(1, [], seeded(1));
    for (const count of [-1, 0.5, NaN, Infinity]) expect(() => generateRevival(level, [], count)).toThrow(/Refill count/);
    expect(() => generateRevival(level, [], Number.MAX_SAFE_INTEGER)).toThrow(/supported limit/);
    expect(() => generateRevival(level, [], 1)).toThrow(/requires at least/);
    expect(() => generateRound(1, [], () => NaN)).toThrow(/random value/);
    const carry = transform({ id: 'carry', x: 0.8, z: 0, materialId: 'standard' });
    expect(() => generateRound(2, [carry])).toThrow(/centre/);
    carry.position.x = 0;
    expect(() => generateRound(1, [carry])).toThrow(/sole surviving/);
    expect(() => generateRound(2, [carry, carry])).toThrow(/sole surviving/);
    expect(() => generateRevival(level, [carry, carry], 0)).toThrow(/duplicate/);
  });
});
