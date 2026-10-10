import RAPIER from '@dimforge/rapier3d-compat';
import { validateLevel } from '../content/LevelValidator';
import type { Direction, LevelConfig, WorldFrame } from '../types/contracts';
import { COIN_RADIUS, COIN_THICKNESS, MATERIALS, PHYSICS_CONFIG, impulseForPower } from './MaterialRegistry';
import { tableClearance } from './TableGeometry';

let initialization: Promise<void> | undefined;
interface CoinBinding {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  free: boolean;
  supportSteps: number;
}
export type PhysicsFeedback = 'coin' | 'wall';
export interface PhysicsEvents { contacts: [string, string][]; fallenCoinIds: string[]; feedback: PhysicsFeedback[] }

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly coins = new Map<string, CoinBinding>();
  private readonly colliderIds = new Map<number, string>();
  private readonly fallen = new Set<string>();
  private readonly obstacleHandles = new Set<number>();
  private readonly tableCollider: RAPIER.Collider;
  private disposed = false;
  private frozen = false;
  private constructor(private readonly level: LevelConfig) {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS_CONFIG.gravity, z: 0 });
    this.world.timestep = PHYSICS_CONFIG.fixedDt;
    this.world.numSolverIterations = PHYSICS_CONFIG.solverIterations;
    this.events = new RAPIER.EventQueue(true);
    const tableDesc = level.table.shape === 'circle'
      ? RAPIER.ColliderDesc.cylinder(PHYSICS_CONFIG.tableThickness / 2, level.table.width / 2)
      : RAPIER.ColliderDesc.cuboid(level.table.width / 2, PHYSICS_CONFIG.tableThickness / 2, level.table.depth / 2);
    this.tableCollider = this.world.createCollider(tableDesc
      .setTranslation(0, -PHYSICS_CONFIG.tableThickness / 2, 0).setFriction(MATERIALS.wood.friction).setRestitution(MATERIALS.wood.restitution));
    for (const obstacle of level.obstacles) {
      const angle = obstacle.rotation ?? 0;
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(obstacle.width / 2, PHYSICS_CONFIG.obstacleHeight / 2, obstacle.depth / 2)
        .setTranslation(obstacle.x, PHYSICS_CONFIG.obstacleHeight / 2, obstacle.z)
        .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
        .setFriction(MATERIALS.wood.friction).setRestitution(MATERIALS.wood.obstacleRestitution));
      this.obstacleHandles.add(collider.handle);
    }
    for (const coin of [...level.coins].sort((a, b) => a.id.localeCompare(b.id))) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(coin.x, COIN_THICKNESS / 2 + PHYSICS_CONFIG.initialYGap, coin.z)
        .enabledRotations(false, true, false).setCcdEnabled(true)
        .setLinearDamping(PHYSICS_CONFIG.linearDamping).setAngularDamping(PHYSICS_CONFIG.angularDamping));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(COIN_THICKNESS / 2, COIN_RADIUS)
        .setMass(MATERIALS.standard.mass).setFriction(MATERIALS.standard.friction)
        .setRestitution(MATERIALS.standard.restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      this.coins.set(coin.id, { body, collider, free: false, supportSteps: 0 });
      this.colliderIds.set(collider.handle, coin.id);
    }
  }
  static async create(level: LevelConfig): Promise<PhysicsWorld> {
    const snapshot = validateLevel(level);
    initialization ??= RAPIER.init().catch((error) => { initialization = undefined; throw error; });
    await initialization;
    // Own a snapshot so callers cannot mutate geometry after validation.
    const instance = new PhysicsWorld(snapshot);
    try {
      for (let i = 0; i < PHYSICS_CONFIG.initialSettleSteps; i++) {
        const events = instance.step();
        if (events.contacts.length || events.fallenCoinIds.length) throw new Error('关卡初态产生碰撞或掉落');
      }
      if (!instance.allSupported() || !instance.isQuiet()) throw new Error('关卡初态没有稳定桌面支撑');
      for (const coin of snapshot.coins) {
        const position = instance.coins.get(coin.id)!.body.translation();
        if (Math.hypot(position.x - coin.x, position.z - coin.z) > PHYSICS_CONFIG.maxInitialDrift) throw new Error('关卡预稳定改变了布局');
      }
      return instance;
    } catch (error) { instance.dispose(); throw error; }
  }
  static validate(level: LevelConfig): void { validateLevel(level); }
  get frame(): WorldFrame {
    return {
      table: { ...this.level.table }, obstacles: this.level.obstacles.map((o) => ({ ...o })),
      coins: [...this.coins.entries()].map(([id, { body }]) => ({ id, materialId: 'standard', position: { ...body.translation() }, rotation: { ...body.rotation() } })),
    };
  }
  hasCoin(id: string): boolean { return !this.disposed && this.coins.has(id) && !this.fallen.has(id); }
  applyShot(id: string, direction: Direction, power: number): boolean {
    if (this.disposed || this.frozen || !this.hasCoin(id) || !direction || typeof direction !== 'object' || ![direction.x, direction.z, power].every(Number.isFinite) || power < PHYSICS_CONFIG.minPower || power > 1) return false;
    const length = Math.hypot(direction.x, direction.z);
    if (!Number.isFinite(length) || length < PHYSICS_CONFIG.minDirectionLength) return false;
    const impulse = impulseForPower(power);
    this.coins.get(id)!.body.applyImpulse({ x: direction.x / length * impulse, y: 0, z: direction.z / length * impulse }, true);
    return true;
  }
  step(): PhysicsEvents {
    if (this.disposed || this.frozen) return { contacts: [], fallenCoinIds: [], feedback: [] };
    this.world.step(this.events);
    const contacts: [string, string][] = [];
    const feedback: PhysicsFeedback[] = [];
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const left = this.colliderIds.get(a), right = this.colliderIds.get(b);
      if (left && right) {
        contacts.push(left < right ? [left, right] : [right, left]);
        feedback.push('coin');
      } else if ((left && this.obstacleHandles.has(b)) || (right && this.obstacleHandles.has(a))) {
        feedback.push('wall');
      }
      // Table support contacts stay silent and never become shot targets.
    });
    const fallenCoinIds: string[] = [];
    for (const [id, coin] of this.coins) {
      const position = coin.body.translation(), rotation = coin.body.rotation();
      if (![position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) throw new Error('物理世界出现非有限位姿');
      if (position.y < PHYSICS_CONFIG.fallY && !this.fallen.has(id)) { this.fallen.add(id); fallenCoinIds.push(id); }
      const onTable = this.supported(coin);
      const edge = tableClearance(this.level.table, position.x, position.z) < COIN_RADIUS * PHYSICS_CONFIG.edgeUnlockRadiusFraction;
      if ((!onTable || edge) && !coin.free) {
        coin.free = true; coin.supportSteps = 0;
        coin.body.setEnabledRotations(true, true, true, true);
      } else if (onTable && !edge && coin.free) {
        coin.supportSteps++;
        // Re-lock only an upright, quiet re-landing; never teleport its pose.
        if (coin.supportSteps >= PHYSICS_CONFIG.resupportSteps && Math.abs(rotation.x) + Math.abs(rotation.z) < PHYSICS_CONFIG.uprightQuaternionTolerance && this.quiet(coin)) {
          coin.free = false; coin.body.setEnabledRotations(false, true, false, false);
        }
      } else if (!onTable) coin.supportSteps = 0;
    }
    return { contacts, fallenCoinIds, feedback };
  }
  private supported(coin: CoinBinding): boolean {
    if (this.disposed) return false;
    const p = coin.body.translation();
    if (tableClearance(this.level.table, p.x, p.z) <= 0 || p.y < PHYSICS_CONFIG.minSupportedCenterY || p.y > COIN_RADIUS + PHYSICS_CONFIG.supportTolerance) return false;
    let contact = false;
    this.world.contactPair(coin.collider, this.tableCollider, (manifold) => {
      // Table-top contact, including a naturally tilted coin; side contacts are not support.
      if (Math.abs(manifold.normal().y) < PHYSICS_CONFIG.minSupportNormalY) return;
      for (let i = 0; i < manifold.numSolverContacts(); i++) {
        if (Math.abs(manifold.solverContactPoint(i).y) < PHYSICS_CONFIG.tableContactTolerance) contact = true;
      }
    });
    return contact;
  }
  private quiet(coin: CoinBinding): boolean {
    const linear = coin.body.linvel(), angular = coin.body.angvel();
    return Math.hypot(linear.x, linear.y, linear.z) < PHYSICS_CONFIG.settledLinearSpeed && Math.hypot(angular.x, angular.y, angular.z) < PHYSICS_CONFIG.settledAngularSpeed;
  }
  isQuiet(): boolean { return !this.disposed && [...this.coins].every(([id, coin]) => this.fallen.has(id) || this.quiet(coin)); }
  allSupported(): boolean { return !this.disposed && [...this.coins].every(([id, coin]) => this.fallen.has(id) || this.supported(coin)); }
  isSettled(): boolean { return this.isQuiet() && this.allSupported(); }
  canRemoveSource(id: string): boolean {
    // Each survivor must have direct fixed-table support, never support from A.
    return this.hasCoin(id) && [...this.coins].every(([coinId, coin]) => coinId === id || this.fallen.has(coinId) || this.supported(coin));
  }
  freeze(): void {
    if (this.disposed || this.frozen) return;
    for (const { body } of this.coins.values()) { body.setLinvel({ x: 0, y: 0, z: 0 }, false); body.setAngvel({ x: 0, y: 0, z: 0 }, false); }
    this.frozen = true;
  }
  unfreeze(): void { if (!this.disposed) this.frozen = false; }
  removeCoin(id: string): void {
    if (this.disposed) return;
    const coin = this.coins.get(id);
    if (!coin) return;
    this.colliderIds.delete(coin.collider.handle);
    this.world.removeRigidBody(coin.body);
    this.coins.delete(id); this.fallen.delete(id);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.coins.clear(); this.colliderIds.clear(); this.fallen.clear(); this.obstacleHandles.clear();
    this.events.free(); this.world.free();
  }
}
