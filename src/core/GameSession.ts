import type { Direction, GameMode, GamePhase, GameView, LevelConfig, ShotFacts, WorldFrame } from '../types/contracts';
import { PhysicsWorld, type PhysicsFeedback, type PhysicsSnapshot } from '../physics/PhysicsWorld';
export type { PhysicsFeedback } from '../physics/PhysicsWorld';
import { PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { certainFouls, resolveShot } from '../gameplay/ShotResolver';

let sessionSequence = 0;
export const BATTLE_WIN_SCORE = 5;
export interface SessionSnapshot {
  physics: PhysicsSnapshot;
  view: GameView;
  lastFallenIds: string[];
}
/** Sole writer of business state; physics owns the board. No renderer/DOM imports. */
export class GameSession {
  private disposed = false;
  private accumulator = 0;
  private feedback: PhysicsFeedback[] = [];
  private facts: ShotFacts | null = null;
  private pendingRelay = false;
  private lastFallenIds: string[] = [];
  private shotSteps = 0;
  private quietSteps = 0;
  private pausedPhase: GamePhase | null = null;
  private readonly state: GameView;
  private constructor(private readonly physics: PhysicsWorld, level: LevelConfig, mode: GameMode, firstPlayer: 0 | 1) {
    this.state = {
      sessionId: `flickchain-${++sessionSequence}`, revision: 0, mode, phase: 'selecting', levelId: level.id,
      activeCoinId: null, canSelectCoin: true, currentPlayer: firstPlayer, scores: [0, 0], remaining: level.coins.length,
      chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null,
    };
  }
  static async create(level: LevelConfig, mode: GameMode, firstPlayer: 0 | 1 = 0): Promise<GameSession> {
    if ((mode !== 'challenge' && mode !== 'battle') || (firstPlayer !== 0 && firstPlayer !== 1)) throw new Error('无效模式或先手');
    if (level.purpose === 'opening') throw new Error('先手比较使用独立先手会话');
    const snapshot = structuredClone(level);
    const physics = await PhysicsWorld.create(snapshot);
    return new GameSession(physics, snapshot, mode, firstPlayer);
  }
  get view(): GameView { return structuredClone(this.state); }
  get frame(): WorldFrame { return this.physics.frame; }
  get lastFallenCoinIds(): readonly string[] { return [...this.lastFallenIds]; }
  /** AI clones the exact settled production world; no fresh-layout approximation. */
  exportSnapshot(): SessionSnapshot {
    if (this.disposed || (this.state.phase !== 'ready' && this.state.phase !== 'selecting')) throw new Error('仅能导出可操作的静止游戏会话');
    return { physics: this.physics.snapshot(), view: this.view, lastFallenIds: [...this.lastFallenIds] };
  }
  static async restore(input: SessionSnapshot): Promise<GameSession> {
    const snapshot = structuredClone(input);
    const view = snapshot.view;
    if (!view || (view.mode !== 'challenge' && view.mode !== 'battle') || (view.currentPlayer !== 0 && view.currentPlayer !== 1)
      || (view.phase !== 'ready' && view.phase !== 'selecting') || view.winner !== null
      || !Array.isArray(view.scores) || view.scores.length !== 2 || view.scores.some((score) => !Number.isInteger(score) || score < 0)
      || !Number.isInteger(view.remaining) || view.remaining < 2 || typeof view.canSelectCoin !== 'boolean' || view.error !== null
      || !Number.isInteger(view.shotCount) || view.shotCount < 0 || !Number.isInteger(view.chain) || view.chain < 0
      || !Number.isInteger(view.revision) || view.revision < 0 || typeof view.sessionId !== 'string' || !view.sessionId
      || snapshot.physics?.level?.purpose === 'opening' || view.levelId !== snapshot.physics?.level?.id
      || (view.mode === 'battle' && view.scores.some((score) => score >= BATTLE_WIN_SCORE))) throw new Error('游戏快照状态无效');
    const physics = await PhysicsWorld.restore(snapshot.physics);
    try {
      if (view.remaining !== physics.frame.coins.length || (view.phase === 'ready' && (!view.activeCoinId || !physics.hasCoin(view.activeCoinId)))
        || (view.phase === 'selecting' && (!view.canSelectCoin || view.activeCoinId !== null))) throw new Error('游戏快照控制映射无效');
      const game = new GameSession(physics, snapshot.physics.level, view.mode, view.currentPlayer);
      Object.assign(game.state, view); game.lastFallenIds = [...snapshot.lastFallenIds];
      return game;
    } catch (error) { physics.dispose(); throw error; }
  }
  /** Refill only an exhausted settled Battle board; carry score, turn and relay. */
  refill(level: LevelConfig): boolean {
    if (this.disposed || this.state.mode !== 'battle' || this.state.phase !== 'refilling' || level.purpose === 'opening') return false;
    const retained = this.state.activeCoinId;
    const canSelect = this.state.canSelectCoin;
    if ((retained && !level.coins.some((coin) => coin.id === retained)) || !this.physics.reconfigure(level)) return false;
    this.continueRound(level.id, retained, canSelect);
    return true;
  }
  /** Continue from the single settled survivor, keeping cumulative score and relay ownership. */
  advanceRound(level: LevelConfig): boolean {
    if (this.disposed || this.state.mode !== 'challenge' || this.state.phase !== 'complete' || this.state.remaining !== 1) return false;
    const survivor = this.physics.frame.coins[0];
    if (!survivor || level.activeCoinId !== survivor.id || !this.physics.reconfigure(level)) return false;
    this.continueRound(level.id, survivor.id, false);
    return true;
  }
  /** App owns the run's revive allowance; Core only accepts a safely settled failed Challenge. */
  revive(level: LevelConfig): boolean {
    if (this.disposed || this.state.mode !== 'challenge' || this.state.phase !== 'failed' || !this.physics.reconfigure(level)) return false;
    this.continueRound(level.id, null, true);
    return true;
  }
  private continueRound(levelId: string, activeCoinId: string | null, canSelectCoin: boolean): void {
    this.facts = null; this.pendingRelay = false; this.accumulator = 0; this.feedback = []; this.lastFallenIds = [];
    this.shotSteps = 0; this.quietSteps = 0; this.pausedPhase = null;
    this.state.levelId = levelId; this.state.activeCoinId = activeCoinId; this.state.canSelectCoin = canSelectCoin;
    this.state.phase = canSelectCoin ? 'selecting' : 'ready'; this.state.remaining = this.physics.frame.coins.length;
    this.state.foulReasons = []; this.state.lastResult = null; this.state.error = null; this.state.winner = null;
    this.state.revision++;
  }
  /** Consume presentation events exactly once; these never affect shot resolution. */
  drainFeedback(): PhysicsFeedback[] {
    const feedback = this.feedback; this.feedback = [];
    return feedback;
  }
  shoot(direction: Direction, power: number): boolean {
    if (this.disposed || this.state.phase !== 'ready' || !this.state.activeCoinId) return false;
    if (!this.physics.applyShot(this.state.activeCoinId, direction, power)) return false;
    this.facts = { sourceCoinId: this.state.activeCoinId, contacts: [], fallenCoinIds: [], timedOut: false };
    this.pendingRelay = false; this.shotSteps = 0; this.quietSteps = 0; this.accumulator = 0; this.feedback = [];
    this.state.phase = 'simulating'; this.state.canSelectCoin = false; this.state.shotCount++; this.state.revision++;
    this.state.foulReasons = []; this.state.lastResult = null;
    return true;
  }
  selectCoin(id: string): boolean {
    // Entry and each new Battle turn allow re-picking until a valid shot is launched.
    // A settled relay keeps the permission closed even though aiming returns to ready.
    if (this.disposed || !this.state.canSelectCoin || (this.state.phase !== 'selecting' && this.state.phase !== 'ready') || !this.physics.hasCoin(id)) return false;
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
        // After a legal settled shot, removing its supporting source may let the
        // target drop onto the table. These cleanup contacts are not a new shot.
        if (!this.pendingRelay) this.facts.contacts.push(...events.contacts);
        this.facts.fallenCoinIds.push(...events.fallenCoinIds.filter((id) => !this.facts!.fallenCoinIds.includes(id)));
        const certain = certainFouls(this.facts);
        if (certain.join(',') !== this.state.foulReasons.join(',')) { this.state.foulReasons = certain; this.state.revision++; }
        this.shotSteps++;
        this.quietSteps = this.physics.isSettled() ? this.quietSteps + 1 : 0;
        if (this.quietSteps >= PHYSICS_CONFIG.settledSteps) this.settle(false);
        else if (this.shotSteps >= PHYSICS_CONFIG.maxShotSteps) this.settle(true);
      }
    } catch (error) {
      this.physics.freeze(); this.facts = null; this.pendingRelay = false; this.accumulator = 0; this.feedback = [];
      this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.state.revision++;
    }
  }
  private settle(timedOut: boolean): void {
    const facts = this.facts;
    if (!facts) return;
    facts.timedOut = timedOut;
    this.lastFallenIds = [...facts.fallenCoinIds];
    // Compute support before freezing; frozen velocities alone never prove support.
    const supported = this.physics.allSupported();
    if (timedOut) this.physics.freeze();
    const result = resolveShot(facts);
    if (result.outcome === 'SUCCESS' && !this.pendingRelay && !this.physics.canRemoveSource(result.sourceCoinId)) {
      if (!this.physics.hasCoin(result.targetCoinId) || !this.physics.releaseSupportingSource(result.sourceCoinId)) {
        this.physics.freeze(); this.facts = null; this.accumulator = 0;
        this.state.phase = 'error'; this.state.error = '接力结算支撑异常，未移除当前币或加分。';
        this.state.revision++; return;
      }
      // Rapier now owns a small natural landing. Keep the original valid target,
      // hold input locked, and defer points/control until the survivor really rests.
      this.pendingRelay = true; this.quietSteps = 0; this.shotSteps = 0;
      this.state.activeCoinId = null; this.state.remaining = this.physics.frame.coins.length;
      this.state.revision++; return;
    }
    const sourceAlreadyRemoved = this.pendingRelay;
    this.facts = null; this.pendingRelay = false; this.accumulator = 0;
    this.state.lastResult = result; this.state.foulReasons = [...result.reasons];
    for (const id of facts.fallenCoinIds) this.physics.removeCoin(id);
    this.state.remaining = this.physics.frame.coins.length;
    if (timedOut && !supported) {
      this.state.phase = 'error'; this.state.error = '模拟超时，存在未获得稳定桌面支撑的硬币。请重建本局。';
      this.state.revision++; return;
    }
    if (result.outcome === 'SUCCESS') {
      if (!this.physics.hasCoin(result.targetCoinId) || (sourceAlreadyRemoved ? !supported : !this.physics.canRemoveSource(result.sourceCoinId))) {
        this.physics.freeze(); this.state.phase = 'error'; this.state.error = '接力结算支撑异常，未移除当前币或加分。';
        this.state.revision++; return;
      }
      if (!sourceAlreadyRemoved) this.physics.removeCoin(result.sourceCoinId);
      this.state.scores[this.state.currentPlayer]++;
      this.state.chain++;
      this.state.activeCoinId = result.targetCoinId;
      this.state.remaining = this.physics.frame.coins.length;
      this.state.phase = this.state.mode === 'battle'
        ? this.state.scores[this.state.currentPlayer] >= BATTLE_WIN_SCORE ? 'complete' : this.state.remaining <= 1 ? 'refilling' : 'ready'
        : this.state.remaining <= 1 ? 'complete' : 'ready';
    } else {
      this.state.chain = 0;
      if (this.state.mode === 'challenge') this.state.phase = 'failed';
      else {
        this.state.currentPlayer = this.state.currentPlayer === 0 ? 1 : 0;
        this.state.activeCoinId = null;
        this.state.canSelectCoin = true;
        this.state.phase = this.state.remaining <= 1 ? 'refilling' : 'selecting';
      }
      if (!this.physics.hasCoin(facts.sourceCoinId)) this.state.activeCoinId = null;
    }
    if (this.state.mode === 'battle' && this.state.phase === 'complete') {
      this.state.winner = this.state.currentPlayer;
    }
    if (timedOut && this.state.mode === 'battle' && (this.state.phase === 'ready' || this.state.phase === 'selecting' || this.state.phase === 'refilling')) this.physics.unfreeze();
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
    this.disposed = true; this.facts = null; this.pendingRelay = false; this.accumulator = 0; this.feedback = []; this.physics.dispose();
    this.state.phase = 'error'; this.state.canSelectCoin = false; this.state.error = '会话已销毁'; this.state.activeCoinId = null; this.state.remaining = 0; this.state.revision++;
  }
}
