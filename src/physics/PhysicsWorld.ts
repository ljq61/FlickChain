import RAPIER from '@dimforge/rapier3d-compat';
import { validateLevel } from '../content/LevelValidator';
import type { CoinConfig, CoinMaterialId, Direction, LevelConfig, ObstacleConfig, WorldFrame } from '../types/contracts';
import { COIN_THICKNESS, coinRadius, MATERIALS, PHYSICS_CONFIG, impulseForPower } from './MaterialRegistry';
import { tableClearance } from './TableGeometry';

let initialization: Promise<void> | undefined;
interface CoinBinding {
  materialId: CoinMaterialId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  free: boolean;
  supportSteps: number;
}
export type PhysicsFeedback = 'coin' | 'wall';
export interface PhysicsEvents { contacts: [string, string][]; fallenCoinIds: string[]; feedback: PhysicsFeedback[] }
/** Rapier bytes plus the production bookkeeping that lives outside its world. */
export interface PhysicsSnapshot {
  version: string;
  level: LevelConfig;
  bytes: Uint8Array;
  tableHandle: number;
  coins: { id: string; materialId: CoinMaterialId; bodyHandle: number; colliderHandle: number; free: boolean; supportSteps: number }[];
  fallen: string[];
  frozen: boolean;
  obstacles: [string, number][];
  shotSourceId: string | null;
  shotTargets: string[];
  pendingImpactTargets: string[];
  freshCoinIds: string[];
}

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly coins = new Map<string, CoinBinding>();
  private readonly colliderIds = new Map<number, string>();
  private readonly fallen = new Set<string>();
  private readonly obstacleHandles = new Set<number>();
  private readonly obstacleIds = new Map<string, number>();
  private readonly tableCollider: RAPIER.Collider;
  private disposed = false;
  private frozen = false;
  private shotSourceId: string | null = null;
  private readonly shotTargets = new Set<string>();
  private readonly pendingImpactTargets = new Set<string>();
  private readonly freshCoins = new Set<string>();
  private constructor(private level: LevelConfig, snapshot?: PhysicsSnapshot) {
    if (snapshot) {
      this.world = RAPIER.World.restoreSnapshot(snapshot.bytes);
      this.events = new RAPIER.EventQueue(true);
      this.tableCollider = this.world.getCollider(snapshot.tableHandle);
      for (const coin of snapshot.coins) {
        this.coins.set(coin.id, { materialId: coin.materialId, body: this.world.getRigidBody(coin.bodyHandle),
          collider: this.world.getCollider(coin.colliderHandle), free: coin.free, supportSteps: coin.supportSteps });
        this.colliderIds.set(coin.colliderHandle, coin.id);
      }
      for (const id of snapshot.fallen) this.fallen.add(id);
      for (const [id, handle] of snapshot.obstacles) { this.obstacleIds.set(id, handle); this.obstacleHandles.add(handle); }
      this.frozen = snapshot.frozen; this.shotSourceId = snapshot.shotSourceId;
      for (const id of snapshot.shotTargets) this.shotTargets.add(id);
      for (const id of snapshot.pendingImpactTargets) this.pendingImpactTargets.add(id);
      for (const id of snapshot.freshCoinIds) this.freshCoins.add(id);
      return;
    }
    this.world = new RAPIER.World({ x: 0, y: PHYSICS_CONFIG.gravity, z: 0 });
    this.events = new RAPIER.EventQueue(true);
    this.world.timestep = PHYSICS_CONFIG.fixedDt / PHYSICS_CONFIG.integrationSubsteps;
    this.world.numSolverIterations = PHYSICS_CONFIG.solverIterations;
    const tableDesc = level.table.shape === 'circle'
      ? RAPIER.ColliderDesc.cylinder(PHYSICS_CONFIG.tableThickness / 2, level.table.width / 2)
      : RAPIER.ColliderDesc.cuboid(level.table.width / 2, PHYSICS_CONFIG.tableThickness / 2, level.table.depth / 2);
    this.tableCollider = this.world.createCollider(tableDesc
      .setTranslation(0, -PHYSICS_CONFIG.tableThickness / 2, 0).setFriction(MATERIALS[level.table.materialId].friction).setRestitution(MATERIALS[level.table.materialId].restitution));
    for (const obstacle of level.obstacles) this.addObstacle(obstacle);
    for (const coin of [...level.coins].sort((a, b) => a.id.localeCompare(b.id))) this.addCoin(coin);
  }
  private addObstacle(obstacle: ObstacleConfig): void {
    const height = obstacle.kind === 'glass' ? PHYSICS_CONFIG.glassHeight : PHYSICS_CONFIG.obstacleHeight;
    // The glass bottom cap must not coincide with the table top: at this seam
    // CCD can push a thin fast coin below the cap and into the solid cylinder.
    // Extend only the hidden base into the table; the visible outline stays exact.
    const embeddedBase = obstacle.kind === 'glass' ? PHYSICS_CONFIG.tableThickness / 2 : 0;
    const shape = obstacle.kind === 'glass'
      ? RAPIER.ColliderDesc.cylinder((height + embeddedBase) / 2, obstacle.width / 2)
      : RAPIER.ColliderDesc.cuboid(obstacle.width / 2, height / 2, obstacle.depth / 2);
    const angle = obstacle.rotation ?? 0;
    const collider = this.world.createCollider(shape
      .setTranslation(obstacle.x, (height - embeddedBase) / 2, obstacle.z)
      .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
      .setFriction(MATERIALS.wood.friction).setRestitution(MATERIALS.wood.obstacleRestitution));
    this.obstacleHandles.add(collider.handle); this.obstacleIds.set(obstacle.id, collider.handle);
  }
  private addCoin(coin: CoinConfig, gap: number = PHYSICS_CONFIG.initialYGap): void {
    const material = MATERIALS[coin.materialId];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(coin.x, COIN_THICKNESS / 2 + gap, coin.z)
      .enabledRotations(false, true, false).setCcdEnabled(true)
      .setLinearDamping(PHYSICS_CONFIG.linearDamping).setAngularDamping(PHYSICS_CONFIG.angularDamping));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(COIN_THICKNESS / 2, coinRadius(coin.materialId))
      .setMass(material.mass).setFriction(material.friction)
      .setRestitution(material.restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.coins.set(coin.id, { body, collider, materialId: coin.materialId, free: false, supportSteps: 0 });
    this.colliderIds.set(collider.handle, coin.id);
    if (gap === 0) this.freshCoins.add(coin.id);
  }
  /** Retain every existing body exactly; additions start flat at the supported tabletop height.
   * No simulation runs here: round presentation must not perturb the settled survivor. */
  reconfigure(level: LevelConfig): boolean {
    if (this.disposed || !this.isQuiet() || !this.allSupported()) return false;
    let snapshot: LevelConfig;
    const sameObstacle = (a: ObstacleConfig, b: ObstacleConfig) => a.id === b.id
      && a.x === b.x && a.z === b.z && a.width === b.width && a.depth === b.depth
      && (a.kind ?? 'box') === (b.kind ?? 'box') && (a.rotation ?? 0) === (b.rotation ?? 0);
    try {
      const unchangedObstacles = new Set(this.level.obstacles.filter((old) => level.obstacles?.some((next) => sameObstacle(old, next))).map((o) => o.id));
      snapshot = validateLevel(level, new Set(this.coins.keys()), unchangedObstacles);
      const oldTable = this.level.table, table = snapshot.table;
      if (oldTable.width !== table.width || oldTable.depth !== table.depth || (oldTable.shape ?? 'rectangle') !== (table.shape ?? 'rectangle')) return false;
      for (const [id, coin] of this.coins) {
        const config = snapshot.coins.find((candidate) => candidate.id === id);
        const position = coin.body.translation();
        if (!config || config.materialId !== coin.materialId || config.x !== position.x || config.z !== position.z) return false;
      }
    } catch { return false; }
    // Validation is complete before changing any authoritative state.
    this.events.drainCollisionEvents(() => {});
    for (const old of this.level.obstacles) {
      if (snapshot.obstacles.some((next) => sameObstacle(old, next))) continue;
      const handle = this.obstacleIds.get(old.id)!;
      this.world.removeCollider(this.world.getCollider(handle), false);
      this.obstacleHandles.delete(handle); this.obstacleIds.delete(old.id);
    }
    for (const obstacle of snapshot.obstacles) {
      if (!this.level.obstacles.some((old) => sameObstacle(old, obstacle))) this.addObstacle(obstacle);
    }
    this.tableCollider.setFriction(MATERIALS[snapshot.table.materialId].friction);
    this.tableCollider.setRestitution(MATERIALS[snapshot.table.materialId].restitution);
    for (const coin of [...snapshot.coins].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!this.coins.has(coin.id)) this.addCoin(coin, 0);
    }
    this.level = snapshot; this.fallen.clear(); this.frozen = false;
    this.clearShotContacts();
    return true;
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
        if (events.contacts.length || events.fallenCoinIds.length) throw new Error('The initial level caused a collision or fall');
      }
      if (!instance.allSupported() || !instance.isQuiet()) throw new Error('The initial level contains an unsupported or unsettled coin');
      for (const coin of snapshot.coins) {
        const position = instance.coins.get(coin.id)!.body.translation();
        if (Math.hypot(position.x - coin.x, position.z - coin.z) > PHYSICS_CONFIG.maxInitialDrift) throw new Error('Settling the initial level changed the layout');
      }
      return instance;
    } catch (error) { instance.dispose(); throw error; }
  }
  static validate(level: LevelConfig): void { validateLevel(level); }
  /** Export only a quiet world; step() has drained both event queues at this boundary. */
  snapshot(): PhysicsSnapshot {
    if (this.disposed || !this.isQuiet() || !this.snapshotSupported()) throw new Error('Only a settled physics world with supported coins can be exported');
    return {
      version: PHYSICS_CONFIG.version, level: structuredClone(this.level), bytes: this.world.takeSnapshot(),
      tableHandle: this.tableCollider.handle,
      coins: [...this.coins].map(([id, coin]) => ({ id, materialId: coin.materialId, bodyHandle: coin.body.handle,
        colliderHandle: coin.collider.handle, free: coin.free, supportSteps: coin.supportSteps })),
      fallen: [...this.fallen], frozen: this.frozen, obstacles: [...this.obstacleIds],
      shotSourceId: this.shotSourceId, shotTargets: [...this.shotTargets], pendingImpactTargets: [...this.pendingImpactTargets],
      freshCoinIds: [...this.freshCoins],
    };
  }
  static async restore(input: PhysicsSnapshot): Promise<PhysicsWorld> {
    const snapshot = structuredClone(input);
    if (snapshot.version !== PHYSICS_CONFIG.version || !(snapshot.bytes instanceof Uint8Array) || snapshot.bytes.length === 0) throw new Error('Invalid physics snapshot version or data');
    if (!Array.isArray(snapshot.coins) || !Array.isArray(snapshot.obstacles) || !Array.isArray(snapshot.freshCoinIds)
      || !Array.isArray(snapshot.fallen) || !Array.isArray(snapshot.shotTargets) || !Array.isArray(snapshot.pendingImpactTargets)
      || typeof snapshot.frozen !== 'boolean' || !Number.isFinite(snapshot.tableHandle)
      || snapshot.coins.some((coin) => !coin || typeof coin.id !== 'string' || !coin.id || !Number.isFinite(coin.bodyHandle) || !Number.isFinite(coin.colliderHandle)
        || !Number.isFinite(coin.supportSteps) || coin.supportSteps < 0 || typeof coin.free !== 'boolean' || (coin.materialId !== 'standard' && coin.materialId !== 'iron'))
      || new Set(snapshot.coins.map((coin) => coin.id)).size !== snapshot.coins.length
      || new Set(snapshot.coins.map((coin) => coin.bodyHandle)).size !== snapshot.coins.length
      || new Set(snapshot.coins.map((coin) => coin.colliderHandle)).size !== snapshot.coins.length
      || snapshot.obstacles.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Number.isFinite(entry[1]))
      || [...snapshot.freshCoinIds, ...snapshot.fallen].some((id) => !snapshot.coins.some((coin) => coin.id === id))
      || (snapshot.shotSourceId !== null && !snapshot.coins.some((coin) => coin.id === snapshot.shotSourceId))) throw new Error('Invalid snapshot mapping');
    // The authored level can contain removed coins; actual bodies and moved poses
    // are restored exclusively from Rapier, never recreated from these configs.
    validateLevel(snapshot.level, new Set(snapshot.level.coins.map((coin) => coin.id)), new Set(snapshot.level.obstacles.map((obstacle) => obstacle.id)));
    initialization ??= RAPIER.init().catch((error) => { initialization = undefined; throw error; });
    await initialization;
    const instance = new PhysicsWorld(snapshot.level, snapshot);
    try {
      if (!instance.tableCollider?.isValid()) throw new Error('Invalid snapshot mapping');
      for (const coin of instance.coins.values()) {
        if (!coin.body?.isValid() || !coin.collider?.isValid() || coin.collider.parent()?.handle !== coin.body.handle) throw new Error('Invalid snapshot coin mapping');
      }
      for (const handle of instance.obstacleHandles) if (!instance.world.getCollider(handle)?.isValid()) throw new Error('Invalid snapshot obstacle mapping');
      if (!instance.isQuiet() || !instance.snapshotSupported()) throw new Error('The snapshot contains an unsettled physics world or unsupported coins');
      return instance;
    } catch (error) { instance.dispose(); throw error; }
  }
  get frame(): WorldFrame {
    return {
      table: { ...this.level.table }, obstacles: this.level.obstacles.map((o) => ({ ...o })),
      coins: [...this.coins.entries()].map(([id, { body, materialId }]) => ({ id, materialId, position: { ...body.translation() }, rotation: { ...body.rotation() } })),
    };
  }
  hasCoin(id: string): boolean { return !this.disposed && this.coins.has(id) && !this.fallen.has(id); }
  applyShot(id: string, direction: Direction, power: number): boolean {
    if (this.disposed || this.frozen || !this.hasCoin(id) || !direction || typeof direction !== 'object' || ![direction.x, direction.z, power].every(Number.isFinite) || power < PHYSICS_CONFIG.minPower || power > 1) return false;
    const length = Math.hypot(direction.x, direction.z);
    if (!Number.isFinite(length) || length < PHYSICS_CONFIG.minDirectionLength) return false;
    this.clearShotContacts();
    this.shotSourceId = id;
    this.coins.get(id)!.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const impulse = impulseForPower(power);
    this.coins.get(id)!.body.applyImpulse({ x: direction.x / length * impulse, y: 0, z: direction.z / length * impulse }, true);
    return true;
  }
  step(): PhysicsEvents {
    const contacts: [string, string][] = [];
    const fallenCoinIds: string[] = [];
    const feedback = new Set<PhysicsFeedback>();
    // Keep the public/AI clock fixed while resolving faster impacts in smaller
    // real Rapier steps. Drain each step so brief contacts are never discarded.
    for (let i = 0; i < PHYSICS_CONFIG.integrationSubsteps; i++) {
      const events = this.stepSubstep();
      for (const pair of events.contacts) {
        if (!contacts.some(([left, right]) => left === pair[0] && right === pair[1])) contacts.push(pair);
      }
      fallenCoinIds.push(...events.fallenCoinIds);
      for (const sound of events.feedback) feedback.add(sound);
    }
    return { contacts, fallenCoinIds, feedback: [...feedback] };
  }
  private stepSubstep(): PhysicsEvents {
    if (this.disposed || this.frozen) return { contacts: [], fallenCoinIds: [], feedback: [] };
    // Capture pre-solver approach velocity. A resting/predictive contact alone is
    // not a hit: the source must push into it and Rapier must apply a real impulse.
    const source = this.shotSourceId ? this.coins.get(this.shotSourceId) : undefined;
    const before = source ? new Map([...this.coins].map(([id, coin]) => [id, { velocity: { ...coin.body.linvel() }, position: { ...coin.body.translation() } }])) : null;
    this.world.step(this.events);
    this.freshCoins.clear();
    const contacts: [string, string][] = [];
    const feedback: PhysicsFeedback[] = [];
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const left = this.colliderIds.get(a), right = this.colliderIds.get(b);
      if (left && right) {
        if (left === this.shotSourceId || right === this.shotSourceId) {
          this.pendingImpactTargets.add(left === this.shotSourceId ? right : left); return;
        }
        contacts.push(left < right ? [left, right] : [right, left]);
        feedback.push('coin');
      } else if ((left && this.obstacleHandles.has(b)) || (right && this.obstacleHandles.has(a))) {
        feedback.push('wall');
      }
      // Table support contacts stay silent and never become shot targets.
    });
    // Force events survive brief CCD contacts that may have no manifold left by
    // the end of this inner step. Only the source requests them, so table-wide
    // resting contacts do not add event traffic or shot targets.
    const pushedTargets = new Set<string>();
    this.events.drainContactForceEvents((event) => {
      const a = this.colliderIds.get(event.collider1()), b = this.colliderIds.get(event.collider2());
      const target = a === this.shotSourceId ? b : b === this.shotSourceId ? a : undefined;
      if (target && event.totalForceMagnitude() > 0) pushedTargets.add(target);
    });
    if (source && before && this.shotSourceId) {
      const sourceId = this.shotSourceId, sourceBefore = before.get(sourceId)!;
      for (const targetId of pushedTargets) {
        if (this.shotTargets.has(targetId) && !this.pendingImpactTargets.has(targetId)) continue;
        const targetBefore = before.get(targetId)!;
        const dx = targetBefore.position.x - sourceBefore.position.x;
        const dz = targetBefore.position.z - sourceBefore.position.z;
        // Upright cylinder side normals follow the centre line. Using this line
        // avoids stale oblique manifold normals registering a departing coin.
        const closing = ((sourceBefore.velocity.x - targetBefore.velocity.x) * dx
          + (sourceBefore.velocity.z - targetBefore.velocity.z) * dz) / Math.hypot(dx, dz);
        if (closing <= PHYSICS_CONFIG.minDirectionLength || !Number.isFinite(closing)) continue;
        if (!this.shotTargets.has(targetId)) {
          this.shotTargets.add(targetId);
          contacts.push(sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]);
        }
        feedback.push('coin'); this.pendingImpactTargets.delete(targetId);
      }
    }
    const fallenCoinIds: string[] = [];
    for (const [id, coin] of this.coins) {
      const position = coin.body.translation(), rotation = coin.body.rotation();
      if (![position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) throw new Error('The physics world contains a non-finite position or rotation');
      if (position.y < PHYSICS_CONFIG.fallY && !this.fallen.has(id)) { this.fallen.add(id); fallenCoinIds.push(id); }
      const onTable = this.supported(coin);
      // A rim overhang is stable while the centre of mass remains on the table.
      // Losing a contact for one solver step must not release the tilt axes.
      const edge = tableClearance(this.level.table, position.x, position.z) <= 0;
      const airborne = position.y > COIN_THICKNESS / 2 + PHYSICS_CONFIG.supportTolerance
        || position.y < PHYSICS_CONFIG.minSupportedCenterY;
      if ((airborne || edge) && !coin.free) {
        coin.free = true; coin.supportSteps = 0;
        coin.body.setEnabledRotations(true, true, true, true);
      } else if (onTable && !edge && coin.free) {
        coin.supportSteps += 1 / PHYSICS_CONFIG.integrationSubsteps;
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
    if (tableClearance(this.level.table, p.x, p.z) <= 0 || p.y < PHYSICS_CONFIG.minSupportedCenterY || p.y > coinRadius(coin.materialId) + PHYSICS_CONFIG.supportTolerance) return false;
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
  /** A resting stack is supported when real upward contacts form a chain to the table.
   * Heights alone never prove support: airborne coins still have to land in Rapier. */
  private supportedChain(id: string, excludedId: string | null = null, visiting = new Set<string>()): boolean {
    if (id === excludedId || visiting.has(id) || this.fallen.has(id)) return false;
    const coin = this.coins.get(id);
    if (!coin) return false;
    if (this.supported(coin)) return true;
    const position = coin.body.translation();
    if (tableClearance(this.level.table, position.x, position.z) <= 0 || position.y < PHYSICS_CONFIG.minSupportedCenterY) return false;
    visiting.add(id);
    for (const [lowerId, lower] of this.coins) {
      if (lowerId === id || lowerId === excludedId || this.fallen.has(lowerId)) continue;
      const lowerPosition = lower.body.translation();
      // A positive height gap makes the support graph acyclic and excludes side contacts.
      if (lowerPosition.y >= position.y - COIN_THICKNESS / 4) continue;
      let contact = false;
      this.world.contactPair(coin.collider, lower.collider, (manifold) => {
        if (Math.abs(manifold.normal().y) < PHYSICS_CONFIG.minSupportNormalY) return;
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const y = manifold.solverContactPoint(i).y;
          if (y > lowerPosition.y && y < position.y) contact = true;
        }
      });
      if (contact && this.supportedChain(lowerId, excludedId, visiting)) {
        visiting.delete(id); return true;
      }
    }
    visiting.delete(id); return false;
  }
  allSupported(): boolean { return !this.disposed && [...this.coins].every(([id]) => this.fallen.has(id) || this.supportedChain(id)); }
  private snapshotSupported(): boolean {
    // Refill creates validated flat coins without a simulation step so the
    // retained survivor never drifts. Rapier creates their manifolds next step.
    // Admit only those exact fresh spawn poses to the export boundary; ordinary
    // shot settlement continues to require real contact-chain support above.
    return [...this.coins].every(([id, coin]) => {
      if (this.fallen.has(id) || this.supportedChain(id)) return true;
      if (!this.freshCoins.has(id)) return false;
      const authored = this.level.coins.find((config) => config.id === id), p = coin.body.translation(), r = coin.body.rotation();
      return authored !== undefined && Math.hypot(p.x - authored.x, p.z - authored.z) < 1e-6
        && Math.abs(p.y - COIN_THICKNESS / 2) < 1e-6 && Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z) < 1e-6 && Math.abs(r.w - 1) < 1e-6
        && tableClearance(this.level.table, p.x, p.z) > coinRadius(coin.materialId) + PHYSICS_CONFIG.initialClearance - 1e-6;
    });
  }
  isSettled(): boolean { return this.isQuiet() && this.allSupported(); }
  canRemoveSource(id: string): boolean {
    // Each survivor must retain a support chain to the fixed table without A.
    return this.hasCoin(id) && [...this.coins].every(([coinId]) => coinId === id || this.fallen.has(coinId) || this.supportedChain(coinId, id));
  }
  /** Remove a settled source underneath other coins without moving survivors.
   * Wake only its support dependents so gravity can finish their natural landing;
   * GameSession keeps input locked until this cleanup is genuinely settled. */
  releaseSupportingSource(id: string): boolean {
    if (!this.hasCoin(id) || !this.isSettled()) return false;
    const dependents = [...this.coins].filter(([coinId]) => coinId !== id && !this.fallen.has(coinId) && !this.supportedChain(coinId, id));
    if (dependents.length === 0) return false;
    this.removeCoin(id);
    for (const [, coin] of dependents) coin.body.wakeUp();
    return true;
  }
  private clearShotContacts(): void {
    if (this.shotSourceId) this.coins.get(this.shotSourceId)?.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.shotSourceId = null; this.shotTargets.clear(); this.pendingImpactTargets.clear();
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
    this.freshCoins.delete(id);
    if (this.shotSourceId === id) { this.shotSourceId = null; this.shotTargets.clear(); this.pendingImpactTargets.clear(); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.coins.clear(); this.colliderIds.clear(); this.fallen.clear(); this.obstacleHandles.clear(); this.obstacleIds.clear();
    this.shotSourceId = null; this.shotTargets.clear(); this.pendingImpactTargets.clear();
    this.freshCoins.clear();
    this.events.free(); this.world.free();
  }
}
