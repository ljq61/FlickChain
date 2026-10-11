import { describe, expect, it } from 'vitest';
import { PhysicsWorld, type PhysicsFeedback } from '../../src/physics/PhysicsWorld';
import type RAPIER from '@dimforge/rapier3d-compat';
import { COIN_THICKNESS } from '../../src/physics/MaterialRegistry';
import type { LevelConfig } from '../../src/types/contracts';
export function level(coins: [string, number, number][] = [['A', -0.18, 0], ['B', 0.12, 0]]): LevelConfig {
  return { schemaVersion: 1, id: 'test', name: 'test', lesson: 'test', table: { width: 1.2, depth: 1.6, materialId: 'wood' }, coins: coins.map(([id, x, z]) => ({ id, x, z, materialId: 'standard' })), activeCoinId: 'A', obstacles: [] };
}
describe('real Rapier 3D world', () => {
  it('starts stable with true table support and preserves tabletop orientation', async () => {
    const world = await PhysicsWorld.create(level());
    try {
      expect(world.isSettled()).toBe(true);
      expect(world.frame.coins[0].position.y).toBeCloseTo(COIN_THICKNESS / 2, 2);
      expect(world.step().feedback).toEqual([]);
      world.applyShot('A', { x: 1, z: 0 }, 0.6);
      let sounded = false;
      const contacts: [string, string][] = [];
      for (let i = 0; i < 600; i++) {
        const events = world.step();
        contacts.push(...events.contacts);
        if (events.feedback.includes('coin')) {
          sounded = true;
          expect(events.contacts).toContainEqual(['A', 'B']);
          expect(world.step().feedback).toEqual([]);
        }
        for (const coin of world.frame.coins) expect(Math.abs(coin.rotation.x) + Math.abs(coin.rotation.z)).toBeLessThan(0.03);
      }
      expect(contacts).toContainEqual(['A', 'B']);
      expect(sounded).toBe(true);
      expect(world.isSettled()).toBe(true);
    } finally { world.dispose(); }
  });
  it('detects max-power thin cylinder contact with CCD rather than tunneling', async () => {
    const world = await PhysicsWorld.create(level([['A', -0.1, 0], ['B', 0.08, 0]]));
    try {
      world.applyShot('A', { x: 1, z: 0 }, 1);
      const contacts: [string, string][] = [];
      for (let i = 0; i < 120; i++) contacts.push(...world.step().contacts);
      expect(contacts).toContainEqual(['A', 'B']);
    } finally { world.dispose(); }
  });
  it('rebounds from a thin fixed obstacle without reporting an extra coin target', async () => {
    const layout = level([['A', -0.12, 0], ['B', -0.3, 0.3]]);
    layout.obstacles = [{ id: 'wall', x: 0.16, z: 0, width: 0.006, depth: 0.6 }];
    const world = await PhysicsWorld.create(layout);
    try {
      world.applyShot('A', { x: 1, z: 0 }, 1);
      let previous = -0.12, reversed = false;
      const feedback: PhysicsFeedback[] = [];
      for (let i = 0; i < 360; i++) {
        const events = world.step();
        expect(events.contacts).toEqual([]);
        feedback.push(...events.feedback);
        if (events.feedback.includes('wall')) expect(world.step().feedback).toEqual([]);
        const x = world.frame.coins.find((coin) => coin.id === 'A')!.position.x;
        expect(x).toBeLessThan(0.16 - 0.003 - 0.035 + 0.003);
        reversed ||= x < previous - 0.001; previous = x;
      }
      expect(reversed).toBe(true); expect(world.isSettled()).toBe(true);
      expect(feedback).toEqual(['wall']);
    } finally { world.dispose(); }
  });
  it('unlocks tipping beyond the edge, reports one fall, and ignores disposed operations', async () => {
    const world = await PhysicsWorld.create(level([['A', 0.5, 0], ['B', -0.35, 0.3]]));
    expect(world.applyShot('A', { x: 1, z: 0 }, 1)).toBe(true);
    const fallen: string[] = []; let tipped = false;
    for (let i = 0; i < 240; i++) {
      fallen.push(...world.step().fallenCoinIds);
      const coin = world.frame.coins.find((coin) => coin.id === 'A')!;
      tipped ||= Math.abs(coin.rotation.x) + Math.abs(coin.rotation.z) > 0.01;
    }
    expect(fallen).toEqual(['A']); expect(tipped).toBe(true); expect(world.hasCoin('A')).toBe(false);
    world.dispose(); world.dispose();
    expect(world.step()).toEqual({ contacts: [], fallenCoinIds: [], feedback: [] });
    expect(world.applyShot('A', { x: 1, z: 0 }, 1)).toBe(false);
    expect(world.frame.coins).toEqual([]);
  });
  it.each(Array.from({ length: 8 }, (_, i) => i * Math.PI / 4))('keeps a full-power shot on the near side of a thin wall at yaw %s', async (yaw) => {
    const direction = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const layout = level([['A', 0, 0], ['B', -0.37, -0.61]]);
    layout.obstacles = [{ id: 'wall', x: direction.x * 0.28, z: direction.z * 0.28, width: 0.006, depth: 0.6, rotation: -yaw }];
    const world = await PhysicsWorld.create(layout);
    try {
      expect(world.applyShot('A', direction, 1)).toBe(true);
      let previous = 0, reversed = false, wallContacts = 0;
      for (let i = 0; i < 240; i++) {
        const events = world.step();
        wallContacts += events.feedback.filter((entry) => entry === 'wall').length;
        const position = world.frame.coins.find((coin) => coin.id === 'A')!.position;
        const forward = position.x * direction.x + position.z * direction.z;
        expect(forward).toBeLessThan(0.28 - 0.003 - 0.035 + 0.003);
        reversed ||= forward < previous - 0.001;
        previous = forward;
      }
      expect(reversed).toBe(true);
      expect(wallContacts).toBe(1);
    } finally { world.dispose(); }
  });
  it('uses a true circular top: a diagonal shot tips and falls inside the old bounding square', async () => {
    const layout = level([['A', 0.5, 0.5], ['B', -0.3, 0]]);
    layout.table = { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' };
    const circle = await PhysicsWorld.create(layout);
    const rectangle = await PhysicsWorld.create({ ...layout, table: { ...layout.table, shape: 'rectangle' } });
    try {
      expect(circle.isSettled()).toBe(true);
      expect(circle.frame.coins[0].position.y).toBeCloseTo(COIN_THICKNESS / 2, 2);
      // Keep this geometry comparison at the former impulse, now below half charge.
      const geometryPower = 0.55 * 2 ** (-1 / 1.35);
      expect(circle.applyShot('A', { x: 1, z: 1 }, geometryPower)).toBe(true);
      expect(rectangle.applyShot('A', { x: 1, z: 1 }, geometryPower)).toBe(true);
      const falls: string[] = [];
      let tipped = false;
      for (let i = 0; i < 300; i++) {
        const events = circle.step(); rectangle.step();
        falls.push(...events.fallenCoinIds);
        const coin = circle.frame.coins.find((entry) => entry.id === 'A')!;
        tipped ||= Math.abs(coin.rotation.x) + Math.abs(coin.rotation.z) > 0.01;
        if (events.fallenCoinIds.includes('A')) {
          expect(Math.abs(coin.position.x)).toBeLessThan(0.8);
          expect(Math.abs(coin.position.z)).toBeLessThan(0.8);
          expect(Math.hypot(coin.position.x, coin.position.z)).toBeGreaterThan(0.8);
        }
      }
      expect(falls).toEqual(['A']); expect(tipped).toBe(true);
      expect(circle.hasCoin('A')).toBe(false);
      expect(rectangle.hasCoin('A')).toBe(true); expect(rectangle.isSettled()).toBe(true);
      expect(rectangle.frame.coins[0].position.y).toBeCloseTo(COIN_THICKNESS / 2, 2);
    } finally { circle.dispose(); rectangle.dispose(); }
  });
  it('settles a real Rapier coin stack via upward contacts, and removes only a safe top source', async () => {
    const world = await PhysicsWorld.create(level());
    try {
      const bindings = (world as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
      const a = bindings.get('A')!.body, b = bindings.get('B')!.body;
      const base = b.translation();
      a.setTranslation({ x: base.x, y: base.y + COIN_THICKNESS + .05, z: base.z }, true);
      a.setLinvel({ x: 0, y: 0, z: 0 }, true);
      a.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // An airborne pose is never supported merely because it lies above another coin.
      world.step(); // Refresh contact manifolds after constructing the pose.
      expect(world.allSupported()).toBe(false);
      for (let i = 0; i < 240; i++) world.step();
      expect(a.translation().y - b.translation().y).toBeGreaterThan(COIN_THICKNESS * .7);
      expect(a.translation().y - b.translation().y).toBeLessThan(COIN_THICKNESS * 1.2);
      expect(world.isSettled()).toBe(true);
      expect(world.canRemoveSource('A')).toBe(true);
      expect(world.canRemoveSource('B')).toBe(false);
      const retained = { position: { ...b.translation() }, rotation: { ...b.rotation() } };
      world.removeCoin('A');
      expect(world.frame.coins).toHaveLength(1);
      expect(world.frame.coins[0]).toMatchObject(retained);
      expect(world.applyShot('B', { x: -1, z: 0 }, .3)).toBe(true);
      const before = b.translation().x;
      world.step(); expect(b.translation().x).toBeLessThan(before);
    } finally { world.dispose(); }
  });
  it('rejects overlapping, invalid and dangerous initial layouts', async () => {
    await expect(PhysicsWorld.create(level([['A', 0, 0], ['B', 0.02, 0]]))).rejects.toThrow(/重叠|相交/);
    await expect(PhysicsWorld.create(level([['A', 0.58, 0], ['B', 0, 0]]))).rejects.toThrow(/桌边|贴边/);
    await expect(PhysicsWorld.create(level([['A', NaN, 0], ['B', 0, 0]]))).rejects.toThrow();
  });
});
