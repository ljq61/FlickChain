import type { BattleVariant, Direction, GamePhase, GameView, LevelConfig, WorldFrame } from '../types/contracts';
import { PhysicsWorld, type PhysicsFeedback } from '../physics/PhysicsWorld';
import { PHYSICS_CONFIG } from '../physics/MaterialRegistry';

const START = Object.freeze({ x: 0, z: .64 });
const TIE_TOLERANCE = .001;
let sequence = 0;

/** Two isolated production shots decide the opener, with no scoring or MISS. */
export class OpeningSession {
  private disposed = false;
  private generation = 0;
  private advancing = false;
  private accumulator = 0;
  private shotSteps = 0;
  private quietSteps = 0;
  private fell = false;
  private feedback: PhysicsFeedback[] = [];
  private pausedPhase: GamePhase | null = null;
  private readonly state: GameView;
  private constructor(private physics: PhysicsWorld, private readonly config: LevelConfig, variant: BattleVariant) {
    this.state = {
      sessionId: `opening-${++sequence}`, revision: 0, mode: 'battle', phase: 'ready', levelId: config.id,
      activeCoinId: config.activeCoinId, canSelectCoin: false, currentPlayer: 0, scores: [0, 0], remaining: 1,
      chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null,
      battle: { variant, stage: 'opening', distances: [null, null], fallen: [false, false], openingAttempt: 1 },
      inputOwner: 'human',
      battleWinScore: 10,
    };
  }
  static async create(input: LevelConfig, variant: BattleVariant): Promise<OpeningSession> {
    if (variant !== 'pvp' && variant !== 'pve') throw new Error('无效对战类型');
    if (input.purpose !== 'opening') throw new Error('先手会话必须使用先手专用关卡');
    PhysicsWorld.validate(input);
    const level = structuredClone(input);
    level.coins[0].x = START.x; level.coins[0].z = START.z;
    const physics = await PhysicsWorld.create(level);
    return new OpeningSession(physics, level, variant);
  }
  get view(): GameView { return structuredClone(this.state); }
  get frame(): WorldFrame { return this.physics.frame; }
  get level(): LevelConfig { return structuredClone(this.config); }
  shoot(direction: Direction, power: number): boolean {
    if (this.disposed || this.advancing || this.state.phase !== 'ready'
      || !direction || ![direction.x, direction.z].every(Number.isFinite)
      || !Number.isFinite(Math.hypot(direction.x, direction.z))
      || Math.hypot(direction.x, direction.z) < PHYSICS_CONFIG.minDirectionLength) return false;
    // Both competitors launch toward the far side from the same near-side spot.
    if (!this.physics.applyShot(this.config.activeCoinId, { x: 0, z: -1 }, power)) return false;
    this.accumulator = 0; this.shotSteps = 0; this.quietSteps = 0; this.fell = false; this.feedback = [];
    this.state.phase = 'simulating'; this.state.shotCount++; this.state.revision++;
    return true;
  }
  tick(seconds: number): void {
    if (this.disposed || this.state.phase !== 'simulating' || !Number.isFinite(seconds) || seconds <= 0) return;
    this.accumulator = Math.min(this.accumulator + Math.min(seconds, PHYSICS_CONFIG.maxFrameSeconds), PHYSICS_CONFIG.fixedDt * PHYSICS_CONFIG.maxStepsPerFrame);
    try {
      while (this.accumulator + 1e-12 >= PHYSICS_CONFIG.fixedDt && this.state.phase === 'simulating') {
        this.accumulator -= PHYSICS_CONFIG.fixedDt;
        const events = this.physics.step();
        this.feedback.push(...events.feedback);
        if (this.feedback.length > 64) this.feedback.splice(0, this.feedback.length - 64);
        this.fell ||= events.fallenCoinIds.length > 0;
        this.shotSteps++;
        this.quietSteps = this.physics.isSettled() ? this.quietSteps + 1 : 0;
        if (this.quietSteps >= PHYSICS_CONFIG.settledSteps) this.settle(false);
        else if (this.shotSteps >= PHYSICS_CONFIG.maxShotSteps) this.settle(true);
      }
    } catch (error) {
      this.physics.freeze(); this.accumulator = 0;
      this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.state.revision++;
    }
  }
  private settle(timedOut: boolean): void {
    const battle = this.state.battle!;
    const player = this.state.currentPlayer;
    const coin = this.frame.coins[0];
    this.physics.freeze(); this.accumulator = 0;
    battle.distances[player] = coin ? Math.hypot(coin.position.x - START.x, coin.position.z - START.z) : 0;
    battle.fallen[player] = this.fell || timedOut;
    this.state.phase = 'complete'; this.state.activeCoinId = null;
    if (player === 1) {
      if (battle.fallen[0] !== battle.fallen[1]) this.state.winner = battle.fallen[0] ? 1 : 0;
      else if (!battle.fallen[0] && Math.abs(battle.distances[0]! - battle.distances[1]!) > TIE_TOLERANCE) {
        this.state.winner = battle.distances[0]! > battle.distances[1]! ? 0 : 1;
      }
    }
    this.state.revision++;
  }
  /** First shot -> second contestant; equal/both-fallen -> a fresh paired retry. */
  async advance(): Promise<boolean> {
    if (this.disposed || this.advancing || this.state.phase !== 'complete' || this.state.winner !== null) return false;
    this.advancing = true;
    const generation = ++this.generation;
    try {
      const next = await PhysicsWorld.create(this.config);
      if (this.disposed || generation !== this.generation) { next.dispose(); return false; }
      const player = this.state.currentPlayer;
      this.physics.dispose(); this.physics = next;
      const nextPhase = 'ready';
      if (player === 1) {
        this.state.battle!.distances = [null, null]; this.state.battle!.fallen = [false, false];
        this.state.battle!.openingAttempt++;
      }
      this.state.currentPlayer = player === 0 ? 1 : 0;
      this.state.inputOwner = this.state.battle!.variant === 'pve' && this.state.currentPlayer === 1 ? 'computer' : 'human';
      if (this.pausedPhase !== null) this.pausedPhase = nextPhase;
      else this.state.phase = nextPhase;
      this.state.activeCoinId = this.config.activeCoinId; this.accumulator = 0; this.feedback = [];
      this.fell = false; this.shotSteps = 0; this.quietSteps = 0; this.state.revision++;
      return true;
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.state.revision++;
      }
      return false;
    } finally { this.advancing = false; }
  }
  drainFeedback(): PhysicsFeedback[] { const feedback = this.feedback; this.feedback = []; return feedback; }
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
    this.disposed = true; this.generation++; this.physics.dispose(); this.feedback = []; this.accumulator = 0;
    this.state.phase = 'error'; this.state.activeCoinId = null; this.state.remaining = 0;
    this.state.error = '会话已销毁'; this.state.revision++;
  }
}
