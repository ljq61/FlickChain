import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TavernEnvironment } from '../../src/rendering/TavernEnvironment';

describe('decorative tavern resources', () => {
  it('batches furniture, excludes picking, and uses only one small shadow map', () => {
    const room = new TavernEnvironment();
    room.setTable({ shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' }, 0.06);
    const batches: THREE.InstancedMesh[] = [];
    const casters: THREE.Light[] = [];
    room.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) batches.push(object);
      if (object instanceof THREE.Light && object.castShadow) casters.push(object);
      if (object instanceof THREE.Mesh) expect(object.castShadow).toBe(false);
    });
    expect(batches.length).toBeLessThan(25);
    expect(batches.reduce((count, mesh) => count + mesh.count, 0)).toBeGreaterThan(400);
    expect(casters).toHaveLength(1);
    expect((casters[0] as THREE.SpotLight).shadow.mapSize.toArray()).toEqual([1024, 1024]);
    room.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(room, true)).toEqual([]);
    room.dispose();
  });

  it('keeps trims inside the table footprint and reuses unchanged table dressing', () => {
    const room = new TavernEnvironment();
    const table = { shape: 'circle' as const, width: 1.6, depth: 1.6, materialId: 'wood' as const };
    room.setTable(table, 0.06);
    const resources = room as unknown as { tableDress: THREE.Group };
    const firstTrim = resources.tableDress.children[0] as THREE.Mesh;
    const firstGeometry = firstTrim.geometry;
    const dispose = vi.spyOn(firstGeometry, 'dispose');
    room.setTable({ ...table }, 0.06);
    expect(resources.tableDress.children[0]).toBe(firstTrim);
    expect(dispose).not.toHaveBeenCalled();
    room.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(resources.tableDress);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-0.8);
    expect(bounds.max.x).toBeLessThanOrEqual(0.8);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-0.8);
    expect(bounds.max.z).toBeLessThanOrEqual(0.8);
    room.setTable({ ...table, materialId: 'marble' }, 0.06);
    expect(dispose).toHaveBeenCalledOnce();
    const silver = (resources.tableDress.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(silver.color.getHex()).toBe(0x8bafaf);
    room.dispose();
  });

  it('releases shared geometries, materials and every instance buffer once', () => {
    const room = new TavernEnvironment();
    room.setTable({ shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' }, 0.06);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const instances: THREE.InstancedMesh[] = [];
    room.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instances.push(object);
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    const checks = [...geometries, ...materials, ...instances].map((resource) => vi.spyOn(resource, 'dispose'));
    room.dispose(); room.dispose();
    checks.forEach((check) => expect(check).toHaveBeenCalledOnce());
    expect(room.children).toHaveLength(0);
  });
});
