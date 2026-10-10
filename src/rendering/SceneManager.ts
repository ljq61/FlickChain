import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COIN_RADIUS, COIN_THICKNESS, PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import type { AimPreview, GameView, LevelConfig, Vec3, WorldFrame } from '../types/contracts';

const TABLE_THICKNESS = PHYSICS_CONFIG.tableThickness;
const SELECT_COLOR = 0x2b6457;
const GLOW_COLOR = 0xff9d42;

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#a8794d';
  context.fillRect(0, 0, 1024, 1024);
  let seed = 41;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let index = 0; index < 24; index++) {
    const x = random() * 1024;
    const width = 26 + random() * 90;
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) {
      context.lineTo(x + Math.sin(y * 0.004 + x * 0.01) * (10 + random() * 26), y);
    }
    context.strokeStyle = `rgba(56,32,15,${0.03 + random() * 0.05})`;
    context.lineWidth = width;
    context.stroke();
  }
  for (let index = 0; index < 2600; index++) {
    const x = random() * 1024;
    const width = 0.4 + random() * 2;
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 24) {
      context.lineTo(x + Math.sin(y * 0.007 + x * 0.015) * (2 + random() * 6), y);
    }
    context.strokeStyle = random() > 0.52 ? `rgba(52,29,12,${0.02 + random() * 0.09})` : `rgba(255,224,176,${random() * 0.09})`;
    context.lineWidth = width;
    context.stroke();
  }
  for (let index = 0; index < 2400; index++) {
    context.fillStyle = `rgba(48,27,11,${0.02 + random() * 0.05})`;
    context.fillRect(random() * 1024, random() * 1024, 1.4, 1.4);
  }
  for (let x = 0; x < 1024; x += 256) {
    context.fillStyle = 'rgba(48,26,12,0.10)';
    context.fillRect(x, 0, 1.5, 1024);
    context.fillStyle = 'rgba(255,228,182,0.13)';
    context.fillRect(x + 2, 0, 1, 1024);
  }
  const vignette = context.createRadialGradient(512, 512, 280, 512, 512, 800);
  vignette.addColorStop(0, 'rgba(34,19,8,0)');
  vignette.addColorStop(1, 'rgba(34,19,8,0.24)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, 1024, 1024);
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
  private readonly coinMeshes = new Map<string, THREE.Group>();
  private readonly coinShadows = new Map<string, THREE.Mesh>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly wood = woodTexture();
  private readonly contact = contactTexture();
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly woodMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb8905f, map: this.wood, roughness: 0.82, clearcoat: 0.3, clearcoatRoughness: 0.42 });
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x533421, roughness: 0.65 });
  private readonly brassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdab463, metalness: 0.78, roughness: 0.30, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85 });
  private readonly rimMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf2d58e, metalness: 0.78, roughness: 0.24, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.9 });
  private readonly stampMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb38635, metalness: 0.64, roughness: 0.39, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7 });
  private readonly glowMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdab463, metalness: 0.78, roughness: 0.30, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85, emissive: GLOW_COLOR, emissiveIntensity: 0.6 });
  private readonly idleGlowMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdab463, metalness: 0.78, roughness: 0.30, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.85, emissive: GLOW_COLOR, emissiveIntensity: 0.16 });
  private readonly coinGeometry = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 64);
  private readonly rimGeometry = new THREE.TorusGeometry(COIN_RADIUS * 0.9, COIN_RADIUS * 0.027, 6, 64);
  private readonly stampGeometry = new THREE.TorusGeometry(COIN_RADIUS * 0.57, COIN_RADIUS * 0.014, 5, 48);
  private readonly shadowGeometry = new THREE.PlaneGeometry(COIN_RADIUS * 3.7, COIN_RADIUS * 3.7);
  private readonly glowLight = new THREE.PointLight(GLOW_COLOR, 0, 0.45, 2);
  private readonly aimGroup = new THREE.Group();
  private readonly aimMaterial = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, depthTest: false });
  private readonly aimShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 8), this.aimMaterial);
  private readonly aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.025, 12), this.aimMaterial);
  private readonly fingerGroup = new THREE.Group();
  private readonly fingerBase = new THREE.Group();
  private readonly fingerKnuckle = new THREE.Group();
  private readonly skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc08460, roughness: 0.62, envMapIntensity: 0.35 });
  private readonly nailMaterial = new THREE.MeshStandardMaterial({ color: 0xdfb598, roughness: 0.45, envMapIntensity: 0.35 });
  private readonly observer: ResizeObserver;
  private readonly cameraFocus = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private table = { width: 1.1, depth: 1.4 };
  private focusId: string | null = null;
  private orbitYaw = 0;
  private orbitPitch = 0.92;
  private orbitDistance = 2.4;
  private cameraReady = false;
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-label', '三维木桌棋盘，空白处拖动旋转视角；点选硬币直接开始，按住硬币后方的手指蓄力，松手弹射');
    this.host.append(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.3;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfff4de, 0x76634e, 1.6));
    const light = new THREE.DirectionalLight(0xffedcd, 3.2);
    light.position.set(-1.3, 2.8, -1.7);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = light.shadow.camera.bottom = -1.35;
    light.shadow.camera.right = light.shadow.camera.top = 1.35;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 6;
    light.shadow.bias = -0.00015;
    light.shadow.normalBias = 0.002;
    light.shadow.radius = 4;
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xf2f6ff, 0.95);
    fill.position.set(1.5, 1.1, 1.6);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: 0x3b3021, opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.13;
    floor.receiveShadow = true;
    this.scene.add(floor, this.tableGroup, this.aimGroup, this.glowLight);
    this.aimGroup.add(this.aimShaft, this.aimHead);
    this.aimGroup.visible = false;
    this.aimGroup.renderOrder = 5;
    // A stylized index finger lies flat on the table behind the active coin, fingertip at its back
    // edge; charging cocks it back and up so the power reads from any camera angle.
    this.scene.add(this.fingerGroup);
    this.fingerGroup.visible = false;
    this.fingerGroup.add(this.fingerBase);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), this.skinMaterial);
    hand.scale.set(1.1, 0.55, 1.4);
    hand.position.set(0, 0.014, -0.012);
    hand.castShadow = true;
    const proximal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.058, 6, 12), this.skinMaterial);
    proximal.rotation.x = Math.PI / 2;
    proximal.position.set(0, 0.012, 0.0435);
    proximal.castShadow = true;
    this.fingerBase.add(hand, proximal, this.fingerKnuckle);
    this.fingerKnuckle.position.set(0, 0.012, 0.087);
    const distal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.028, 6, 12), this.skinMaterial);
    distal.rotation.x = Math.PI / 2;
    distal.position.set(0, 0, 0.0185);
    distal.castShadow = true;
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), this.nailMaterial);
    nail.scale.set(1, 0.4, 1.2);
    nail.position.set(0, 0.0125, 0.028);
    this.fingerKnuckle.add(distal, nail);
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

  focusCoin(id: string | null): void { this.focusId = id; }
  clearFocus(): void { this.focusId = null; }

  setLevel(level: LevelConfig): void {
    this.table = level.table;
    this.focusId = null;
    this.cameraFocus.set(0, 0, 0);
    this.desiredFocus.set(0, 0, 0);
    this.cameraReady = false;
    for (const child of [...this.tableGroup.children]) {
      this.tableGroup.remove(child);
      child.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(level.table.width, TABLE_THICKNESS, level.table.depth), [this.edgeMaterial, this.edgeMaterial, this.woodMaterial, this.edgeMaterial, this.edgeMaterial, this.edgeMaterial]);
    board.position.y = -TABLE_THICKNESS / 2;
    board.receiveShadow = true;
    board.castShadow = true;
    this.tableGroup.add(board);
    for (const obstacle of level.obstacles) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(obstacle.width, PHYSICS_CONFIG.obstacleHeight, obstacle.depth), this.woodMaterial);
      mesh.position.set(obstacle.x, PHYSICS_CONFIG.obstacleHeight / 2, obstacle.z);
      mesh.rotation.y = obstacle.rotation ?? 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.tableGroup.add(mesh);
    }
    this.resize();
  }

  private createCoin(): THREE.Group {
    const coin = new THREE.Group();
    const body = new THREE.Mesh(this.coinGeometry, this.brassMaterial);
    body.castShadow = body.receiveShadow = true;
    coin.userData.body = body;
    coin.add(body);
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(this.rimGeometry, this.rimMaterial);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = side * (COIN_THICKNESS / 2 + 0.00025);
      const stamp = new THREE.Mesh(this.stampGeometry, this.stampMaterial);
      stamp.rotation.x = Math.PI / 2;
      stamp.position.y = side * (COIN_THICKNESS / 2 + 0.00035);
      coin.add(rim, stamp);
    }
    // A tiny geometric "1" makes the coins readable without external art assets.
    const numeral = new THREE.Mesh(new THREE.BoxGeometry(COIN_RADIUS * 0.1, 0.00065, COIN_RADIUS * 0.57), this.rimMaterial);
    numeral.position.y = COIN_THICKNESS / 2 + 0.00045;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(COIN_RADIUS * 0.3, 0.00065, COIN_RADIUS * 0.07), this.rimMaterial);
    foot.position.set(0, COIN_THICKNESS / 2 + 0.00045, COIN_RADIUS * 0.27);
    coin.add(numeral, foot);
    return coin;
  }

  render(frame: WorldFrame, view: GameView | null, aim: AimPreview | null): void {
    if (this.disposed) return;
    const requestedFocusId = view?.phase === 'selecting' ? this.focusId : view?.activeCoinId;
    const requestedFocus = requestedFocusId ? frame.coins.find((coin) => coin.id === requestedFocusId) : undefined;
    this.desiredFocus.set(requestedFocus?.position.x ?? 0, 0, requestedFocus?.position.z ?? 0);
    this.cameraFocus.lerp(this.desiredFocus, this.cameraReady ? 0.14 : 1);
    this.updateCamera();
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
    const ready = view?.phase === 'ready';
    const selecting = view?.phase === 'selecting';
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
    this.glowMaterial.emissiveIntensity = 0.25 + 1.05 * pulse;
    let glowAt: THREE.Vector3 | null = null;
    let activeOnTable = false;
    let activeX = 0;
    let activeZ = 0;
    for (const transform of frame.coins) {
      let mesh = this.coinMeshes.get(transform.id);
      if (!mesh) {
        mesh = this.createCoin();
        const shadow = new THREE.Mesh(this.shadowGeometry, new THREE.MeshBasicMaterial({ map: this.contact, transparent: true, depthWrite: false, opacity: 1 }));
        shadow.rotation.x = -Math.PI / 2;
        this.scene.add(mesh, shadow);
        this.coinMeshes.set(transform.id, mesh);
        this.coinShadows.set(transform.id, shadow);
      }
      mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
      mesh.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
      const onTable = transform.position.y >= -0.004 && transform.position.y < 0.07 && Math.abs(transform.position.x) <= frame.table.width / 2 && Math.abs(transform.position.z) <= frame.table.depth / 2;
      const shadow = this.coinShadows.get(transform.id)!;
      shadow.position.set(transform.position.x, 0.0005, transform.position.z);
      shadow.visible = onTable;
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - transform.position.y * 10);
      // The active coin breathes with a warm glow; coins still waiting to be picked keep a faint shimmer.
      const highlighted = onTable && ready && view.activeCoinId === transform.id;
      (mesh.userData.body as THREE.Mesh).material = highlighted ? this.glowMaterial : onTable && selecting ? this.idleGlowMaterial : this.brassMaterial;
      if (highlighted) {
        glowAt = mesh.position;
        activeOnTable = onTable;
        activeX = transform.position.x;
        activeZ = transform.position.z;
      }
    }
    if (glowAt) {
      this.glowLight.position.set(glowAt.x, glowAt.y + 0.05, glowAt.z);
      this.glowLight.intensity = 0.004 + 0.014 * pulse;
    } else {
      this.glowLight.intensity = 0;
    }
    this.fingerGroup.visible = ready && activeOnTable;
    if (this.fingerGroup.visible) {
      const power = aim?.power ?? 0;
      const forward = this.getAimDirection();
      const moment = performance.now() * 0.001;
      const tremble = power * power * 0.12;
      this.fingerGroup.position.set(
        activeX - forward.x * 0.158 + Math.sin(moment * 61) * tremble * 0.003,
        0.002,
        activeZ - forward.z * 0.158 + Math.cos(moment * 53) * tremble * 0.003,
      );
      this.fingerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(forward.x, 0, forward.z));
      // Idle: lying flat, fingertip at the coin's back edge. Charging: cocking back and up.
      this.fingerBase.rotation.x = -power * 0.45 + Math.sin(moment * 47) * tremble * 0.6;
      this.fingerKnuckle.rotation.x = -(0.04 + power * 0.9) + Math.sin(moment * 43) * tremble;
      this.fingerKnuckle.rotation.z = Math.sin(moment * 57 + 1.3) * tremble * 0.7;
    }
    this.aimGroup.visible = ready && !!aim;
    if (aim && ready) {
      const direction = new THREE.Vector3(aim.direction.x, 0, aim.direction.z).normalize();
      const source = new THREE.Vector3(aim.source.x, Math.max(0.012, aim.source.y + 0.009), aim.source.z);
      const length = 0.11 + aim.power * 0.19;
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.aimShaft.quaternion.copy(rotation);
      this.aimShaft.scale.y = length - 0.018;
      this.aimShaft.position.copy(source).addScaledVector(direction, (length - 0.018) / 2 + COIN_RADIUS * 1.3);
      this.aimHead.quaternion.copy(rotation);
      this.aimHead.position.copy(source).addScaledVector(direction, length + COIN_RADIUS * 1.3);
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
    this.orbitDistance = Math.max(1.9, this.table.depth * 1.32, this.table.width / Math.max(0.55, aspect) * 0.95);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(): void {
    if (this.disposed) return;
    const horizontal = Math.cos(this.orbitPitch) * this.orbitDistance;
    this.camera.position.set(
      this.cameraFocus.x + Math.sin(this.orbitYaw) * horizontal,
      this.cameraFocus.y + Math.sin(this.orbitPitch) * this.orbitDistance,
      this.cameraFocus.z + Math.cos(this.orbitYaw) * horizontal,
    );
    this.camera.lookAt(this.cameraFocus);
    this.camera.updateMatrixWorld();
    this.cameraReady = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    [this.coinGeometry, this.rimGeometry, this.stampGeometry, this.shadowGeometry].forEach((geometry) => geometries.add(geometry));
    [this.glowMaterial, this.idleGlowMaterial].forEach((material) => materials.add(material));
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.wood.dispose();
    this.contact.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
