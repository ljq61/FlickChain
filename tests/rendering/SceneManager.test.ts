// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../../src/rendering/SceneManager';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { AimPreview, GameView, LevelConfig, WorldFrame } from '../../src/types/contracts';

// Resource and presentation lifecycle checks use real geometries, without claiming WebGL rendering.
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
  return { FlickFinger: class extends Group { setPose() {} getHitPoints() { return []; } dispose() {} load() { return Promise.resolve(); } } };
});

function level(materialId: 'wood' | 'marble' = 'wood', glassId = 'cup'): LevelConfig {
  return {
    schemaVersion: 1, id: 'round-3', name: '', lesson: '',
    table: { shape: 'circle', width: 1.6, depth: 1.6, materialId }, activeCoinId: 'survivor',
    coins: [{ id: 'survivor', x: 0.3, z: 0.25, materialId: 'iron' }, { id: 'new', x: -0.3, z: -0.25, materialId: 'standard' }],
    obstacles: [{ id: glassId, kind: 'glass', x: 0.1, z: 0.1, width: 0.14, depth: 0.14 }],
  };
}
function frame(config: LevelConfig): WorldFrame {
  return { table: config.table, obstacles: config.obstacles, coins: config.coins.map((coin) => ({ id: coin.id, materialId: coin.materialId, position: { x: coin.x, y: 0.004, z: coin.z }, rotation: { x: 0, y: 0, z: 0, w: 1 } })) };
}
const ready: GameView = { sessionId: 's', revision: 0, mode: 'challenge', phase: 'ready', levelId: 'round-3', activeCoinId: 'survivor', canSelectCoin: false, currentPlayer: 0, scores: [0, 0], remaining: 2, chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null };
type Resources = { coinMeshes: Map<string, THREE.Group>; obstacleMeshes: Map<string, { group: THREE.Group }>; board: THREE.Mesh };

/** CPU geometry intersections, with the same world-plane discard as WebGL clipping. */
function visibleSceneryHits(room: THREE.Group, origin: THREE.Vector3, target: THREE.Vector3): THREE.Intersection[] {
  const raycaster = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target) - 0.002);
  const hits: THREE.Intersection[] = [];
  room.updateMatrixWorld(true);
  room.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
    const geometric: THREE.Intersection[] = [];
    // Deliberately bypass decorative raycast no-ops; picking checks cannot prove visibility.
    if (object instanceof THREE.InstancedMesh) THREE.InstancedMesh.prototype.raycast.call(object, raycaster, geometric);
    else THREE.Mesh.prototype.raycast.call(object, raycaster, geometric);
    for (const hit of geometric) {
      const material = Array.isArray(object.material) ? object.material[hit.face?.materialIndex ?? 0] : object.material;
      if (!material.clippingPlanes?.some((plane: THREE.Plane) => plane.distanceToPoint(hit.point) < 0)) hits.push(hit);
    }
  });
  return hits;
}

