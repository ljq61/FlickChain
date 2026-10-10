import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COIN_RADIUS } from '../../src/physics/MaterialRegistry';
import { FlickFinger } from '../../src/rendering/FlickFinger';

const file = readFileSync(new URL('../../public/models/flick-hand.glb', import.meta.url));
const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const coin = { x: 0.14, z: -0.21 };
const direction = { x: 0.6, z: -0.8 };

function editAssetJSON(edit: (json: any) => void): ArrayBuffer {
  const view = new DataView(bytes);
  const oldLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, oldLength)));
  edit(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const newLength = Math.ceil(encoded.length / 4) * 4;
  const result = new Uint8Array(bytes.byteLength - oldLength + newLength);
  result.set(new Uint8Array(bytes, 0, 20));
  result.fill(0x20, 20, 20 + newLength);
  result.set(encoded, 20);
  result.set(new Uint8Array(bytes, 20 + oldLength), 20 + newLength);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(8, result.byteLength, true);
  resultView.setUint32(12, newLength, true);
  return result.buffer;
}

function meshVertices(hand: FlickFinger, meshName?: string, refresh = true): THREE.Vector3[] {
  if (refresh) {
    let root: THREE.Object3D = hand;
    while (root.parent) root = root.parent;
    root.updateMatrixWorld(true);
  }
  const vertices: THREE.Vector3[] = [];
  hand.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || (meshName && object.name !== meshName)) return;
    const positions = object.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      vertices.push(object.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(object.matrixWorld));
    }
  });
  return vertices;
}

function fixedFistVertices(hand: FlickFinger): THREE.Vector3[] {
  const mesh = hand.getObjectByName('hand_skin') as THREE.SkinnedMesh;
  const root = mesh.skeleton.bones.findIndex((bone) => bone.name === 'hand_root');
  const ids = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < weights.count; i++) {
    const fixed = [0, 1, 2, 3].every((c) => weights.getComponent(i, c) < 1e-6 || ids.getComponent(i, c) === root);
    if (fixed) result.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  }
  return result;
}

