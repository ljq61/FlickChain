import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { coinRadius, COIN_RADIUS, COIN_THICKNESS, PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { tableContainsPoint } from '../physics/TableGeometry';
import type { AimPreview, CoinMaterialId, GameView, LevelConfig, ObstacleConfig, Vec3, WorldFrame } from '../types/contracts';
import { FlickFinger } from './FlickFinger';
import { CoinArrival } from './CoinArrival';
import { ObstacleTransition } from './ObstacleTransition';
import { TavernEnvironment } from './TavernEnvironment';

const TABLE_THICKNESS = PHYSICS_CONFIG.tableThickness;
const GLOW_COLOR = 0xff9d42;

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#78401e';
  context.fillRect(0, 0, 1024, 1024);
  let seed = 41;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const planks = ['#78401e', '#814724', '#75401f', '#7d4422', '#713c1e', '#804522', '#76401f'];
  const plankWidth = canvas.width / planks.length;
  for (let index = 0; index < planks.length; index++) {
    context.fillStyle = planks[index];
    context.fillRect(index * plankWidth, 0, plankWidth, 1024);
    context.fillStyle = 'rgba(38,20,11,.27)';
    context.fillRect(index * plankWidth, 0, 2.5, 1024);
    context.fillStyle = 'rgba(243,179,78,.12)';
    context.fillRect(index * plankWidth + 3, 0, 1.5, 1024);
  }
  // Sparse, drawn grain keeps the small play surface readable at phone scale.
  for (let index = 0; index < 42; index++) {
    const x = random() * 1024;
    const start = random() * 400 - 80;
    const length = 220 + random() * 680;
    context.beginPath();
    context.moveTo(x, start);
    for (let y = start; y <= start + length; y += 32) {
      context.lineTo(x + Math.sin(y * 0.006 + x * 0.02) * 3.5, y);
    }
    context.strokeStyle = `rgba(39,20,11,${0.07 + random() * 0.07})`;
    context.lineWidth = 1 + random() * 1.6;
    context.stroke();
  }
  const vignette = context.createRadialGradient(512, 512, 280, 512, 512, 800);
  vignette.addColorStop(0, 'rgba(34,19,8,0)');
  vignette.addColorStop(1, 'rgba(34,19,8,0.14)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, 1024, 1024);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function marbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#171612';
  context.fillRect(0, 0, 1024, 1024);
  let seed = 193;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // Uneven mineral bands fracture into shorter wisps instead of repeating smooth full-length waves.
  // Flecks stay near these sparse strata; the broad black field keeps coins readable on phones.
  for (let vein = 0; vein < 9; vein++) {
    const offset = -620 + random() * 1350;
    const slope = 0.3 + random() * 0.45;
    const phase = random() * Math.PI * 2;
    const frequency = 0.003 + random() * 0.005;
    const bend = 25 + random() * 65;
    const points: { x: number; y: number }[] = [];
    let fracture = 0;
    for (let y = -160; y <= 1180; y += 7) {
      fracture = fracture * 0.86 + (random() - 0.5) * 5;
      points.push({ x: offset + y * slope + Math.sin(y * frequency + phase) * bend + fracture, y });
    }
    for (let strand = 0; strand < 24; strand++) {
      const start = Math.floor(random() * (points.length - 14));
      const end = Math.min(points.length, start + 8 + Math.floor(random() * 58));
      const spread = (random() - 0.5) * 45;
      let drift = 0;
      context.beginPath();
      for (let index = start; index < end; index++) {
        drift = drift * 0.7 + (random() - 0.5) * 3;
        const point = points[index];
        const x = point.x + spread + drift;
        if (index === start || random() < 0.04) context.moveTo(x, point.y);
        else context.lineTo(x, point.y);
      }
      context.strokeStyle = strand % 4 ? `rgba(187,158,104,${0.14 + random() * 0.18})`
        : `rgba(225,216,189,${0.18 + random() * 0.25})`;
      context.lineWidth = strand % 6 ? 0.5 + random() * 1.5 : 2 + random() * 4;
      context.stroke();
    }
    for (let branch = 0; branch < 7; branch++) {
      const start = Math.floor(random() * (points.length - 24));
      const side = random() < 0.5 ? -1 : 1;
      context.beginPath();
      context.moveTo(points[start].x, points[start].y);
      for (let step = 1; step < 12 + random() * 10; step++) {
        const point = points[start + step];
        context.lineTo(point.x + side * step * 2.3 + (random() - 0.5) * 3, point.y);
      }
      context.strokeStyle = 'rgba(204,188,148,.23)';
      context.lineWidth = 0.65;
      context.stroke();
    }
    for (let fleck = 0; fleck < 240; fleck++) {
      const point = points[Math.floor(random() * points.length)];
      context.fillStyle = fleck % 4 ? 'rgba(176,146,92,.27)' : 'rgba(232,219,186,.39)';
      context.fillRect(point.x + (random() - 0.5) * 50, point.y + random() * 7, 0.5 + random() * 1.7, 0.7 + random() * 2.6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function contactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 16, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(35,23,13,.42)');
  gradient.addColorStop(0.48, 'rgba(35,23,13,.18)');
  gradient.addColorStop(1, 'rgba(35,23,13,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Reads authoritative poses; owns only the camera and presentation resources. */
export class SceneManager {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.02, 30);
  private readonly tableGroup = new THREE.Group();
  private readonly tavern = new TavernEnvironment();
  private board: THREE.Mesh | null = null;
  private readonly obstacleMeshes = new Map<string, { group: THREE.Group; config: ObstacleConfig }>();
  private pendingObstacleIds: string[] = [];
  private readonly obstacleTransition = new ObstacleTransition();
  private readonly coinMeshes = new Map<string, THREE.Group>();
  private readonly coinShadows = new Map<string, THREE.Mesh>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly wood = woodTexture();
  private readonly marble = marbleTexture();
  private readonly contact = contactTexture();
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly woodMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: this.wood, roughness: 0.68, clearcoat: 0.24, clearcoatRoughness: 0.48 });
  private readonly marbleMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: this.marble, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.065, envMapIntensity: 0.65 });
  private readonly marbleEdgeMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: this.marble, roughness: 0.19, clearcoat: 0.75, clearcoatRoughness: 0.1, envMapIntensity: 0.4 });
  private readonly glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xfffcf5, roughness: 0.025, metalness: 0, transmission: 1, thickness: 0.009, ior: 1.47, side: THREE.FrontSide, clearcoat: 0, envMapIntensity: 0.6 });
  private readonly glassRimMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.035, metalness: 0, transmission: 0.95, thickness: 0.014, ior: 1.47, clearcoat: 0.35, clearcoatRoughness: 0.025, envMapIntensity: 1.5 });
  private readonly whiskyMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.055, envMapIntensity: 0.45 });
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x352017, roughness: 0.72 });
  private readonly brassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd69b42, metalness: 0.72, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85 });
  private readonly rimMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffe1a0, metalness: 0.72, roughness: 0.26, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.9 });
  private readonly stampMaterial = new THREE.MeshPhysicalMaterial({ color: 0x79441f, metalness: 0.56, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7 });
  private readonly ironMaterial = new THREE.MeshPhysicalMaterial({ color: 0x6e929b, metalness: 0.83, roughness: 0.38, clearcoat: 0.35, envMapIntensity: 0.85 });
  private readonly ironRimMaterial = new THREE.MeshPhysicalMaterial({ color: 0xadd2d0, metalness: 0.82, roughness: 0.3, envMapIntensity: 0.85 });
  private readonly ironStampMaterial = new THREE.MeshPhysicalMaterial({ color: 0x466d75, metalness: 0.72, roughness: 0.44, envMapIntensity: 0.7 });
  private readonly ironGlowMaterial = new THREE.MeshPhysicalMaterial({ color: 0x6e929b, metalness: 0.83, roughness: 0.38, clearcoat: 0.35, envMapIntensity: 0.85, emissive: GLOW_COLOR, emissiveIntensity: 0.6 });
  private readonly ironIdleGlowMaterial = new THREE.MeshPhysicalMaterial({ color: 0x6e929b, metalness: 0.83, roughness: 0.38, clearcoat: 0.35, envMapIntensity: 0.85, emissive: 0x77a9b0, emissiveIntensity: 0.16 });
  private readonly glowMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd69b42, metalness: 0.72, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85, emissive: GLOW_COLOR, emissiveIntensity: 0.6 });
  private readonly idleGlowMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd69b42, metalness: 0.72, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85, emissive: GLOW_COLOR, emissiveIntensity: 0.16 });
  private readonly coinGeometry = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 64);
  private readonly rimGeometry = new THREE.TorusGeometry(COIN_RADIUS * 0.9, COIN_RADIUS * 0.027, 6, 64);
  private readonly stampGeometry = new THREE.TorusGeometry(COIN_RADIUS * 0.57, COIN_RADIUS * 0.014, 5, 48);
  private readonly shadowGeometry = new THREE.PlaneGeometry(COIN_RADIUS * 3.7, COIN_RADIUS * 3.7);
  private readonly activeHalo = new THREE.Mesh(new THREE.TorusGeometry(COIN_RADIUS * 1.28, 0.0009, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffe1a0, transparent: true, opacity: 0.9, depthWrite: false }));
  private readonly glowLight = new THREE.PointLight(GLOW_COLOR, 0, 0.45, 2);
  private readonly finger = new FlickFinger();
  private readonly arrival = new CoinArrival();
  private readonly observer: ResizeObserver;
  private readonly cameraFocus = new THREE.Vector3();
  private readonly homeFocus = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private table: LevelConfig['table'] = { width: 1.6, depth: 1.6, shape: 'circle', materialId: 'wood' };
  private focusId: string | null = null;
  private orbitYaw = 0;
  private orbitPitch = 0.75;
  private overviewDistance = 2.4;
  private orbitDistance = 2.4;
  private cameraReady = false;
  private menuView = true;
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // All cups reuse Three.js's per-camera transmission buffer, at one quarter of its pixels.
    this.renderer.transmissionResolutionScale = 0.5;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-label', '三维桌面棋盘，空白处拖动旋转视角；点选硬币直接开始，按住硬币后方的手指蓄力，松手弹射');
    this.host.append(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.22;
    // An explicit shared map keeps glass reflections independent of the dark room's IBL intensity.
    this.glassMaterial.envMap = this.glassRimMaterial.envMap = this.environment.texture;
    this.marbleMaterial.envMap = this.marbleEdgeMaterial.envMap = this.whiskyMaterial.envMap = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x101719);
    this.scene.fog = new THREE.Fog(0x101719, 4.2, 11);
    this.scene.add(new THREE.HemisphereLight(0xa6bbc0, 0x321609, 0.62));
    const fill = new THREE.DirectionalLight(0xadd1d6, 0.55);
    fill.position.set(1.5, 2.5, 1.6);
    this.scene.add(fill);
    this.activeHalo.rotation.x = -Math.PI / 2;
    this.activeHalo.visible = false;
    this.activeHalo.raycast = () => {};
    this.scene.add(this.tavern, this.tableGroup, this.glowLight, this.activeHalo);
    this.scene.add(this.finger);
    this.setLevel({ schemaVersion: 1, id: 'preview', name: '', lesson: '', table: { ...this.table, materialId: 'wood' }, coins: [], activeCoinId: '', obstacles: [] });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  /** Rotate the tabletop view; shot direction comes from the camera forward vector. */
  orbitBy(deltaX: number, deltaY: number): void {
    if (this.disposed || !Number.isFinite(deltaX + deltaY)) return;
    this.orbitYaw -= deltaX * 0.006;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + deltaY * 0.004, 0.42, 1.28);
    this.updateCamera();
  }

  getAimDirection(): { x: number; z: number } {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) return { x: 0, z: -1 };
    forward.normalize();
    return { x: forward.x, z: forward.z };
  }

  /** Finish rig loading before enabling gameplay input. Reuses the loaded asset. */
  initializeHand(): Promise<void> { return this.finger.load(); }

  /** Finger and shot share one axis: the finger always starts directly behind the coin. */
  getFingerDirection(): { x: number; z: number } {
    return this.getAimDirection();
  }

  /** Actual articulated finger points, shared with input instead of guessed screen offsets. */
  getFingerHitPoints(): Vec3[] { return this.finger.getHitPoints(); }

  focusCoin(id: string | null): void { this.focusId = id; }
  clearFocus(): void { this.focusId = null; }

  beginCoinArrival(ids: string[]): void {
    this.arrival.begin(ids, this.reducedMotion.matches);
    this.obstacleTransition.beginArrival(this.pendingObstacleIds, this.reducedMotion.matches);
    this.pendingObstacleIds = [];
  }
  get isIntroducing(): boolean { return this.arrival.playing || this.obstacleTransition.arriving; }
  advanceCoinArrival(seconds: number): string[] {
    this.obstacleTransition.advanceArrival(seconds);
    return this.arrival.advance(seconds);
  }

  beginObstacleRemoval(): void {
    this.obstacleTransition.beginRemoval([...this.obstacleMeshes.keys()], this.reducedMotion.matches);
  }
  get isRemovingObstacles(): boolean { return this.obstacleTransition.removing; }
  advanceObstacleRemoval(seconds: number): void { this.obstacleTransition.advanceRemoval(seconds); }

  setLevel(level: LevelConfig, preserveFocus = false): void {
    this.arrival.begin([]);
    this.obstacleTransition.reset();
    this.pendingObstacleIds = [];
    if (!preserveFocus) {
      this.focusId = null;
      this.cameraFocus.set(0, 0, 0);
      this.desiredFocus.set(0, 0, 0);
      this.cameraReady = false;
    }
    const oldTable = this.table;
    this.table = level.table;
    const surface = level.table.materialId === 'marble' ? this.marbleMaterial : this.woodMaterial;
    const edge = level.table.materialId === 'marble' ? this.marbleEdgeMaterial : this.edgeMaterial;
    if (!this.board || oldTable.width !== level.table.width || oldTable.depth !== level.table.depth || oldTable.shape !== level.table.shape) {
      if (this.board) { this.tableGroup.remove(this.board); this.board.geometry.dispose(); }
      this.board = level.table.shape === 'circle'
        ? new THREE.Mesh(new THREE.CylinderGeometry(level.table.width / 2, level.table.width / 2, TABLE_THICKNESS, 128))
        : new THREE.Mesh(new THREE.BoxGeometry(level.table.width, TABLE_THICKNESS, level.table.depth));
      this.board.position.y = -TABLE_THICKNESS / 2;
      this.board.receiveShadow = this.board.castShadow = true;
      this.tableGroup.add(this.board);
    }
    this.board.material = level.table.shape === 'circle' ? [edge, surface, edge] : [edge, edge, surface, edge, edge, edge];
    this.tavern.setTable(level.table, TABLE_THICKNESS);
    for (const [id, entry] of this.obstacleMeshes) {
      const next = level.obstacles.find((candidate) => candidate.id === id);
      const previous = entry.config;
      if (preserveFocus && next && next.kind === previous.kind && next.x === previous.x && next.z === previous.z && next.width === previous.width && next.depth === previous.depth && next.rotation === previous.rotation) continue;
      this.tableGroup.remove(entry.group);
      entry.group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      this.obstacleMeshes.delete(id);
    }
    for (const obstacle of level.obstacles) {
      if (this.obstacleMeshes.has(obstacle.id)) continue;
      const group = new THREE.Group();
      group.position.set(obstacle.x, 0, obstacle.z);
      group.rotation.y = obstacle.rotation ?? 0;
      if (obstacle.kind === 'glass') {
        const radius = obstacle.width / 2;
        const height = PHYSICS_CONFIG.glassHeight;
        const footGap = 0.0012;
        const lipThickness = Math.min(height * 0.04, radius * 0.065);
        const lipBase = height - lipThickness * 2;
        // A closed hollow section supplies outward and inward normals without a DoubleSide pass.
        // The raised underside avoids sharing the tabletop's y=0 plane, while bounds stay physical.
        const profile = [
          new THREE.Vector2(0, footGap), new THREE.Vector2(radius * 0.82, footGap),
          new THREE.Vector2(radius * 0.91, height * 0.033), new THREE.Vector2(radius * 0.965, height * 0.1),
          new THREE.Vector2(radius * 0.987, height * 0.25), new THREE.Vector2(radius, height * 0.65),
          new THREE.Vector2(radius * 0.997, height * 0.83),
          new THREE.Vector2(radius - lipThickness, lipBase), new THREE.Vector2(radius - lipThickness * 2, lipBase),
          new THREE.Vector2(radius * 0.9, height * 0.83), new THREE.Vector2(radius * 0.9, height * 0.65),
          new THREE.Vector2(radius * 0.9, height * 0.25), new THREE.Vector2(radius * 0.85, height * 0.2),
          new THREE.Vector2(0, height * 0.2),
        ];
        const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), this.glassMaterial);
        // Rounded thick edges catch the shared environment; curved walls lightly refract coins behind them.
        const lip = new THREE.Mesh(new THREE.TorusGeometry(radius - lipThickness, lipThickness, 8, 48), this.glassRimMaterial);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = height - lipThickness;
        const baseThickness = Math.min(height * 0.023, radius * 0.04);
        const base = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.93, baseThickness, 8, 48), this.glassRimMaterial);
        base.rotation.x = Math.PI / 2;
        base.position.y = footGap + baseThickness + 0.00025;
        // A shallow meniscus and thick clear heel identify a half-filled rocks glass at phone scale.
        // Opaque amber stays in the shared refraction capture, avoiding recursive liquid/glass passes.
        const fill = height * 0.6;
        const whiskyGeometry = new THREE.LatheGeometry([
          new THREE.Vector2(0, height * 0.205), new THREE.Vector2(radius * 0.82, height * 0.205),
          new THREE.Vector2(radius * 0.875, height * 0.255), new THREE.Vector2(radius * 0.888, fill - height * 0.006),
          new THREE.Vector2(radius * 0.897, fill), new THREE.Vector2(radius * 0.866, fill - height * 0.006),
          new THREE.Vector2(0, fill - height * 0.006),
        ], 48);
        const positions = whiskyGeometry.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const sideColor = new THREE.Color(0x764518), surfaceColor = new THREE.Color(0x9c692d);
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const color = positions.getY(vertex) >= fill - height * 0.01 ? surfaceColor : sideColor;
          colors.set([color.r, color.g, color.b], vertex * 3);
        }
        whiskyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const whisky = new THREE.Mesh(whiskyGeometry, this.whiskyMaterial);
        whisky.receiveShadow = true;
        group.add(cup, lip, base, whisky);
        this.pendingObstacleIds.push(obstacle.id);
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(obstacle.width, PHYSICS_CONFIG.obstacleHeight, obstacle.depth), this.woodMaterial);
        box.position.y = PHYSICS_CONFIG.obstacleHeight / 2;
        box.castShadow = box.receiveShadow = true;
        group.add(box);
      }
      this.obstacleMeshes.set(obstacle.id, { group, config: { ...obstacle } });
      this.tableGroup.add(group);
    }
    this.resize();
  }

  private createCoin(materialId: CoinMaterialId): THREE.Group {
    const coin = new THREE.Group();
    const iron = materialId === 'iron';
    const rimMaterial = iron ? this.ironRimMaterial : this.rimMaterial;
    const body = new THREE.Mesh(this.coinGeometry, iron ? this.ironMaterial : this.brassMaterial);
    coin.userData.materialId = materialId;
    coin.scale.set(coinRadius(materialId) / COIN_RADIUS, 1, coinRadius(materialId) / COIN_RADIUS);
    body.castShadow = body.receiveShadow = true;
    coin.userData.body = body;
    coin.add(body);
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(this.rimGeometry, rimMaterial);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = side * (COIN_THICKNESS / 2 + 0.00025);
      const stamp = new THREE.Mesh(this.stampGeometry, iron ? this.ironStampMaterial : this.stampMaterial);
      stamp.rotation.x = Math.PI / 2;
      stamp.position.y = side * (COIN_THICKNESS / 2 + 0.00035);
      coin.add(rim, stamp);
    }
    // A tiny geometric "1" makes the coins readable without external art assets.
    const numeral = new THREE.Mesh(new THREE.BoxGeometry(COIN_RADIUS * 0.1, 0.00065, COIN_RADIUS * 0.57), rimMaterial);
    numeral.position.y = COIN_THICKNESS / 2 + 0.00045;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(COIN_RADIUS * 0.3, 0.00065, COIN_RADIUS * 0.07), rimMaterial);
    foot.position.set(0, COIN_THICKNESS / 2 + 0.00045, COIN_RADIUS * 0.27);
    coin.add(numeral, foot);
    return coin;
  }

  render(frame: WorldFrame, view: GameView | null, aim: AimPreview | null): void {
    if (this.disposed) return;
    if (this.menuView !== (view === null)) {
      this.menuView = view === null;
      this.resize();
    }
    const transitioning = this.isIntroducing || this.isRemovingObstacles;
    const requestedFocusId = transitioning ? null : view?.phase === 'selecting' ? this.focusId : view?.activeCoinId;
    const requestedFocus = requestedFocusId ? frame.coins.find((coin) => coin.id === requestedFocusId) : undefined;
    this.tavern.setMenuView(view === null);
    this.desiredFocus.set(requestedFocus?.position.x ?? 0, 0, requestedFocus?.position.z ?? 0);
    if (!aim) this.cameraFocus.lerp(this.desiredFocus, this.cameraReady ? 0.14 : 1);
    // Selection retains enough context to choose a launch coin; aiming becomes a close tabletop view.
    const distance = requestedFocus && view ? Math.max(0.9, this.overviewDistance * 0.42)
      : this.overviewDistance;
    if (!aim) this.orbitDistance = THREE.MathUtils.lerp(this.orbitDistance, distance, this.cameraReady ? 0.12 : 1);
    this.updateCamera();
    for (const [id, { group, config }] of this.obstacleMeshes) {
      const pose = this.obstacleTransition.pose(id);
      group.position.set(config.x + pose.x, pose.height, config.z);
      group.rotation.set(0, config.rotation ?? 0, pose.tilt);
      group.visible = pose.visible;
    }
    const visibleIds = new Set(frame.coins.map((coin) => coin.id));
    for (const [id, mesh] of this.coinMeshes) {
      if (visibleIds.has(id)) continue;
      this.scene.remove(mesh, this.coinShadows.get(id)!);
      mesh.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.geometry !== this.coinGeometry && child.geometry !== this.rimGeometry && child.geometry !== this.stampGeometry) child.geometry.dispose();
      });
      const shadow = this.coinShadows.get(id)!;
      (shadow.material as THREE.Material).dispose();
      this.coinMeshes.delete(id);
      this.coinShadows.delete(id);
    }
    const ready = view?.phase === 'ready' && !transitioning;
    const selecting = view?.phase === 'selecting' && !transitioning;
    const pulse = this.reducedMotion.matches ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
    this.glowMaterial.emissiveIntensity = this.ironGlowMaterial.emissiveIntensity = 0.12 + 0.25 * pulse;
    let glowAt: THREE.Vector3 | null = null;
    let activeOnTable = false;
    let activeX = 0;
    let activeZ = 0;
    for (const transform of frame.coins) {
      let mesh = this.coinMeshes.get(transform.id);
      if (!mesh) {
        mesh = this.createCoin(transform.materialId);
        const shadow = new THREE.Mesh(this.shadowGeometry, new THREE.MeshBasicMaterial({ map: this.contact, transparent: true, depthWrite: false, opacity: 1 }));
        shadow.rotation.x = -Math.PI / 2;
        shadow.scale.setScalar(coinRadius(transform.materialId) / COIN_RADIUS);
        this.scene.add(mesh, shadow);
        this.coinMeshes.set(transform.id, mesh);
        this.coinShadows.set(transform.id, shadow);
      }
      mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
      mesh.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
      const arrival = this.arrival.pose(transform.id);
      mesh.position.y += arrival.height;
      mesh.rotateX(arrival.tilt);
      mesh.rotateY(arrival.yaw);
      const onTable = transform.position.y >= -0.004 && transform.position.y < 0.07 && tableContainsPoint(frame.table, transform.position.x, transform.position.z);
      const shadow = this.coinShadows.get(transform.id)!;
      shadow.position.set(transform.position.x, 0.0005, transform.position.z);
      shadow.visible = onTable;
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - mesh.position.y * 5);
      // The active coin breathes with a warm glow; coins still waiting to be picked keep a faint shimmer.
      const highlighted = onTable && ready && view.activeCoinId === transform.id;
      const iron = transform.materialId === 'iron';
      (mesh.userData.body as THREE.Mesh).material = highlighted ? iron ? this.ironGlowMaterial : this.glowMaterial
        : onTable && selecting ? iron ? this.ironIdleGlowMaterial : this.idleGlowMaterial : iron ? this.ironMaterial : this.brassMaterial;
      if (highlighted) {
        glowAt = mesh.position;
        activeOnTable = onTable;
        activeX = transform.position.x;
        activeZ = transform.position.z;
        this.activeHalo.scale.setScalar(coinRadius(transform.materialId) / COIN_RADIUS);
      }
    }
    this.activeHalo.visible = activeOnTable;
    this.activeHalo.position.set(activeX, 0.0012, activeZ);
    (this.activeHalo.material as THREE.MeshBasicMaterial).opacity = 0.65 + pulse * 0.25;
    if (glowAt) {
      this.glowLight.position.set(glowAt.x, glowAt.y + 0.05, glowAt.z);
      this.glowLight.intensity = 0.004 + 0.014 * pulse;
    } else {
      this.glowLight.intensity = 0;
    }
    this.finger.visible = ready && activeOnTable;
    if (this.finger.visible) {
      this.finger.setPose({ x: activeX, z: activeZ }, this.getFingerDirection(), aim?.power ?? 0,
        this.reducedMotion.matches ? 0 : performance.now() / 1000);
    }
    this.renderer.render(this.scene, this.camera);
  }

  projectToTable(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(clientX + clientY)) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), this.camera);
    const point = this.raycaster.ray.intersectPlane(this.tablePlane, new THREE.Vector3());
    return point ? { x: point.x, z: point.z } : null;
  }

  projectToScreen(position: Vec3): { x: number; y: number } {
    const point = new THREE.Vector3(position.x, position.y, position.z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = 42;
    // Fit the whole board during selection/arrival, including portrait viewports
    // and any orbit angle. The bounding sphere is conservative for a flat circle.
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const desktopHome = this.menuView && (width >= 900 || height < 600) && aspect > 1.25;
    const horizontalSpace = desktopHome ? 0.48 : 0.94;
    const compactPortrait = aspect < 1 && height < 700;
    const compactLandscape = !this.menuView && aspect > 1.25 && height < 600;
    const verticalSpace = desktopHome ? 0.84 : compactPortrait ? THREE.MathUtils.clamp((height - 340) / height, 0.3, 0.56) : compactLandscape ? 0.58 : aspect < 1 ? 0.56 : 0.62;
    const limitingHalfFov = Math.min(Math.atan(Math.tan(halfFov) * verticalSpace), Math.atan(Math.tan(halfFov) * aspect * horizontalSpace));
    const radius = this.table.shape === 'circle' ? this.table.width / 2 : Math.hypot(this.table.width, this.table.depth) / 2;
    this.overviewDistance = radius * 1.08 / Math.sin(limitingHalfFov);
    if (!this.cameraReady) this.orbitDistance = this.overviewDistance;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const desktopHome = this.menuView && (width >= 900 || height < 600) && width / height > 1.25;
    const compactLandscape = !this.menuView && width / height > 1.25 && height < 600;
    const centerX = desktopHome ? 0.68 : compactLandscape ? 0.65 : 0.5;
    const compactPortrait = width < height && height < 700;
    const centerY = compactPortrait ? 0.47 : this.menuView ? 0.55 : compactLandscape ? 0.42 : 0.51;
    // An off-center projection reserves UI space without changing world aim axes.
    this.camera.setViewOffset(width, height, (0.5 - centerX) * width, (0.5 - centerY) * height, width, height);
    // Home is a stable display pose; gameplay orbit values remain untouched.
    const pitch = this.menuView ? 0.75 : this.orbitPitch;
    const yaw = this.menuView ? 0 : this.orbitYaw;
    const distance = this.menuView ? this.overviewDistance : this.orbitDistance;
    const focus = this.menuView ? this.homeFocus : this.cameraFocus;
    const horizontal = Math.cos(pitch) * distance;
    this.camera.position.set(
      focus.x + Math.sin(yaw) * horizontal,
      focus.y + Math.sin(pitch) * distance,
      focus.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(focus);
    this.camera.updateMatrixWorld();
    this.tavern.updateCamera(this.camera);
    if (this.menuView) this.tavern.presentMenuLamp(this.camera, width, height, centerX);
    this.cameraReady = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.scene.remove(this.finger);
    this.finger.dispose();
    this.tavern.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    [this.coinGeometry, this.rimGeometry, this.stampGeometry, this.shadowGeometry].forEach((geometry) => geometries.add(geometry));
    [this.woodMaterial, this.marbleMaterial, this.marbleEdgeMaterial, this.edgeMaterial, this.glassMaterial, this.glassRimMaterial, this.whiskyMaterial, this.brassMaterial, this.rimMaterial, this.stampMaterial, this.glowMaterial, this.idleGlowMaterial, this.ironMaterial, this.ironRimMaterial, this.ironStampMaterial, this.ironGlowMaterial, this.ironIdleGlowMaterial].forEach((material) => materials.add(material));
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.wood.dispose();
    this.marble.dispose();
    this.contact.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
