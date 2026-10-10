import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { COIN_RADIUS } from '../physics/MaterialRegistry';
import type { Vec3 } from '../types/contracts';

const BONE_NAMES = ['hand_root', 'index_mcp', 'index_pip', 'index_dip'];
const SURFACE_SPACING = 0.012;
const HAND_SCALE = 0.8;
const MODEL_URL = `${import.meta.env.BASE_URL}models/flick-hand.glb`;

interface SurfacePoint {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  wa: number;
  wb: number;
  wc: number;
}

interface SurfaceSamples {
  mesh: THREE.Mesh;
  vertices: Map<number, THREE.Vector3>;
  points: SurfacePoint[];
}

interface HandPose {
  coin: { x: number; z: number };
  direction: { x: number; z: number };
  power: number;
  timeSeconds: number;
}

/** Blender-authored skinned hand. Charge samples its animation; no game simulation. */
export class FlickFinger extends THREE.Group {
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private markers: THREE.Object3D[] = [];
  private surfaces: SurfaceSamples[] = [];
  private pending: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private lastPose: HandPose | null = null;
  private reach = 0.114 + COIN_RADIUS + 0.002;
  private disposed = false;

  constructor() {
    super();
    this.visible = false;
  }

  /** Direct GLB bytes allow offline validation; the normal path uses Vite's base URL. */
  load(data?: ArrayBuffer): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Hand has been disposed'));
    if (this.model) return Promise.resolve();
    if (this.pending) return this.pending;
    const controller = data ? null : new AbortController();
    this.abortController = controller;
    const pending = this.loadAsset(data, controller).finally(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.abortController = null;
      }
    });
    this.pending = pending;
    return pending;
  }

  private async loadAsset(data: ArrayBuffer | undefined, controller: AbortController | null): Promise<void> {
    let candidate: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    try {
      if (!data) {
        const response = await fetch(MODEL_URL, { signal: controller!.signal });
        if (!response.ok) throw new Error(`Hand model request failed (${response.status})`);
        data = await response.arrayBuffer();
      }
      if (this.disposed) throw new Error('Hand has been disposed');
      const gltf = await new GLTFLoader().parseAsync(data, '');
      candidate = gltf.scene;
      if (this.disposed) throw new Error('Hand has been disposed');
      const clip = this.validateAsset(gltf);
      candidate.scale.multiplyScalar(HAND_SCALE);
      mixer = new THREE.AnimationMixer(candidate);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      action.time = 0;
      mixer.update(0);
      candidate.updateMatrixWorld(true);
      const markers = Array.from({ length: 8 }, (_, index) => candidate!.getObjectByName(`hit_axis_${String(index).padStart(2, '0')}`)!);
      const idleHeight = markers[0].getWorldPosition(new THREE.Vector3()).y;
      for (const marker of markers) {
        const point = marker.getWorldPosition(new THREE.Vector3());
        if (![point.x, point.y, point.z].every(Number.isFinite) || idleHeight <= 0 || Math.abs(point.x) > 0.0003 || Math.abs(point.y - idleHeight) > 0.001) {
          throw new Error(`Hand marker ${marker.name} must lie on the horizontal idle index axis above the table`);
        }
      }
      const idleTip = markers[7].getWorldPosition(new THREE.Vector3());
      if (idleTip.z <= 0) throw new Error('Hand idle index tip must extend along +Z');
      const surfaces = this.sampleSurfaces(candidate);
      if (this.disposed) throw new Error('Hand has been disposed');
      candidate.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        object.frustumCulled = false;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          material.color.set('#d9a181');
          material.metalness = 0;
          material.roughness = 0.65;
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.ior = 1.4;
            material.specularIntensity = 0.35;
            material.specularColor.set('#ffffff');
          }
        }
      });
      this.model = candidate;
      this.mixer = mixer;
      this.action = action;
      this.markers = markers;
      this.surfaces = surfaces;
      this.reach = idleTip.z + COIN_RADIUS + 0.002;
      this.add(candidate);
      if (this.lastPose) this.applyPose(this.lastPose);
    } catch (error) {
      if (candidate) {
        mixer?.stopAllAction();
        mixer?.uncacheRoot(candidate);
        disposeModel(candidate);
      }
      throw error;
    }
  }

  private validateAsset(gltf: GLTF): THREE.AnimationClip {
    for (const name of BONE_NAMES) {
      if (!(gltf.scene.getObjectByName(name) instanceof THREE.Bone)) throw new Error(`Hand is missing bone ${name}`);
    }
    const clip = gltf.animations.find((animation) => animation.name === 'FlickCharge');
    if (!clip || Math.abs(clip.duration - 1) > 0.01) throw new Error('Hand requires the one-second FlickCharge animation');
    for (const name of BONE_NAMES.slice(1)) {
      if (!clip.tracks.some((track) => track.name === `${name}.quaternion`)) throw new Error(`Hand animation does not drive ${name}`);
    }
    for (let index = 0; index < 8; index++) {
      const name = `hit_axis_${String(index).padStart(2, '0')}`;
      const marker = gltf.scene.getObjectByName(name);
      if (!marker) throw new Error(`Hand is missing marker ${name}`);
      let ancestor = marker.parent;
      while (ancestor && !(ancestor instanceof THREE.Bone)) ancestor = ancestor.parent;
      if (!ancestor) throw new Error(`Hand marker ${name} must follow a bone`);
    }
    let skinned = false;
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.geometry.hasAttribute('skinIndex') && object.geometry.hasAttribute('skinWeight')) skinned = true;
    });
    if (!skinned) throw new Error('Hand requires real skinned geometry');
    return clip;
  }

  private sampleSurfaces(model: THREE.Group): SurfaceSamples[] {
    const surfaces: SurfaceSamples[] = [];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute('position');
      const indices = object.geometry.index;
      const count = indices?.count ?? positions.count;
      const vertices = new Map<number, THREE.Vector3>();
      const points: SurfacePoint[] = [];
      const cells = new Set<string>();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const point = new THREE.Vector3();
      const getVertex = (index: number) => {
        let vertex = vertices.get(index);
        if (!vertex) {
          vertex = new THREE.Vector3();
          object.getVertexPosition(index, vertex);
          vertices.set(index, vertex);
        }
        return vertex;
      };
      for (let offset = 0; offset < count; offset += 3) {
        const ia = indices ? indices.getX(offset) : offset;
        const ib = indices ? indices.getX(offset + 1) : offset + 1;
        const ic = indices ? indices.getX(offset + 2) : offset + 2;
        const va = getVertex(ia);
        const vb = getVertex(ib);
        const vc = getVertex(ic);
        a.copy(va).applyMatrix4(object.matrixWorld);
        b.copy(vb).applyMatrix4(object.matrixWorld);
        c.copy(vc).applyMatrix4(object.matrixWorld);
        const divisions = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SURFACE_SPACING));
        for (let row = 0; row <= divisions; row++) {
          for (let column = 0; column <= divisions - row; column++) {
            const wb = row / divisions;
            const wc = column / divisions;
            const wa = 1 - wb - wc;
            point.copy(a).multiplyScalar(wa).addScaledVector(b, wb).addScaledVector(c, wc);
            const key = `${Math.round(point.x / SURFACE_SPACING)},${Math.round(point.y / SURFACE_SPACING)},${Math.round(point.z / SURFACE_SPACING)}`;
            if (cells.has(key)) continue;
            cells.add(key);
            points.push({ a: va, b: vb, c: vc, wa, wb, wc });
          }
        }
      }
      // Flat-shaded exports duplicate many vertices. Update only vertices used
      // by retained surface samples when a player presses the hand.
      const used = new Set(points.flatMap((sample) => [sample.a, sample.b, sample.c]));
      for (const [index, vertex] of vertices) if (!used.has(vertex)) vertices.delete(index);
      surfaces.push({ mesh: object, vertices, points });
    });
    return surfaces;
  }

  /** timeSeconds=0 keeps the pose still, including prefers-reduced-motion. */
  setPose(coin: { x: number; z: number }, direction: { x: number; z: number }, power: number, timeSeconds = 0): void {
    if (this.disposed) return;
    this.lastPose = { coin: { ...coin }, direction: { ...direction }, power, timeSeconds };
    this.applyPose(this.lastPose);
  }

  private applyPose(pose: HandPose): void {
    const length = Math.hypot(pose.direction.x, pose.direction.z);
    const x = length > 1e-8 ? pose.direction.x / length : 0;
    const z = length > 1e-8 ? pose.direction.z / length : -1;
    const charge = Number.isFinite(pose.power) ? THREE.MathUtils.clamp(pose.power, 0, 1) : 0;
    const time = Number.isFinite(pose.timeSeconds) && pose.timeSeconds > 0 ? pose.timeSeconds : 0;
    const tremor = time > 0 ? THREE.MathUtils.smoothstep(charge, 0.68, 1) : 0;
    const sideShake = (Math.sin(time * 53) * 0.00125 + Math.sin(time * 79) * 0.0004) * tremor;
    const forwardShake = Math.sin(time * 47) * 0.0014 * tremor;
    this.position.set(pose.coin.x - x * this.reach + z * sideShake + x * forwardShake, 0, pose.coin.z - z * this.reach - x * sideShake + z * forwardShake);
    this.rotation.set(0, Math.atan2(x, z) + Math.sin(time * 37) * 0.025 * tremor, 0);
    if (this.action && this.mixer) {
      this.action.enabled = true;
      this.action.paused = true;
      this.action.time = charge * this.action.getClip().duration;
      this.mixer.update(0);
    }
    this.refreshWorldMatrices();
  }

  private refreshWorldMatrices(): void {
    // SkinnedMesh updates attached bindMatrixInverse in updateMatrixWorld,
    // not updateWorldMatrix. Match the renderer before CPU skin evaluation.
    this.parent?.updateWorldMatrix(true, false);
    this.updateMatrixWorld(true);
  }

  getHitPoints(): Vec3[] {
    if (this.disposed || !this.visible || !this.model) return [];
    this.refreshWorldMatrices();
    const point = new THREE.Vector3();
    const result: Vec3[] = this.markers.map((marker) => {
      marker.getWorldPosition(point);
      return { x: point.x, y: point.y, z: point.z };
    });
    for (const surface of this.surfaces) {
      for (const [index, vertex] of surface.vertices) surface.mesh.getVertexPosition(index, vertex);
      for (const sample of surface.points) {
        point.copy(sample.a).multiplyScalar(sample.wa).addScaledVector(sample.b, sample.wb).addScaledVector(sample.c, sample.wc).applyMatrix4(surface.mesh.matrixWorld);
        result.push({ x: point.x, y: point.y, z: point.z });
      }
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.abortController?.abort();
    if (this.model) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.model);
      this.remove(this.model);
      disposeModel(this.model);
    }
    this.model = null;
    this.mixer = null;
    this.action = null;
    this.markers = [];
    this.surfaces = [];
    this.lastPose = null;
  }
}

function disposeModel(model: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
  model.clear();
}