describe('campaign scene resource continuity', () => {
  let host: HTMLDivElement;
  let scene: SceneManager;
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      createRadialGradient: () => ({ addColorStop() {} }),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    host = document.createElement('div'); document.body.append(host);
    scene = new SceneManager(host);
  });
  afterEach(() => { scene.dispose(); host.remove(); vi.restoreAllMocks(); });

  it('keeps the survivor mesh, exact authoritative pose and orbit while dropping only new coins', () => {
    const old = level();
    scene.setLevel(old); scene.render(frame(old), ready, null);
    const resources = scene as unknown as Resources;
    const survivor = resources.coinMeshes.get('survivor')!;
    scene.focusCoin('survivor'); scene.orbitBy(52, 12);
    const direction = scene.getAimDirection();
    const next = { ...old, id: 'round-4', coins: [old.coins[0], { ...old.coins[1], id: 'next' }], obstacles: [] };
    scene.setLevel(next, true); scene.beginCoinArrival(['next']);
    scene.render(frame(next), ready, null);
    expect(resources.coinMeshes.get('survivor')).toBe(survivor);
    expect(survivor.position.toArray()).toEqual([0.3, 0.004, 0.25]);
    expect(resources.coinMeshes.get('next')!.position.y).toBeGreaterThan(0.004);
    expect(scene.getAimDirection().x).toBeCloseTo(direction.x, 10);
    expect(scene.getAimDirection().z).toBeCloseTo(direction.z, 10);
  });

  it.each([[390, 844], [1280, 720]])('resets both opening trials to the whole-board bottom-to-top view at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config: LevelConfig = { ...level(), obstacles: [], activeCoinId: 'start', coins: [{ id: 'start', x: 0, z: .64, materialId: 'standard' }] };
    scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    scene.render(frame(config), { ...ready, activeCoinId: 'start' }, null);
    scene.orbitBy(480, 180); scene.focusCoin('start');
    scene.resetView();
    const opening: GameView = { ...ready, mode: 'battle', activeCoinId: 'start', battle: { variant: 'pvp', stage: 'opening', distances: [null, null], fallen: [false, false], openingAttempt: 1 } };
    for (let step = 0; step < 60; step++) scene.render(frame(config), opening, null);
    const resources = scene as unknown as { cameraFocus: THREE.Vector3; desiredFocus: THREE.Vector3; finger: THREE.Group; camera: THREE.PerspectiveCamera };
    expect(scene.getAimDirection().x).toBeCloseTo(0, 10);
    expect(scene.getAimDirection().z).toBeCloseTo(-1, 10);
    expect(resources.cameraFocus.toArray()).toEqual([0, 0, 0]);
    expect(resources.desiredFocus.toArray()).toEqual([0, 0, 0]);
    expect(resources.finger.visible).toBe(true);
    for (let angle = 0; angle < 360; angle += 10) {
      const point = scene.projectToScreen({ x: .8 * Math.cos(angle * Math.PI / 180), y: .004, z: .8 * Math.sin(angle * Math.PI / 180) });
      expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(width);
      expect(point.y).toBeGreaterThan(height * .22); expect(point.y).toBeLessThan(height * .8);
    }
    const trialPosition = resources.camera.position.clone();
    const aim: AimPreview = { source: frame(config).coins[0].position, direction: { x: 0, z: -1 }, power: .5 };
    scene.render(frame(config), opening, aim);
    expect(resources.camera.position.equals(trialPosition)).toBe(true);
  });

  it('removes every human-control visual on computer ownership and restores it on the human turn', () => {
    const config = level(); scene.setLevel(config);
    const authoritative = frame(config);
    const resources = scene as unknown as Resources & { finger: THREE.Group; glowLight: THREE.PointLight; ironMaterial: THREE.Material; brassMaterial: THREE.Material };
    scene.render(authoritative, ready, null);
    expect(resources.finger.visible).toBe(true);
    for (const phase of ['ready', 'selecting'] as const) {
      scene.render(authoritative, { ...ready, mode: 'battle', phase, inputOwner: 'computer' }, null);
      expect(resources.finger.visible).toBe(false);
      expect(resources.glowLight.intensity).toBe(0);
      expect(resources.coinMeshes.get('survivor')!.userData.body.material).toBe(resources.ironMaterial);
      expect(resources.coinMeshes.get('new')!.userData.body.material).toBe(resources.brassMaterial);
    }
    scene.render(authoritative, { ...ready, inputOwner: 'human' }, null);
    expect(resources.finger.visible).toBe(true);
    scene.render(authoritative, { ...ready, phase: 'refilling' }, null);
    expect(resources.finger.visible).toBe(false);
  });

  it.each([[320, 568], [390, 844], [1280, 720]])('anchors an upward charge fill left of the hand, follows the camera and clamps inside %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 37, top: 19, width, height } as DOMRect);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 37, top: 19, width, height } as DOMRect);
    const config = level(); scene.setLevel(config);
    const finger = (scene as unknown as { finger: THREE.Group & { getHitPoints(): { x: number; y: number; z: number }[] } }).finger;
    finger.position.set(.3, 0, .4); finger.updateMatrixWorld(true);
    const samples = vi.spyOn(finger, 'getHitPoints').mockImplementation(() => [
      { x: .24, y: .01, z: .28 }, { x: .36, y: .06, z: .48 },
    ]);
    const authoritative = frame(config);
    const meter = host.querySelector<HTMLElement>('[role="progressbar"]')!;
    const fill = meter.querySelector<HTMLElement>('.charge-meter-fill')!;
    const aim: AimPreview = { source: authoritative.coins[0].position, direction: { x: 0, z: -1 }, power: .25 };
    scene.render(authoritative, ready, null);
    expect(meter.hidden).toBe(true);
    scene.render(authoritative, ready, aim);
    expect(meter.hidden).toBe(false);
    expect(meter.getAttribute('aria-label')).toBe('Flick power');
    expect(meter.hasAttribute('aria-live')).toBe(false);
    expect(meter.getAttribute('aria-valuenow')).toBe('25');
    expect(fill.style.clipPath).toBe('inset(75% 0 0)');
    const coordinates = () => meter.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/)!.slice(1).map(Number);
    const first = coordinates();
    const handLeft = Math.min(...samples.mock.results[0].value!.map((point: { x: number; y: number; z: number }) => scene.projectToScreen(point).x)) - 37;
    expect(first[0] + 14).toBeLessThan(handLeft);
    expect(first[0]).toBeGreaterThanOrEqual(8); expect(first[0] + 14).toBeLessThanOrEqual(width - 8);
    expect(first[1]).toBeGreaterThanOrEqual(8); expect(first[1] + 84).toBeLessThanOrEqual(height - 8);
    scene.render(authoritative, ready, { ...aim, power: .6 });
    expect(fill.style.clipPath).toBe('inset(40% 0 0)');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
    scene.orbitBy(100, 20);
    scene.render(authoritative, ready, { ...aim, power: 1 });
    expect(coordinates()).not.toEqual(first);
    expect(fill.style.clipPath).toBe('inset(0% 0 0)');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
    finger.position.x = -3; finger.updateMatrixWorld(true);
    scene.render(authoritative, ready, aim);
    const edge = coordinates();
    expect(edge[0]).toBeGreaterThanOrEqual(8); expect(edge[0] + 14).toBeLessThanOrEqual(width - 8);
    expect(edge[1]).toBeGreaterThanOrEqual(8); expect(edge[1] + 84).toBeLessThanOrEqual(height - 8);
    expect(samples).toHaveBeenCalledOnce();
  });

  it('hides the charge meter on release, cancellation, overlays, AI, arrival and missing hand, then removes it on disposal', () => {
    const width = 390, height = 844;
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    const config = level(); scene.setLevel(config);
    const finger = (scene as unknown as { finger: THREE.Group & { getHitPoints(): { x: number; y: number; z: number }[] } }).finger;
    vi.spyOn(finger, 'getHitPoints').mockReturnValue([{ x: -.06, y: .01, z: .02 }, { x: .06, y: .06, z: .22 }]);
    const authoritative = frame(config);
    const aim: AimPreview = { source: authoritative.coins[0].position, direction: { x: 0, z: -1 }, power: .75 };
    const meter = host.querySelector<HTMLElement>('[role="progressbar"]')!;
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
    scene.render(authoritative, ready, null); expect(meter.hidden).toBe(true);
    for (const phase of ['paused', 'simulating', 'complete', 'failed', 'refilling', 'selecting', 'error'] as const) {
      scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
      scene.render(authoritative, { ...ready, phase }, aim); expect(meter.hidden).toBe(true);
    }
    scene.render(authoritative, { ...ready, inputOwner: 'computer' }, aim); expect(meter.hidden).toBe(true);
    scene.render(authoritative, null, aim); expect(meter.hidden).toBe(true);
    scene.render({ ...authoritative, coins: [] }, ready, aim); expect(meter.hidden).toBe(true);
    scene.render(authoritative, ready, { ...aim, power: NaN }); expect(meter.hidden).toBe(true);
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
    scene.clearFocus(); expect(meter.hidden).toBe(true);
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
    scene.resetView(); expect(meter.hidden).toBe(true);
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
    scene.setLevel(config); expect(meter.hidden).toBe(true);
    scene.beginCoinArrival(config.coins.map((coin) => coin.id));
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(true);
    for (let i = 0; i < 100; i++) scene.advanceCoinArrival(1 / 60);
    scene.render(authoritative, ready, aim); expect(meter.hidden).toBe(false);
    scene.dispose(); scene.dispose(); expect(meter.isConnected).toBe(false);
  });

  it('keeps old cups on revival, drops newly created cups even without new coins, and lifts them on clearing', () => {
    const config = level(); scene.setLevel(config); scene.beginCoinArrival(config.coins.map((coin) => coin.id));
    for (let i = 0; i < 100; i++) scene.advanceCoinArrival(1 / 60);
    scene.render(frame(config), ready, null);
    const resources = scene as unknown as Resources;
    const oldCup = resources.obstacleMeshes.get('cup')!.group;
    scene.setLevel(config, true); scene.beginCoinArrival([]);
    expect(scene.isIntroducing).toBe(false);
    expect(resources.obstacleMeshes.get('cup')!.group).toBe(oldCup);
    scene.beginObstacleRemoval(); scene.advanceObstacleRemoval(0.1); scene.render(frame(config), { ...ready, phase: 'complete' }, null);
    expect(oldCup.position.y).toBeGreaterThan(0);
    expect(config.obstacles[0]).toEqual({ id: 'cup', kind: 'glass', x: 0.1, z: 0.1, width: 0.14, depth: 0.14 });
    for (let i = 0; i < 100; i++) scene.advanceObstacleRemoval(1 / 60);
    scene.render(frame(config), { ...ready, phase: 'complete' }, null);
    expect(oldCup.visible).toBe(false);
    const disposal = vi.spyOn((oldCup.children[0] as THREE.Mesh).geometry, 'dispose');
    const next = level('marble', 'new-cup'); scene.setLevel(next, true); scene.beginCoinArrival([]);
    expect(disposal).toHaveBeenCalledOnce(); expect(resources.obstacleMeshes.has('cup')).toBe(false);
    expect(scene.isIntroducing).toBe(true);
    scene.render(frame(next), ready, null);
    expect(resources.obstacleMeshes.get('new-cup')!.group.position.y).toBeGreaterThan(0);
  });

  it('uses larger blue-green iron coins and a polished dark marble surface with a half-filled thick-bottom glass', () => {
    const config = level('marble'); scene.setLevel(config); scene.render(frame(config), { ...ready, phase: 'paused' }, null);
    const resources = scene as unknown as Resources;
    const coin = resources.coinMeshes.get('survivor')!;
    expect(coin.scale.toArray()).toEqual([1.12, 1, 1.12]);
    expect((coin.userData.body.material as THREE.MeshPhysicalMaterial).color.getHex()).toBe(0x6e929b);
    const surface = (resources.board.material as THREE.MeshPhysicalMaterial[])[1];
    expect(surface.roughness).toBe(0.12); expect(surface.clearcoat).toBe(1);
    expect(surface.clearcoatRoughness).toBeLessThan(0.1);
    expect(surface.envMap).toBe((scene as unknown as { environment: THREE.WebGLRenderTarget }).environment.texture);
    const edge = (resources.board.material as THREE.MeshPhysicalMaterial[])[0];
    expect(edge.map).toBe(surface.map); expect(edge.color.getHex()).toBe(0xffffff);
    const cup = resources.obstacleMeshes.get('cup')!.group;
    expect((cup.children[0] as THREE.Mesh).geometry.type).toBe('LatheGeometry');
    expect(cup.children.length).toBe(4);
    const body = (cup.children[0] as THREE.Mesh<THREE.LatheGeometry>).geometry.parameters.points;
    expect(body.at(-1)!.y).toBeCloseTo(PHYSICS_CONFIG.glassHeight * 0.2);
    const liquid = cup.children[3] as THREE.Mesh<THREE.LatheGeometry, THREE.MeshPhysicalMaterial>;
    const bounds = new THREE.Box3().setFromObject(liquid);
    expect(bounds.min.y).toBeGreaterThan(PHYSICS_CONFIG.glassHeight * 0.2);
    expect(bounds.max.y).toBeCloseTo(PHYSICS_CONFIG.glassHeight * 0.6);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(config.obstacles[0].width * 0.9);
    expect(liquid.material.vertexColors).toBe(true);
    const colors = liquid.geometry.getAttribute('color');
    const positions = liquid.geometry.getAttribute('position');
    let sideRed = 0, surfaceRed = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (positions.getY(vertex) < PHYSICS_CONFIG.glassHeight * 0.3) sideRed = colors.getX(vertex);
      if (positions.getY(vertex) > PHYSICS_CONFIG.glassHeight * 0.59) surfaceRed = colors.getX(vertex);
    }
    expect(sideRed).toBeGreaterThan(0); expect(surfaceRed).toBeGreaterThan(sideRed);
    expect(liquid.material.transmission).toBe(0); expect(liquid.material.clearcoat).toBe(1);
  });

  it.each([0.1, 0.14, 0.18])('keeps every glass face above the table and within physical bounds at diameter %s, with visible inner and curved outer walls', (diameter) => {
    const config = level(); config.obstacles[0].width = config.obstacles[0].depth = diameter;
    scene.setLevel(config); scene.render(frame(config), { ...ready, phase: 'paused' }, null);
    const resources = scene as unknown as Resources;
    const cup = resources.obstacleMeshes.get('cup')!.group;
    cup.updateWorldMatrix(true, true);
    const tableTop = new THREE.Box3().setFromObject(resources.board).max.y;
    const bounds = new THREE.Box3().setFromObject(cup);
    expect(cup.position.toArray()).toEqual([config.obstacles[0].x, 0, config.obstacles[0].z]);
    expect(bounds.min.y - tableTop).toBeGreaterThan(0.001);
    expect(bounds.max.y).toBeCloseTo(PHYSICS_CONFIG.glassHeight, 6);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(config.obstacles[0].width + 0.000001);
    expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(config.obstacles[0].depth + 0.000001);
    const body = cup.children[0] as THREE.Mesh<THREE.LatheGeometry, THREE.MeshPhysicalMaterial>;
    const direction = new THREE.Vector3(0.6, 0, 0.8);
    const center = new THREE.Vector3(cup.position.x, PHYSICS_CONFIG.glassHeight * 0.6, cup.position.z);
    const innerHits = new THREE.Raycaster(center, direction).intersectObject(body, false);
    const outerHits = new THREE.Raycaster(center.clone().addScaledVector(direction, 0.1), direction.clone().negate()).intersectObject(body, false);
    expect(innerHits.length).toBeGreaterThan(0); expect(outerHits.length).toBeGreaterThan(0);
    expect(innerHits[0].face!.normal.dot(direction)).toBeLessThan(-0.95);
    expect(outerHits[0].face!.normal.dot(direction)).toBeGreaterThan(0.95);
    // The shoulder bends its refraction normal while the middle remains nearly vertical.
    const shoulderOrigin = center.clone().addScaledVector(direction, 0.1); shoulderOrigin.y = PHYSICS_CONFIG.glassHeight * 0.9;
    const shoulderHits = new THREE.Raycaster(shoulderOrigin, direction.clone().negate()).intersectObject(body, false);
    expect(shoulderHits.length).toBeGreaterThan(0);
    expect(shoulderHits[0].face!.normal.y).toBeGreaterThan(0.1);
    expect(Math.abs(outerHits[0].face!.normal.y)).toBeLessThan(0.04);
    expect(body.material.side).toBe(THREE.FrontSide);
    expect(body.material.opacity).toBe(1); expect(body.material.transparent).toBe(false);
    expect(body.material.transmission).toBeGreaterThan(0.9);
    expect(body.material.thickness).toBeGreaterThan(0.003); expect(body.material.thickness).toBeLessThan(0.01);
  });

  it('shares the low-resolution transmission path and disposes removed cup geometry without losing shared glass materials', () => {
    const config = level();
    config.obstacles.push({ ...config.obstacles[0], id: 'second-cup', x: -0.25, z: 0.2 });
    scene.setLevel(config);
    const resources = scene as unknown as Resources & { renderer: THREE.WebGLRenderer; environment: THREE.WebGLRenderTarget; scene: THREE.Scene };
    const first = resources.obstacleMeshes.get('cup')!.group.children as THREE.Mesh[];
    const second = resources.obstacleMeshes.get('second-cup')!.group.children as THREE.Mesh[];
    expect(resources.renderer.transmissionResolutionScale).toBe(0.5);
    expect(first[0].material).toBe(second[0].material);
    expect(first[1].material).toBe(first[2].material); expect(first[1].material).toBe(second[1].material);
    // Without an explicit map, the renderer replaces envMapIntensity with the dark scene intensity.
    for (const mesh of first.slice(0, 3)) {
      const glass = mesh.material as THREE.MeshPhysicalMaterial;
      expect(glass.envMap).toBe(resources.environment.texture);
      expect(glass.envMap).toBe(resources.scene.environment);
      expect(glass.envMapIntensity).toBeGreaterThan(resources.scene.environmentIntensity);
      expect(glass.transmission).toBeGreaterThan(0.9);
    }
    expect((first[0].material as THREE.MeshPhysicalMaterial).envMapIntensity).toBeLessThan((first[1].material as THREE.MeshPhysicalMaterial).envMapIntensity);
    expect(first[3].material).toBe(second[3].material);
    const geometryDisposals = [...first, ...second].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
    const bodyDisposal = vi.spyOn(first[0].material as THREE.Material, 'dispose');
    const rimDisposal = vi.spyOn(first[1].material as THREE.Material, 'dispose');
    const whiskyDisposal = vi.spyOn(first[3].material as THREE.Material, 'dispose');
    const environmentDisposal = vi.spyOn(resources.environment, 'dispose');
    const rendererDisposal = vi.spyOn(resources.renderer, 'dispose');
    scene.setLevel({ ...config, obstacles: [] }, true);
    for (const disposal of geometryDisposals) expect(disposal).toHaveBeenCalledOnce();
    expect(bodyDisposal).not.toHaveBeenCalled(); expect(rimDisposal).not.toHaveBeenCalled(); expect(whiskyDisposal).not.toHaveBeenCalled();
    scene.dispose(); scene.dispose();
    expect(bodyDisposal).toHaveBeenCalledOnce(); expect(rimDisposal).toHaveBeenCalledOnce();
    expect(whiskyDisposal).toHaveBeenCalledOnce();
    expect(environmentDisposal).toHaveBeenCalledOnce(); expect(rendererDisposal).toHaveBeenCalledOnce();
  });

  it.each([[390, 440], [738, 497], [1280, 620]])('keeps the full circular board visible before selection at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    scene.render(frame(config), { ...ready, phase: 'selecting', activeCoinId: null, canSelectCoin: true }, null);
    for (const dx of [0, 200, -450]) {
      scene.orbitBy(dx, 100);
      for (let angle = 0; angle < 360; angle += 5) {
        const point = scene.projectToScreen({ x: 0.8 * Math.cos(angle * Math.PI / 180), y: 0.004, z: 0.8 * Math.sin(angle * Math.PI / 180) });
        expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(width);
        expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(height);
      }
    }
  });

  it.each([[390, 844], [360, 780], [1280, 720]])('reserves the game HUD and footer bands at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    const selecting = { ...ready, phase: 'selecting' as const, activeCoinId: null, canSelectCoin: true };
    for (let step = 0; step < 60; step++) scene.render(frame(config), selecting, null);
    for (const deltaY of [-250, 800]) {
      scene.orbitBy(240, deltaY);
      for (let angle = 0; angle < 360; angle += 10) {
        const point = scene.projectToScreen({ x: 0.8 * Math.cos(angle * Math.PI / 180), y: 0.004, z: 0.8 * Math.sin(angle * Math.PI / 180) });
        expect(point.y).toBeGreaterThan(height * 0.22);
        expect(point.y).toBeLessThan(height * 0.8);
      }
    }
  });

  it('keeps edge coins above the compact-phone footer at maximum pitch', () => {
    const width = 320, height = 568;
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    const selecting = { ...ready, phase: 'selecting' as const, activeCoinId: null, canSelectCoin: true };
    for (let step = 0; step < 60; step++) scene.render(frame(config), selecting, null);
    scene.orbitBy(0, 400);
    for (let angle = 0; angle < 360; angle += 10) {
      const point = scene.projectToScreen({ x: 0.8 * Math.cos(angle * Math.PI / 180), y: 0.004, z: 0.8 * Math.sin(angle * Math.PI / 180) });
      expect(point.y).toBeGreaterThan(150);
      expect(point.y).toBeLessThan(height - 190);
    }
  });

  it.each([[320, 568], [390, 844], [1280, 720], [844, 390]])('keeps real room geometry out of selection and hand sightlines at every tested yaw/pitch at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config: LevelConfig = { ...level(), activeCoinId: 'north', obstacles: [], coins: [
      { id: 'center', x: 0, z: 0, materialId: 'standard' }, { id: 'north', x: 0, z: -0.7, materialId: 'standard' },
      { id: 'east', x: 0.7, z: 0, materialId: 'standard' }, { id: 'south', x: 0, z: 0.7, materialId: 'standard' },
      { id: 'west', x: -0.7, z: 0, materialId: 'standard' },
    ] };
    scene.setLevel(config);
    const resources = scene as unknown as { tavern: THREE.Group; camera: THREE.PerspectiveCamera; orbitYaw: number; orbitPitch: number };
    for (const phase of ['selecting', 'ready'] as const) {
      const view = { ...ready, phase, activeCoinId: phase === 'ready' ? 'north' : null, canSelectCoin: phase === 'selecting' };
      for (let step = 0; step < 60; step++) scene.render(frame(config), view, null);
      for (const pitch of [0.42, 1.28]) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
        scene.orbitBy((resources.orbitYaw - yaw) / 0.006, (pitch - resources.orbitPitch) / 0.004);
        scene.render(frame(config), view, null);
        const direction = scene.getAimDirection();
        for (const coin of config.coins) {
          const target = new THREE.Vector3(coin.x, 0.004, coin.z);
          expect(visibleSceneryHits(resources.tavern, resources.camera.position, target), `${phase} coin ${coin.id} yaw=${yaw} pitch=${pitch}`).toEqual([]);
          if (phase === 'ready' && coin.id === 'north') {
            target.x -= direction.x * 0.2; target.z -= direction.z * 0.2; target.y = 0.02;
            expect(visibleSceneryHits(resources.tavern, resources.camera.position, target), `hand yaw=${yaw} pitch=${pitch}`).toEqual([]);
          }
        }
      }
    }
  });

  it.each([[1280, 720], [844, 390]])('frames the home table on the right and preserves projection picking at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    scene.render(frame(config), null, null);
    const center = scene.projectToScreen({ x: 0, y: 0, z: 0 });
    expect(center.x).toBeCloseTo(width * 0.68, 5);
    expect(center.y).toBeCloseTo(height * 0.55, 5);
    const world = scene.projectToTable(center.x, center.y)!;
    expect(world.x).toBeCloseTo(0, 8); expect(world.z).toBeCloseTo(0, 8);
  });

  it.each([[390, 844], [1440, 900], [320, 568]])('restores a stable home camera and keeps the lamp above the title after extreme gameplay orbits at %s×%s', (width, height) => {
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    const resources = scene as unknown as { camera: THREE.PerspectiveCamera; orbitYaw: number; orbitPitch: number; tavern: { pendant: THREE.Group } };
    scene.render(frame(config), null, null);
    const homePosition = resources.camera.position.clone();
    const homeQuaternion = resources.camera.quaternion.clone();
    for (const [dx, dy] of [[900, 800], [-1500, -900]]) {
      scene.render(frame(config), ready, null); scene.orbitBy(dx, dy);
      const yaw = resources.orbitYaw, pitch = resources.orbitPitch;
      scene.render(frame(config), null, null);
      expect(resources.camera.position.equals(homePosition)).toBe(true);
      expect(resources.camera.quaternion.equals(homeQuaternion)).toBe(true);
      expect(resources.orbitYaw).toBe(yaw); expect(resources.orbitPitch).toBe(pitch);
    }
    resources.tavern.pendant.updateWorldMatrix(true, true);
    // Shade, diffuser and lip only: the hanging cord intentionally leaves the screen.
    for (const mesh of resources.tavern.pendant.children.slice(0, 3) as THREE.Mesh[]) {
      const bounds = new THREE.Box3().setFromObject(mesh);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const screen = scene.projectToScreen({ x, y, z });
        expect(screen.y).toBeGreaterThan(0);
        expect(screen.y).toBeLessThan(height * (height < 700 ? 0.125 : 0.15));
      }
    }
  });

  it('keeps compact-landscape selection clear of the lower-left guidance and lower-right controls', () => {
    const width = 640, height = 360;
    Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } });
    const config = level(); scene.setLevel(config);
    vi.spyOn(scene.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height } as DOMRect);
    const selecting = { ...ready, phase: 'selecting' as const, activeCoinId: null, canSelectCoin: true };
    for (let step = 0; step < 60; step++) scene.render(frame(config), selecting, null);
    for (const pitchDelta of [-800, 800]) {
      scene.orbitBy(0, pitchDelta);
      for (let angle = 0; angle < 360; angle += 5) {
        const point = scene.projectToScreen({ x: 0.8 * Math.cos(angle * Math.PI / 180), y: 0.004, z: 0.8 * Math.sin(angle * Math.PI / 180) });
        expect(point.y).toBeLessThan(285);
        expect(point.x > 365 || point.y < 230).toBe(true);
      }
    }
    scene.render(frame(config), ready, null);
    for (let step = 0; step < 60; step++) scene.render(frame(config), ready, null);
    const active = scene.projectToScreen(frame(config).coins[0].position);
    expect(active.x).toBeGreaterThan(365); expect(active.y).toBeGreaterThan(80); expect(active.y).toBeLessThan(230);
  });

  it('follows the authoritative active coin with the hand, suppresses it on motion/overlays and locks the aiming camera', () => {
    const config = level(); scene.setLevel(config);
    const authoritative = frame(config);
    const before = structuredClone(authoritative);
    const resources = scene as unknown as { finger: THREE.Group; glowLight: THREE.PointLight; camera: THREE.PerspectiveCamera };
    for (let step = 0; step < 60; step++) scene.render(authoritative, ready, null);
    expect(resources.finger.visible).toBe(true);
    expect(resources.glowLight.position.x).toBe(0.3);
    expect(resources.glowLight.position.z).toBe(0.25);
    const cameraPosition = resources.camera.position.clone();
    const projection = resources.camera.projectionMatrix.clone();
    const aiming: AimPreview = { source: authoritative.coins[0].position, direction: scene.getAimDirection(), power: 0.6 };
    const moved = { ...authoritative, coins: authoritative.coins.map((coin) => ({ ...coin, position: { ...coin.position, x: coin.position.x + 0.05 } })) };
    scene.render(moved, ready, aiming);
    expect(resources.camera.position.equals(cameraPosition)).toBe(true);
    expect(resources.camera.projectionMatrix.equals(projection)).toBe(true);
    for (const phase of ['simulating', 'failed', 'paused', 'complete', 'error'] as const) {
      scene.render(authoritative, { ...ready, phase }, null);
      expect(resources.finger.visible).toBe(false);
    }
    scene.render(authoritative, null, null); expect(resources.finger.visible).toBe(false);
    scene.render(authoritative, ready, null); expect(resources.finger.visible).toBe(true);
    expect(authoritative).toEqual(before);
  });
});