describe('the shipped Blender hand asset', () => {
  let hand: FlickFinger;

  beforeEach(() => { hand = new FlickFinger(); hand.visible = true; });
  afterEach(() => { hand.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('loads real skinned geometry, blends joint weights and places the straight finger behind the coin for any yaw', async () => {
    await hand.load(bytes);
    const skin = hand.getObjectByName('hand_skin') as THREE.SkinnedMesh;
    expect(skin).toBeInstanceOf(THREE.SkinnedMesh);
    expect(skin.skeleton.bones.map((bone) => bone.name)).toEqual(expect.arrayContaining(['hand_root', 'index_mcp', 'index_pip', 'index_dip']));
    const weights = skin.geometry.getAttribute('skinWeight');
    let blended = false;
    for (let index = 0; index < weights.count; index++) {
      const components = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
      expect(components.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
      if (components.filter((value) => value > 0.001).length > 1) blended = true;
    }
    expect(blended).toBe(true);
    for (let step = 0; step < 8; step++) {
      const yaw = step * Math.PI / 4;
      const aim = { x: Math.sin(yaw), z: Math.cos(yaw) };
      hand.setPose(coin, aim, 0);
      const axis = hand.getHitPoints().slice(0, 8);
      expect(axis).toHaveLength(8);
      for (const point of axis) {
        expect((point.x - coin.x) * aim.z - (point.z - coin.z) * aim.x).toBeCloseTo(0, 6);
        expect(point.y).toBeCloseTo(0.025, 6);
      }
      expect(Math.hypot(axis[7].x - coin.x, axis[7].z - coin.z)).toBeCloseTo(COIN_RADIUS + 0.002, 6);
      expect(hand.position.y).toBe(0);
    }
  });

  it('samples the exported bone animation progressively, deforms skin, leaves the fist fixed and reverses on cancellation', async () => {
    await hand.load(bytes);
    hand.setPose(coin, direction, 0);
    const idleAxis = hand.getHitPoints().slice(0, 8);
    const idleSkin = meshVertices(hand, 'hand_skin');
    const idleFist = fixedFistVertices(hand);
    expect(idleFist.length).toBeGreaterThan(1000);
    const root = hand.position.clone();
    let previous = COIN_RADIUS + 0.002 - 0.00001;
    for (let step = 0; step <= 10; step++) {
      hand.setPose(coin, direction, step / 10);
      const points = hand.getHitPoints().slice(0, 8);
      const retreat = Math.hypot(points[7].x - coin.x, points[7].z - coin.z);
      expect(retreat).toBeGreaterThan(previous);
      previous = retreat;
      expect(hand.position).toEqual(root);
    }
    const chargedSkin = meshVertices(hand, 'hand_skin');
    expect(Math.max(...chargedSkin.map((vertex, index) => vertex.distanceTo(idleSkin[index])))).toBeGreaterThan(0.03);
    expect(fixedFistVertices(hand)).toEqual(idleFist);
    const charged = hand.getHitPoints();
    expect(Math.max(...charged.slice(0, 8).map((p) => p.y))).toBeGreaterThan(charged[7].y + 0.02);
    hand.setPose(coin, direction, 0);
    expect(hand.getHitPoints().slice(0, 8)).toEqual(idleAxis);
    expect(meshVertices(hand, 'hand_skin')).toEqual(idleSkin);
  });

  it('ships one closed connected hand skin and keeps every exported seam together throughout charge', async () => {
    await hand.load(bytes);
    expect(hand.getObjectByName('fist')).toBeUndefined();
    expect(hand.getObjectByName('index_skin')).toBeUndefined();
    const skin = hand.getObjectByName('hand_skin') as THREE.SkinnedMesh;
    expect(skin).toBeInstanceOf(THREE.SkinnedMesh);
    const positions = skin.geometry.getAttribute('position');
    const groups = new Map<string, number[]>();
    const welded: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map((v) => Math.round(v * 1e7)).join(',');
      let group = groups.get(key);
      if (!group) { group = []; groups.set(key, group); }
      group.push(i);
      welded[i] = group[0];
    }
    const edges = new Map<string, number>();
    const neighbors = new Map<number, Set<number>>();
    const indices = skin.geometry.index!;
    for (let offset = 0; offset < indices.count; offset += 3) {
      const face = [0, 1, 2].map((i) => welded[indices.getX(offset + i)]);
      expect(new Set(face).size).toBe(3);
      for (let i = 0; i < 3; i++) {
        const a = face[i], b = face[(i + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
        if (!neighbors.has(a)) neighbors.set(a, new Set());
        neighbors.get(a)!.add(b);
        if (!neighbors.has(b)) neighbors.set(b, new Set());
        neighbors.get(b)!.add(a);
      }
    }
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
    const visited = new Set<number>();
    const stack = [welded[0]];
    while (stack.length) {
      const vertex = stack.pop()!;
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const next of neighbors.get(vertex) ?? []) if (!visited.has(next)) stack.push(next);
    }
    expect(visited.size).toBe(groups.size);
    hand.setPose(coin, direction, 0);
    const fixed = fixedFistVertices(hand);
    for (let frame = 0; frame <= 24; frame++) {
      hand.setPose(coin, direction, frame / 24);
      expect(fixedFistVertices(hand)).toEqual(fixed);
      for (const group of groups.values()) {
        const first = skin.getVertexPosition(group[0], new THREE.Vector3());
        for (const index of group.slice(1)) expect(skin.getVertexPosition(index, new THREE.Vector3()).distanceTo(first)).toBeLessThan(1e-7);
      }
    }
  });

  it('matches renderer skin and hit positions before and after updates with transformed ancestors', async () => {
    const scene = new THREE.Group();
    const parent = new THREE.Group();
    parent.position.set(0.7, 0.12, -0.3);
    parent.rotation.set(0.13, 0.41, -0.07);
    parent.scale.set(1.1, 0.9, 0.8);
    scene.add(parent);
    parent.add(hand);
    await hand.load(bytes);
    for (const power of [0, 0.5, 1]) {
      hand.setPose(coin, direction, power);
      // Capture directly before getHitPoints can refresh anything. This fails
      // if setPose skips SkinnedMesh's attached bindMatrixInverse update.
      const beforeSkin = meshVertices(hand, undefined, false);
      const beforeHits = hand.getHitPoints();
      scene.updateMatrixWorld(true);
      const renderedSkin = meshVertices(hand, undefined, false);
      const renderedHits = hand.getHitPoints();
      expect(Math.max(...beforeSkin.map((point, index) => point.distanceTo(renderedSkin[index])))).toBeLessThan(1e-9);
      expect(Math.max(...beforeHits.map((point, index) => Math.hypot(
        point.x - renderedHits[index].x, point.y - renderedHits[index].y, point.z - renderedHits[index].z,
      )))).toBeLessThan(1e-9);
    }
    // A parent may change after setPose; hit queries still need renderer-equivalent
    // matrices without waiting for the next scene render.
    parent.position.x += 0.17;
    parent.rotation.y -= 0.3;
    const movedHits = hand.getHitPoints();
    const movedSkin = meshVertices(hand, undefined, false);
    scene.updateMatrixWorld(true);
    expect(meshVertices(hand, undefined, false)).toEqual(movedSkin);
    expect(hand.getHitPoints()).toEqual(movedHits);
  });

  it('keeps actual deformed vertices above the tabletop and behind the coin at intermediate and full charge', async () => {
    await hand.load(bytes);
    let lowest = Infinity;
    let nearest = -Infinity;
    for (let step = 0; step <= 24; step++) {
      hand.setPose(coin, direction, step / 24, step > 16 ? 1 + step / 17 : 0);
      for (const vertex of meshVertices(hand)) {
        lowest = Math.min(lowest, vertex.y);
        nearest = Math.max(nearest, (vertex.x - coin.x) * direction.x + (vertex.z - coin.z) * direction.z);
      }
    }
    expect(lowest).toBeGreaterThan(0.0019);
    expect(nearest).toBeLessThan(-COIN_RADIUS - 0.001);
  });

  it('uses real animated surface samples to cover the whole hand and sleeve in close portrait and desktop views', async () => {
    await hand.load(bytes);
    for (const charge of [0, 0.5, 1]) {
      hand.setPose({ x: 0, z: 0 }, { x: 0, z: -1 }, charge);
      const hitPoints = hand.getHitPoints();
      expect(hitPoints.length).toBeGreaterThan(32);
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
        const camera = new THREE.PerspectiveCamera(42, viewport.width / viewport.height, 0.02, 30);
        camera.position.set(0, Math.sin(0.92) * 0.9, Math.cos(0.92) * 0.9);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const screen = (point: THREE.Vector3) => {
          const projected = point.clone().project(camera);
          return { x: (projected.x + 1) * viewport.width / 2, y: (1 - projected.y) * viewport.height / 2 };
        };
        const markers = hitPoints.map((point) => screen(new THREE.Vector3(point.x, point.y, point.z)));
        let largestGap = 0;
        for (const vertex of meshVertices(hand)) {
          const point = screen(vertex);
          largestGap = Math.max(largestGap, Math.min(...markers.map((marker) => Math.hypot(marker.x - point.x, marker.y - point.y))));
        }
        expect(largestGap).toBeLessThan(40);
      }
    }
  });

  it('adds root tremor only at high charge, respects still poses and restores the idle pose completely', async () => {
    await hand.load(bytes);
    hand.setPose(coin, direction, 0);
    const idle = hand.getHitPoints();
    for (const power of [0, 0.4, 0.68]) {
      hand.setPose(coin, direction, power, 1);
      const first = hand.getHitPoints();
      hand.setPose(coin, direction, power, 1.13);
      expect(hand.getHitPoints()).toEqual(first);
    }
    hand.setPose(coin, direction, 1);
    const still = hand.getHitPoints();
    hand.setPose(coin, direction, 1, 0);
    expect(hand.getHitPoints()).toEqual(still);
    hand.setPose(coin, direction, 1, 1);
    const first = hand.getHitPoints();
    hand.setPose(coin, direction, 1, 1.13);
    const second = hand.getHitPoints();
    const displacement = Math.max(...first.map((point, index) => Math.hypot(point.x - second[index].x, point.y - second[index].y, point.z - second[index].z)));
    expect(displacement).toBeGreaterThan(0.0005);
    expect(displacement).toBeLessThan(0.009);
    hand.setPose(coin, direction, 0, 2);
    expect(hand.getHitPoints()).toEqual(idle);
  });

  it('deduplicates pending loads, retries request failures and applies a pose requested before loading', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
    vi.stubGlobal('fetch', fetchMock);
    expect(hand.getHitPoints()).toEqual([]);
    await expect(hand.load()).rejects.toThrow('503');
    hand.setPose(coin, direction, 0.5);
    const first = hand.load();
    expect(hand.load()).toBe(first);
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/models\/flick-hand\.glb$/);
    expect(hand.getHitPoints()[3].y).toBeGreaterThan(0.03);
    await hand.load();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('strictly rejects missing bones, markers and animation contracts then permits loading the real asset', async () => {
    for (const name of ['index_pip', 'hit_axis_07']) {
      const invalid = editAssetJSON((json) => { json.nodes.find((node: any) => node.name === name).name = `missing_${name}`; });
      await expect(hand.load(invalid)).rejects.toThrow(/missing/);
      expect(hand.getHitPoints()).toEqual([]);
    }
    await expect(hand.load(editAssetJSON((json) => { json.animations[0].name = 'WrongClip'; }))).rejects.toThrow('FlickCharge');
    await hand.load(bytes);
    expect(hand.getHitPoints().length).toBeGreaterThan(8);
  });

  it('aborts downloads on disposal and safely disposes a GLB that finishes parsing after disposal', async () => {
    let resolveResponse!: (value: unknown) => void;
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      requestSignal = init.signal;
      return new Promise((resolve) => { resolveResponse = resolve; });
    }));
    const downloading = hand.load();
    hand.dispose();
    expect(requestSignal!.aborted).toBe(true);
    resolveResponse({ ok: true, arrayBuffer: async () => bytes });
    await expect(downloading).rejects.toThrow('disposed');
    const parsing = new FlickFinger();
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const loading = parsing.load(bytes);
    parsing.dispose();
    await expect(loading).rejects.toThrow('disposed');
    expect(geometryDispose).toHaveBeenCalled();
    expect(parsing.children).toHaveLength(0);
    expect(parsing.getHitPoints()).toEqual([]);
    await expect(parsing.load(bytes)).rejects.toThrow('disposed');
  });

  it('releases loaded geometry, materials and skeletons exactly once and disables hidden hit points', async () => {
    await hand.load(bytes);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const skeletons = new Set<THREE.Skeleton>();
    hand.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    });
    const geometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'));
    const skeletonSpies = [...skeletons].map((skeleton) => vi.spyOn(skeleton, 'dispose'));
    hand.visible = false;
    expect(hand.getHitPoints()).toEqual([]);
    hand.dispose();
    hand.dispose();
    for (const spy of [...geometrySpies, ...materialSpies, ...skeletonSpies]) expect(spy).toHaveBeenCalledTimes(1);
  });
});
