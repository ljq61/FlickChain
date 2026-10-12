import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/content/levels';
import { validateLevel } from '../../src/content/LevelValidator';

const sample = () => structuredClone(LEVELS[0]);
describe('level validation', () => {
  it('loads five unique wood/standard stages with a 2/2/3/4/5 coin progression', () => {
    expect(LEVELS.map((level) => level.coins.length)).toEqual([2, 2, 3, 4, 5]);
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(5);
    for (const level of LEVELS) {
      expect(level.table).toMatchObject({ shape: 'circle', width: 1.6, depth: 1.6 });
      expect(validateLevel(level)).toEqual(level);
    }
  });
  it('rejects duplicate stable IDs, including coin/obstacle collisions', () => {
    const level = sample(); level.coins[1].id = level.coins[0].id;
    expect(() => validateLevel(level)).toThrow(/Duplicate ID/);
    const another = sample(); another.obstacles = [{ id: 'a', x: 0, z: -0.3, width: 0.1, depth: 0.1 }];
    expect(() => validateLevel(another)).toThrow(/Duplicate ID/);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite coordinates (%s)', (invalid) => {
    const level = sample(); level.coins[0].x = invalid;
    expect(() => validateLevel(level)).toThrow(/finite number/);
  });
  it('rejects unknown material and missing active-coin references', () => {
    expect(() => validateLevel({ ...sample(), table: { width: 1.2, depth: 1.6, materialId: 'ice' } })).toThrow(/Unknown table material/);
    const level = sample();
    expect(() => validateLevel({ ...level, coins: [{ ...level.coins[0], materialId: 'gold' }, level.coins[1]] })).toThrow(/Unknown coin material/);
    level.activeCoinId = 'missing'; expect(() => validateLevel(level)).toThrow(/existing coin/);
  });
  it('rejects coin overlap, edge placements, and a one-coin pseudo-level', () => {
    const level = sample(); level.coins[1].x = level.coins[0].x;
    expect(() => validateLevel(level)).toThrow(/overlap/);
    level.coins[1].x = level.table.width / 2 - 0.01; expect(() => validateLevel(level)).toThrow(/out of bounds/);
    level.coins.pop(); expect(() => validateLevel(level)).toThrow(/requires at least two coins/);
  });
  it('rejects malformed schema, unknown keys and non-positive dimensions', () => {
    expect(() => validateLevel({ ...sample(), schemaVersion: 2 })).toThrow(/schema version/);
    expect(() => validateLevel({ ...sample(), owner: 'player1' })).toThrow(/Unknown field/);
    expect(() => validateLevel({ ...sample(), table: { width: 0, depth: 1, materialId: 'wood' } })).toThrow(/greater than zero/);
    expect(() => validateLevel({ ...sample(), coins: null })).toThrow(/array/);
  });
  it('checks rotated obstacle footprint against coins, other obstacles and table edges', () => {
    const level = sample();
    level.obstacles = [{ id: 'box', x: -0.2, z: 0.1, width: 0.2, depth: 0.08, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/overlap/);
    level.obstacles = [{ id: 'box', x: 0.71, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/out of bounds/);
    level.obstacles = [{ id: 'box1', x: 0, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 },
      { id: 'box2', x: 0.05, z: -0.4, width: 0.1, depth: 0.15, rotation: -Math.PI / 6 }];
    expect(() => validateLevel(level)).toThrow(/overlap/);
    level.obstacles = [{ id: 'box', x: 0, z: -0.4, width: 0.2, depth: 0.1, rotation: Math.PI / 4 }];
    expect(validateLevel(level).obstacles.length).toBe(1);
  });
  it('uses the same positive-yaw geometry as Rapier for asymmetric rotated boxes', () => {
    const level = sample(); level.coins[0] = { id: 'a', x: 0.085, z: -0.385, materialId: 'standard' };
    level.obstacles = [{ id: 'box', x: 0, z: -0.3, width: 0.3, depth: 0.025, rotation: Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/overlap/);
    level.coins[0].z = -0.215; expect(() => validateLevel(level)).not.toThrow();
  });
  it('rejects unknown shapes and a circular table with unequal diameters', () => {
    expect(() => validateLevel({ ...sample(), table: { ...sample().table, shape: 'oval' } })).toThrow(/shape/);
    expect(() => validateLevel({ ...sample(), table: { ...sample().table, depth: 1.5 } })).toThrow(/diameter/);
  });
  it('requires the complete coin and initial clearance to fit inside the circular boundary', () => {
    const level = sample();
    level.coins[1].x = 0.6; level.coins[1].z = 0.6;
    expect(() => validateLevel(level)).toThrow(/out of bounds/);
    level.coins[1].x = 0.54; level.coins[1].z = 0.54;
    expect(() => validateLevel(level)).toThrow(/too close to the table edge/);
    level.coins[1].x = 0.5; level.coins[1].z = 0.5;
    expect(() => validateLevel(level)).not.toThrow();
    level.coins[1].x = 0.77; level.coins[1].z = 0;
    expect(() => validateLevel(level)).toThrow(/too close to the table edge/);
  });
  it('checks all rotated obstacle corners inside the circle rather than its bounding square', () => {
    const level = sample();
    level.obstacles = [{ id: 'corner', x: 0.55, z: 0.45, width: 0.3, depth: 0.08, rotation: -Math.PI / 4 }];
    expect(() => validateLevel(level)).toThrow(/Obstacle is out of bounds/);
    level.table.shape = 'rectangle';
    expect(() => validateLevel(level)).not.toThrow();
    delete level.table.shape;
    expect(validateLevel(level).table.shape).toBeUndefined();
    level.table.shape = 'circle'; level.obstacles[0].x = 0.3; level.obstacles[0].z = -0.3;
    expect(() => validateLevel(level)).not.toThrow();
  });
  it('validates iron radius, marble, round glass footprints and strict obstacle kinds', () => {
    const level = sample(); level.table.materialId = 'marble'; level.coins[0].materialId = 'iron';
    level.obstacles = [{ id: 'cup', kind: 'glass', x: 0, z: -0.3, width: 0.14, depth: 0.14 }];
    expect(validateLevel(level)).toEqual(level);
    const malformed = structuredClone(level); malformed.obstacles[0].depth = 0.15;
    expect(() => validateLevel(malformed)).toThrow(/same diameter/);
    expect(() => validateLevel({ ...level, obstacles: [{ ...level.obstacles[0], kind: 'cone' }] })).toThrow(/kind/);
    // A circle fits here although the circumscribed square's corners would not fit.
    level.obstacles[0] = { id: 'cup', kind: 'glass', x: 0.68, z: 0, width: 0.2, depth: 0.2 };
    expect(() => validateLevel(level)).not.toThrow();
    level.obstacles[0].x = 0.71; expect(() => validateLevel(level)).toThrow(/out of bounds/);
    level.obstacles = [{ id: 'cup', kind: 'glass', x: 0, z: 0, width: 0.14, depth: 0.14 }];
    level.coins[0].x = 0.078; level.coins[0].z = 0.078;
    expect(() => validateLevel(level)).toThrow(/overlap/); // Iron needs a little more clearance.
    level.coins[0].materialId = 'standard'; expect(() => validateLevel(level)).not.toThrow();
    level.obstacles.push({ id: 'cup2', kind: 'glass', x: 0.13, z: 0, width: 0.14, depth: 0.14 });
    expect(() => validateLevel(level)).toThrow(/overlap/);
  });
  it('permits only explicit retained COM edge positions and retained existing contacts', () => {
    const level = sample(); level.coins[0].x = 0.78; level.coins[0].z = 0;
    expect(() => validateLevel(level)).toThrow(/too close to the table edge/);
    expect(() => validateLevel(level, new Set(['a']))).not.toThrow();
    level.coins[0].x = 0.8; expect(() => validateLevel(level, new Set(['a']))).toThrow(/too close to the table edge/);
    level.coins[0].x = 0; level.coins[1].x = 0.07; level.coins[1].z = 0;
    expect(() => validateLevel(level, new Set(['a', 'b']))).not.toThrow();
    expect(() => validateLevel(level, new Set(['a']))).toThrow(/overlap/);
    level.coins[1].x = 0.4;
    level.obstacles = [{ id: 'cup', kind: 'glass', x: 0, z: -0.105, width: 0.14, depth: 0.14 }];
    expect(() => validateLevel(level, new Set(['a']))).toThrow(/overlap/);
    expect(() => validateLevel(level, new Set(['a']), new Set(['cup']))).not.toThrow();
  });

});
