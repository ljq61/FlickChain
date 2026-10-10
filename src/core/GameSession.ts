import type { Direction, GameMode, GamePhase, GameView, LevelConfig, ShotFacts, WorldFrame } from '../types/contracts';
import { PhysicsWorld, type PhysicsFeedback } from '../physics/PhysicsWorld';
export type { PhysicsFeedback } from '../physics/PhysicsWorld';
import { PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { certainFouls, resolveShot } from '../gameplay/ShotResolver';

let sessionSequence = 0;
/** Sole writer of business state; physics owns the board. No renderer/DOM imports. */
export class GameSession {
  private disposed = false;
  private accumulator = 0;
  private feedback: PhysicsFeedback[] = [];
  private facts: ShotFacts | null = null;
  private shotSteps = 0;
  private quietSteps = 0;
  private pausedPhase: GamePhase | null = null;
  private readonly state: GameView;
  private constructor(private readonly physics: PhysicsWorld, level: LevelConfig, mode: GameMode, firstPlayer: 0 | 1) {
    this.state = {
      sessionId: `flickchain-${++sessionSequence}`, revision: 0, mode, phase: 'selecting', levelId: level.id,
      activeCoinId: null, currentPlayer: firstPlayer, scores: [0, 0], remaining: level.coins.length,
      chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null,
    };
  }
  static async create(level: LevelConfig, mode: GameMode, firstPlayer: 0 | 1 = 0): Promise<GameSession> {
    if ((mode !== 'challenge' && mode !== 'battle') || (firstPlayer !== 0 && firstPlayer !== 1)) throw new Error('无效模式或先手');
    const snapshot = structuredClone(level);
    const physics = await PhysicsWorld.create(snapshot);
    return new GameSession(physics, snapshot, mode, firstPlayer);
  }
  get view(): GameView { return structuredClone(this.state); }
  get frame(): WorldFrame { return this.physics.frame; }
  /** Consume presentation events exactly once; these never affect shot resolution. */
  drainFeedback(): PhysicsFeedback[] {
    const feedback = this.feedback; this.feedback = [];
    return feedback;
  }
  shoot(direction: Direction, power: number): boolean {
    if (this.disposed || this.state.phase !== 'ready' || !this.state.activeCoinId) return false;
    if (!this.physics.applyShot(this.state.activeCoinId, direction, power)) return false;
    this.facts = { sourceCoinId: this.state.activeCoinId, contacts: [], fallenCoinIds: [], timedOut: false };
    this.shotSteps = 0; this.quietSteps = 0; this.accumulator = 0; this.feedback = [];
    this.state.phase = 'simulating'; this.state.shotCount++; this.state.revision++;
    this.state.foulReasons = []; this.state.lastResult = null;
    return true;
  }
  selectCoin(id: string): boolean {
    // Selecting starts the run; while ready and unshot, the launch coin can still be switched.
    if (this.disposed || (this.state.phase !== 'selecting' && this.state.phase !== 'ready') || !this.physics.hasCoin(id)) return false;
    this.state.activeCoinId = id; this.state.phase = 'ready'; this.state.revision++;
    return true;
  }
  tick(elapsedSeconds: number): void {
    if (this.disposed || this.state.phase !== 'simulating' || !this.facts || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return;
    // Long/background frames drop wall-clock backlog rather than burst through shots.
    this.accumulator = Math.min(this.accumulator + Math.min(elapsedSeconds, PHYSICS_CONFIG.maxFrameSeconds), PHYSICS_CONFIG.fixedDt * PHYSICS_CONFIG.maxStepsPerFrame);
    try {
      while (this.accumulator + 1e-12 >= PHYSICS_CONFIG.fixedDt && this.facts) {
        this.accumulator -= PHYSICS_CONFIG.fixedDt;
        const events = this.physics.step();
        this.feedback.push(...events.feedback);
        // Audio consumers can be muted or absent; prevent an unbounded presentation backlog.
        if (this.feedback.length > 64) this.feedback.splice(0, this.feedback.length - 64);
        this.facts.contacts.push(...events.contacts);
        this.facts.fallenCoinIds.push(...events.fallenCoinIds.filter((id) => !this.facts!.fallenCoinIds.includes(id)));
        const certain = certainFouls(this.facts);
        if (certain.join(',') !== this.state.foulReasons.join(',')) { this.state.foulReasons = certain; this.state.revision++; }
        this.shotSteps++;
        this.quietSteps = this.physics.isSettled() ? this.quietSteps + 1 : 0;
        if (this.quietSteps >= PHYSICS_CONFIG.settledSteps) this.settle(false);
        else if (this.shotSteps >= PHYSICS_CONFIG.maxShotSteps) this.settle(true);
      }
    } catch (error) {
      this.physics.freeze(); this.facts = null; this.accumulator = 0; this.feedback = [];
      this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.state.revision++;
    }
  }
  private settle(timedOut: boolean): void {
    const facts = this.facts;
    if (!facts) return;
    facts.timedOut = timedOut;
    // Compute support before freezing; frozen velocities alone never prove support.
    const supported = this.physics.allSupported();
    if (timedOut) this.physics.freeze();
    const result = resolveShot(facts);
    this.facts = null; this.accumulator = 0;
    this.state.lastResult = result; this.state.foulReasons = [...result.reasons];
    for (const id of facts.fallenCoinIds) this.physics.removeCoin(id);
    this.state.remaining = this.physics.frame.coins.length;
    if (timedOut && !supported) {
      this.state.phase = 'error'; this.state.error = '模拟超时，存在未获得稳定桌面支撑的硬币。请重建本局。';
      this.state.revision++; return;
    }
    if (result.outcome === 'SUCCESS') {
      if (!this.physics.hasCoin(result.targetCoinId) || !this.physics.canRemoveSource(result.sourceCoinId)) {
        this.physics.freeze(); this.state.phase = 'error'; this.state.error = '接力结算支撑异常，未移除当前币或加分。';
        this.state.revision++; return;
      }
      this.physics.removeCoin(result.sourceCoinId);
      this.state.scores[this.state.currentPlayer]++;
      this.state.chain++;
      this.state.activeCoinId = result.targetCoinId;
      this.state.remaining = this.physics.frame.coins.length;
      this.state.phase = this.state.remaining <= 1 ? 'complete' : 'ready';
    } else {
      this.state.chain = 0;
      if (this.state.mode === 'challenge') this.state.phase = 'failed';
      else if (this.state.remaining <= 1) this.state.phase = 'complete';
      else {
        this.state.currentPlayer = this.state.currentPlayer === 0 ? 1 : 0;
        this.state.activeCoinId = null;
        this.state.phase = 'selecting';
      }
      if (!this.physics.hasCoin(facts.sourceCoinId)) this.state.activeCoinId = null;
    }
    if (this.state.mode === 'battle' && this.state.phase === 'complete') {
      this.state.winner = this.state.scores[0] === this.state.scores[1] ? 'draw' : this.state.scores[0] > this.state.scores[1] ? 0 : 1;
    }
    if (timedOut && this.state.mode === 'battle' && (this.state.phase === 'ready' || this.state.phase === 'selecting')) this.physics.unfreeze();
    this.state.revision++;
  }
  pause(): void {
    if (this.disposed || this.state.phase === 'paused') return;
    this.pausedPhase = this.state.phase; this.state.phase = 'paused'; this.accumulator = 0; this.feedback = []; this.state.revision++;
  }
  resume(): void {
    if (this.disposed || this.state.phase !== 'paused' || !this.pausedPhase) return;
    this.state.phase = this.pausedPhase; this.pausedPhase = null; this.accumulator = 0; this.state.revision++;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.facts = null; this.accumulator = 0; this.feedback = []; this.physics.dispose();
    this.state.phase = 'error'; this.state.error = '会话已销毁'; this.state.activeCoinId = null; this.state.remaining = 0; this.state.revision++;
  }
}
