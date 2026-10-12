import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { GameSession } from '../../src/core/GameSession';
import { COIN_RADIUS, coinRadius, impulseForPower, MATERIALS } from '../../src/physics/MaterialRegistry';
import type { CoinMaterialId, LevelConfig, TableMaterialId } from '../../src/types/contracts';

function layout(materialId: CoinMaterialId = 'standard', tableMaterial: TableMaterialId = 'wood'): LevelConfig {
  return { schemaVersion: 1, id: 'materials', name: 'test', lesson: 'test',
    table: { width: 1.6, depth: 1.6, shape: 'circle', materialId: tableMaterial },
    coins: [{ id: 'A', x: -0.4, z: 0, materialId }, { id: 'B', x: 0.4, z: 0.35, materialId: 'standard' }],
    activeCoinId: 'A', obstacles: [],
  };
}
describe('production campaign materials and reconfiguration', () => {
  it('uses larger real cylinder colliders and heavier, higher-friction iron bodies', async () => {
    expect(coinRadius('iron')).toBeCloseTo(COIN_RADIUS * 1.12);
    const gold = await PhysicsWorld.create(layout());
    const iron = await PhysicsWorld.create(layout('iron'));
    try {
      const goldStart = gold.frame.coins[0].position.x, ironStart = iron.frame.coins[0].position.x;
      gold.applyShot('A', { x: 1, z: 0 }, 0.3); iron.applyShot('A', { x: 1, z: 0 }, 0.3);
      gold.step(); iron.step();
      const goldMove = gold.frame.coins[0].position.x - goldStart;
      const ironMove = iron.frame.coins[0].position.x - ironStart;
      expect(goldMove).toBeCloseTo(impulseForPower(0.3) / MATERIALS.standard.mass / 120, 3);
      expect(ironMove / goldMove).toBeCloseTo(MATERIALS.standard.mass / MATERIALS.iron.mass, 1);
      expect(iron.frame.coins[0].materialId).toBe('iron');
    } finally { gold.dispose(); iron.dispose(); }
    // Launch with equal initial speed, then verify the higher friction really shortens iron travel.
    const equalGold = await PhysicsWorld.create(layout());
    const equalIron = await PhysicsWorld.create(layout('iron'));
    try {
      const power = 0.25;
      equalGold.applyShot('A', { x: 1, z: 0 }, power);
      equalIron.applyShot('A', { x: 1, z: 0 }, power * (MATERIALS.iron.mass / MATERIALS.standard.mass) ** (1 / 1.35));
      for (let i = 0; i < 300; i++) { equalGold.step(); equalIron.step(); }
      expect(equalIron.isSettled()).toBe(true); expect(equalGold.isSettled()).toBe(true);
      const goldDistance = equalGold.frame.coins[0].position.x + 0.4;
      const ironDistance = equalIron.frame.coins[0].position.x + 0.4;
      expect(ironDistance).toBeLessThan(goldDistance * 0.85);
    } finally { equalGold.dispose(); equalIron.dispose(); }
    const pair = layout('iron'); pair.coins[0].x = 0; pair.coins[1].x = COIN_RADIUS * 2 + 0.004; pair.coins[1].z = 0;
    // A 74 mm separation accepts two gold coins but not the physically larger iron coin.
    await expect(PhysicsWorld.create(pair)).rejects.toThrow(/overlap/);
  });
  it('collides at the true enlarged iron rim where a standard coin passes without touching', async () => {
    const config = layout();
    config.coins[0].x = -0.18; config.coins[1].x = 0.1; config.coins[1].z = 0.072;
    const gold = await PhysicsWorld.create(config);
    config.coins[0].materialId = 'iron';
    const iron = await PhysicsWorld.create(config);
    try {
      gold.applyShot('A', { x: 1, z: 0 }, 0.7); iron.applyShot('A', { x: 1, z: 0 }, 0.7);
      const goldContacts: [string, string][] = [], ironContacts: [string, string][] = [];
      for (let i = 0; i < 240; i++) { goldContacts.push(...gold.step().contacts); ironContacts.push(...iron.step().contacts); }
      expect(goldContacts).toEqual([]);
      expect(ironContacts).toContainEqual(['A', 'B']);
    } finally { gold.dispose(); iron.dispose(); }
  });
  it('slides farther on marble using production contact friction with the same shot', async () => {
    const wood = await PhysicsWorld.create(layout());
    const marble = await PhysicsWorld.create(layout('standard', 'marble'));
    try {
      wood.applyShot('A', { x: 1, z: 0 }, 0.3); marble.applyShot('A', { x: 1, z: 0 }, 0.3);
      for (let i = 0; i < 300; i++) { wood.step(); marble.step(); }
      expect(wood.isSettled()).toBe(true); expect(marble.isSettled()).toBe(true);
      expect(marble.frame.coins[0].position.x + 0.4).toBeGreaterThan((wood.frame.coins[0].position.x + 0.4) * 1.2);
    } finally { wood.dispose(); marble.dispose(); }
  });
  it('uses fixed round glass cylinders, reports wall feedback only, and replaces moved cups by stable ID', async () => {
    const config = layout();
    config.obstacles = [{ id: 'cup', kind: 'glass', x: -0.1, z: 0, width: 0.14, depth: 0.14 }];
    const world = await PhysicsWorld.create(config);
    try {
      world.applyShot('A', { x: 1, z: 0 }, 0.4);
      const feedback: string[] = [], contacts: [string, string][] = [];
      for (let i = 0; i < 300; i++) { const events = world.step(); feedback.push(...events.feedback); contacts.push(...events.contacts); }
      expect(feedback).toEqual(['wall']); expect(contacts).toEqual([]);
      expect(world.isSettled()).toBe(true);
      const before = world.frame;
      const next: LevelConfig = { ...config, table: { ...config.table, materialId: 'marble' },
        coins: before.coins.map((c) => ({ id: c.id, x: c.position.x, z: c.position.z, materialId: c.materialId })),
        obstacles: [{ ...config.obstacles[0], z: -0.4 }],
      };
      expect(world.reconfigure(next)).toBe(true);
      expect(world.frame.coins).toEqual(before.coins);
      expect(world.frame.obstacles).toEqual(next.obstacles);
      // A shot through the former cup location proves the old actual collider was removed.
      world.applyShot('A', { x: 1, z: 0 }, 0.3);
      for (let i = 0; i < 150; i++) expect(world.step().feedback).not.toContain('wall');
    } finally { world.dispose(); }
  });
  const cupShots = (['standard', 'iron'] as const).flatMap((coin) =>
    (['wood', 'marble'] as const).flatMap((table) =>
      [0, .02, .06].flatMap((offset) => [0, Math.PI / 4].map((yaw) => ({ coin, table, offset, yaw })))));
  it.each(cupShots)('keeps full-power $coin outside a glass on $table (offset $offset, yaw $yaw)', async ({ coin, table, offset, yaw }) => {
    const forward = { x: Math.cos(yaw), z: Math.sin(yaw) }, side = { x: -Math.sin(yaw), z: Math.cos(yaw) };
    const config = layout(coin, table);
    // Enough room to isolate glass collision from a legitimate high-power edge fall.
    config.table = { width: 6, depth: 6, materialId: table };
    config.coins[0].x = -.24 * forward.x + offset * side.x;
    config.coins[0].z = -.24 * forward.z + offset * side.z;
    config.coins[1].x = 2.75; config.coins[1].z = -2.75;
    config.obstacles = [{ id: 'cup', kind: 'glass', x: 0, z: 0, width: .14, depth: .14 }];
    const world = await PhysicsWorld.create(config);
    try {
      expect(world.applyShot('A', forward, 1)).toBe(true);
      const contacts: [string, string][] = [], falls: string[] = [], feedback: string[] = [];
      let minimumRadius = Infinity;
      for (let i = 0; i < 900; i++) {
        const events = world.step(); contacts.push(...events.contacts); falls.push(...events.fallenCoinIds); feedback.push(...events.feedback);
        const position = world.frame.coins.find((c) => c.id === 'A')!.position;
        minimumRadius = Math.min(minimumRadius, Math.hypot(position.x, position.z));
      }
      // The old coplanar bottom cap let the centre reach r=.04194 inside r=.07.
      expect(minimumRadius).toBeGreaterThan(.09);
      expect(feedback).toContain('wall'); expect(contacts).toEqual([]); expect(falls).toEqual([]);
      expect(world.isSettled()).toBe(true);
    } finally { world.dispose(); }
  });
  it.each((['standard', 'iron'] as const).flatMap((coin) => (['wood', 'marble'] as const).map((table) => ({ coin, table }))))(
    'resolves a full-power $coin glass rebound into exactly one target on $table', async ({ coin, table }) => {
      const config = layout(coin, table);
      config.table = { width: 4, depth: 4, materialId: table };
      config.coins = [{ id: 'A', x: -.24, z: 0, materialId: coin }, { id: 'B', x: -.4, z: 0, materialId: 'standard' },
        { id: 'C', x: .5, z: .5, materialId: 'standard' }];
      config.obstacles = [{ id: 'cup', kind: 'glass', x: 0, z: 0, width: .14, depth: .14 }];
      const game = await GameSession.create(config, 'challenge');
      try {
        expect(game.selectCoin('A')).toBe(true); expect(game.shoot({ x: 1, z: 0 }, 1)).toBe(true);
        for (let i = 0; i < 900 && game.view.phase === 'simulating'; i++) game.tick(1 / 120);
        expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B', remaining: 2, scores: [1, 0], chain: 1, foulReasons: [] });
        expect(game.frame.coins.map((c) => c.id)).toEqual(['B', 'C']);
        expect(game.frame.coins[0].position.x).toBeLessThan(-.4);
      } finally { game.dispose(); }
    });
  it('preserves a naturally settled rim-overhanging coin and rejects new edge placements', async () => {
    const config = layout(); config.coins[0].x = 0.74;
    const world = await PhysicsWorld.create(config);
    try {
      world.applyShot('A', { x: 1, z: 0 }, 0.2);
      for (let i = 0; i < 180; i++) world.step();
      expect(world.isSettled()).toBe(true);
      world.removeCoin('B');
      const survivor = world.frame.coins[0];
      expect(survivor.position.x).toBeGreaterThan(0.765);
      const next: LevelConfig = { ...config, activeCoinId: 'A',
        coins: [{ id: 'A', x: survivor.position.x, z: survivor.position.z, materialId: survivor.materialId },
          { id: 'C', x: 0, z: -0.3, materialId: 'standard' }],
      };
      expect(() => PhysicsWorld.validate(next)).toThrow(/table edge/);
      const unsafe = structuredClone(next); unsafe.coins[1].x = 0.77; unsafe.coins[1].z = 0.1;
      expect(world.reconfigure(unsafe)).toBe(false); expect(world.frame.coins).toEqual([survivor]);
      expect(world.reconfigure(next)).toBe(true); expect(world.frame.coins[0]).toEqual(survivor);
      for (let i = 0; i < 120; i++) expect(world.step().contacts).toEqual([]);
      expect(world.isSettled()).toBe(true); expect(world.hasCoin('A')).toBe(true);
    } finally { world.dispose(); }
  });
  it.each(['toward', 'away'] as const)('emits one actual source contact for a retained pair only when moving %s', async (direction) => {
    const config = layout();
    config.coins = [{ id: 'A', x: 0, z: 0, materialId: 'standard' },
      { id: 'B', x: 0.0825, z: 0, materialId: 'standard' }, { id: 'C', x: -0.0825, z: 0, materialId: 'standard' }];
    config.obstacles = [{ id: 'cup', kind: 'glass', x: 0.2, z: 0, width: 0.14, depth: 0.14 }];
    const world = await PhysicsWorld.create(config);
    try {
      world.applyShot('A', { x: 1, z: 0 }, 0.6);
      let quiet = 0;
      for (let i = 0; i < 1800 && quiet < 36; i++) { world.step(); quiet = world.isSettled() ? quiet + 1 : 0; }
      expect(quiet).toBe(36);
      const frame = world.frame;
      const revived = { ...config, coins: frame.coins.map((coin) => ({ id: coin.id,
        x: coin.position.x, z: coin.position.z, materialId: coin.materialId })) };
      expect(world.reconfigure(revived)).toBe(true); expect(world.frame).toEqual(frame);
      const a = frame.coins.find((coin) => coin.id === 'A')!.position;
      const c = frame.coins.find((coin) => coin.id === 'C')!.position;
      expect(world.applyShot('A', direction === 'toward' ? { x: c.x - a.x, z: c.z - a.z } : { x: 0, z: -1 }, 0.2)).toBe(true);
      const contacts: [string, string][] = [], feedback: string[] = [];
      for (let i = 0; i < 240; i++) { const events = world.step(); contacts.push(...events.contacts); feedback.push(...events.feedback); }
      expect(contacts).toEqual(direction === 'toward' ? [['A', 'C']] : []);
      expect(feedback).toEqual(direction === 'toward' ? ['coin'] : []);
      expect(world.isSettled()).toBe(true);
      for (let i = 0; i < 30; i++) expect(world.step().contacts).toEqual([]); // Quiet old contacts cannot award another hit.
    } finally { world.dispose(); }
  });
  it.each(Array.from({ length: 8 }, (_, index) => index * Math.PI / 4))('retains brief full-power glancing CCD contact at yaw %s', async (yaw) => {
    const forward = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const side = { x: -forward.z, z: forward.x };
    const config = layout();
    config.coins[0].x = -0.1 * forward.x; config.coins[0].z = -0.1 * forward.z;
    config.coins[1].x = 0.1 * forward.x + 0.062 * side.x; config.coins[1].z = 0.1 * forward.z + 0.062 * side.z;
    const world = await PhysicsWorld.create(config);
    try {
      expect(world.applyShot('A', forward, 1)).toBe(true);
      const contacts: [string, string][] = [];
      for (let i = 0; i < 120; i++) contacts.push(...world.step().contacts);
      expect(contacts).toEqual([['A', 'B']]);
    } finally { world.dispose(); }
  });

  it('deduplicates a target across real rebounds while keeping distinct impact feedback', async () => {
    const config = layout(); config.coins[0].x = -0.18; config.coins[1].x = 0.12; config.coins[1].z = 0;
    config.obstacles = [{ id: 'wall', x: 0.34, z: 0, width: 0.006, depth: 0.6 }];
    const world = await PhysicsWorld.create(config);
    try {
      world.applyShot('A', { x: 1, z: 0 }, 0.8);
      const contacts: [string, string][] = [], sounds: string[] = [];
      for (let i = 0; i < 600; i++) { const events = world.step(); contacts.push(...events.contacts); sounds.push(...events.feedback); }
      expect(contacts).toEqual([['A', 'B']]);
      expect(sounds.filter((sound) => sound === 'coin').length).toBeGreaterThanOrEqual(2);
      expect(sounds).toContain('wall');
      expect(world.isSettled()).toBe(true);
    } finally { world.dispose(); }
  });

});
