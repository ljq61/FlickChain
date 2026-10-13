// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TavernEnvironment } from '../../src/rendering/TavernEnvironment';
import { SceneManager } from '../../src/rendering/SceneManager';

// Keep production camera placement and real mesh geometry; only GPU work is mocked.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      shadowMap = {};
      setPixelRatio() {} setSize() {} render() {} dispose() {}
    },
    PMREMGenerator: class {
      fromScene() { return new actual.WebGLRenderTarget(1, 1); }
      dispose() {}
    },
  };
});
vi.mock('../../src/rendering/FlickFinger', async () => {
  const { Group } = await import('three');
  return { FlickFinger: class extends Group { dispose() {} load() { return Promise.resolve(); } } };
});

function withMenuCamera(width: number, height: number, check: (camera: THREE.PerspectiveCamera, pendant: THREE.Group) => void): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
  document.body.append(host);
  const scene = new SceneManager(host);
  const { camera, tavern } = scene as unknown as { camera: THREE.PerspectiveCamera; tavern: { pendant: THREE.Group } };
  tavern.pendant.updateWorldMatrix(true, true);
  try { check(camera, tavern.pendant); }
  finally { scene.dispose(); host.remove(); vi.restoreAllMocks(); }
}

/** Bypass decorative picking no-ops to inspect the opaque surfaces actually rendered. */
function opaqueLampHits(pendant: THREE.Group, origin: THREE.Vector3, target: THREE.Vector3): THREE.Intersection[] {
  const raycaster = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
  const hits: THREE.Intersection[] = [];
  pendant.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
    const material = object.material as THREE.Material;
    if (material.transparent && material.opacity < 1) return;
    THREE.Mesh.prototype.raycast.call(object, raycaster, hits);
  });
  return hits.sort((a, b) => a.distance - b.distance);
}

describe('decorative tavern resources', () => {
  it.each([[320, 568], [390, 844], [844, 390], [1280, 720], [1440, 900]])('shows a luminous bulb through an open shade from the production %s×%s menu camera', (width, height) => {
    withMenuCamera(width, height, (camera, pendant) => {
      const bulb = pendant.children.find((object) => object instanceof THREE.Mesh && object.geometry instanceof THREE.SphereGeometry) as THREE.Mesh;
      const center = bulb.getWorldPosition(new THREE.Vector3());
      const scale = bulb.getWorldScale(new THREE.Vector3()).x;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      // Center plus four points across the globe must hit it before any opaque cover.
      for (const [x, y] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const target = center.clone().addScaledVector(right, x * 0.023 * scale).addScaledVector(up, y * 0.023 * scale);
        expect(opaqueLampHits(pendant, camera.position, target)[0]?.object).toBe(bulb);
      }
      expect((bulb.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
      const shade = pendant.getObjectByName('lamp-shade') as THREE.Mesh;
      // Stay off the lathe's exact meridian seam when probing its outward faces.
      const shadeCenter = shade.localToWorld(new THREE.Vector3(0.04, 0.06, 0.257));
      expect(opaqueLampHits(pendant, camera.position, shadeCenter)[0]?.object).toBe(shade);
      const centerScreen = center.clone().project(camera);
      expect(Math.abs(centerScreen.x)).toBeLessThan(1);
      expect(centerScreen.y).toBeLessThan(1);
      // Shade, lip and whole globe stay in the title-safe band; the cord leaves the screen.
      for (const name of ['lamp-shade', 'lamp-interior', 'lamp-lip', 'lamp-bulb']) {
        const mesh = pendant.getObjectByName(name) as THREE.Mesh;
        const positions = mesh.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld).project(camera);
          const pixelY = (1 - point.y) * height / 2;
          expect(pixelY).toBeGreaterThan(0);
          expect(pixelY).toBeLessThan(height * (height < 700 ? 0.125 : 0.15));
        }
      }
      const glow = pendant.getObjectByName('lamp-bulb-glow') as THREE.Sprite;
      const glowScale = glow.getWorldScale(new THREE.Vector3());
      // Sprites billboard toward the camera: inspect that rendered footprint, not its local box.
      for (const [x, y] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const edge = center.clone().addScaledVector(right, x * glowScale.x / 2).addScaledVector(up, y * glowScale.y / 2).project(camera);
        const pixelY = (1 - edge.y) * height / 2;
        expect(pixelY).toBeGreaterThan(0);
        expect(pixelY).toBeLessThan(height * (height < 700 ? 0.125 : 0.15));
      }
      pendant.visible = false;
      expect(opaqueLampHits(pendant, camera.position, center)).toEqual([]);
    });
  });

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
    const textures = new Set<THREE.Texture>();
    const instances: THREE.InstancedMesh[] = [];
    room.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instances.push(object);
      if (object instanceof THREE.Sprite) {
        materials.add(object.material);
        if (object.material.map) textures.add(object.material.map);
      }
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    expect(textures.size).toBe(1);
    const checks = [...geometries, ...materials, ...textures, ...instances].map((resource) => vi.spyOn(resource, 'dispose'));
    room.dispose(); room.dispose();
    checks.forEach((check) => expect(check).toHaveBeenCalledOnce());
    expect(room.children).toHaveLength(0);
  });
});
