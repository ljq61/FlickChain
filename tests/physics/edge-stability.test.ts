import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';

describe('slow coins with a stable centre over the table edge', () => {
  it('recognizes real tabletop contact when the opening coin rests with its centre just beyond the rim', async () => {
    const world = await PhysicsWorld.create({
      schemaVersion: 1, purpose: 'opening', id: 'opening', name: 'Opening', lesson: 'Distance',
      table: { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' },
      coins: [{ id: 'A', x: 0, z: .64, materialId: 'standard' }], activeCoinId: 'A', obstacles: [],
    });
    try {
      expect(world.applyShot('A', { x: 0, z: -1 }, .75)).toBe(true);
      for (let i = 0; i < 600; i++) expect(world.step().fallenCoinIds).toEqual([]);
      const coin = world.frame.coins[0];
      expect(coin.position.z).toBeLessThan(-.8);
      expect(coin.position.z).toBeGreaterThan(-.835);
      expect(world.isQuiet()).toBe(true);
      expect(world.isSettled()).toBe(false);
      expect(world.isCoinRestingOnTable('A')).toBe(true);
    } finally { world.dispose(); }
  });
  it('does not unlock tilt or creep after stopping, at any circular-table yaw', async () => {
    for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4;
      const direction = { x: Math.cos(angle), z: Math.sin(angle) };
      const world = await PhysicsWorld.create({
        schemaVersion: 1, id: 'edge', name: 'edge', lesson: 'edge',
        table: { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' },
        coins: [{ id: 'A', x: direction.x * 0.74, z: direction.z * 0.74, materialId: 'standard' },
          { id: 'B', x: 0, z: 0, materialId: 'standard' }], activeCoinId: 'A', obstacles: [],
      });
      try {
        // Gentle impulse stops with the rim overhanging, but the centre still supported.
        expect(world.applyShot('A', direction, 0.2)).toBe(true);
        for (let i = 0; i < 180; i++) world.step();
        const stopped = world.frame.coins.find(coin => coin.id === 'A')!;
        expect(Math.hypot(stopped.position.x, stopped.position.z)).toBeGreaterThan(0.765);
        expect(Math.hypot(stopped.position.x, stopped.position.z)).toBeLessThan(0.8);
        expect(Math.hypot(stopped.rotation.x, stopped.rotation.z)).toBeLessThan(1e-7);
        expect(world.isSettled()).toBe(true);
        for (let i = 0; i < 600; i++) expect(world.step().fallenCoinIds).toEqual([]);
        const later = world.frame.coins.find(coin => coin.id === 'A')!;
        expect(Math.hypot(later.position.x - stopped.position.x, later.position.z - stopped.position.z)).toBeLessThan(0.00001);
        expect(Math.hypot(later.rotation.x, later.rotation.z)).toBeLessThan(1e-7);
      } finally { world.dispose(); }
    }
  });
});
