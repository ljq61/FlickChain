import { GameSession, type SessionSnapshot } from '../core/GameSession';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { coinRadius, MATERIALS, PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { tableClearance } from '../physics/TableGeometry';
import type { CoinTransform, Direction, LevelConfig, WorldFrame } from '../types/contracts';
import { obstacleDistance } from '../content/LevelValidator';

export interface AiShot { coinId: string; direction: Direction; power: number }
export const AI_LIMITS = Object.freeze({ timeMs: 1800, candidates: 48, candidateSteps: PHYSICS_CONFIG.maxShotSteps * 2 + 4 });
export interface SearchEvidence { shot: AiShot; candidates: number; successes: number; elapsedMs: number; targetPosition: { x: number; z: number } | null }
type SearchOptions = { timeMs?: number; candidates?: number };
type Pair = { source: CoinTransform; target: CoinTransform; direction: Direction; distance: number; rank: number };
function bounded(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.min(fallback, Math.floor(value)));
}
function pairs(frame: WorldFrame, sources: CoinTransform[]): Pair[] {
  const result: Pair[] = [];
  for (const source of sources) for (const target of frame.coins) {
    if (source.id === target.id) continue;
    const x = target.position.x - source.position.x, z = target.position.z - source.position.z;
    const distance = Math.hypot(x, z);
    if (distance < PHYSICS_CONFIG.minDirectionLength) continue;
    const direction = { x: x / distance, z: z / distance };
    let blocked = 0;
    // Geometry only orders candidates. It never determines a hit or its outcome.
    for (let step = 1; step < 10; step++) {
      const px = source.position.x + x * step / 10, pz = source.position.z + z * step / 10;
      if (frame.obstacles.some((obstacle) => obstacleDistance(obstacle, px, pz) < coinRadius(source.materialId))) blocked = 1;
    }
    result.push({ source, target, direction, distance, rank: distance + blocked * 2 });
  }
  return result.sort((a, b) => a.rank - b.rank || a.source.id.localeCompare(b.source.id) || a.target.id.localeCompare(b.target.id));
}
function candidates(frame: WorldFrame, sources: CoinTransform[], limit: number): AiShot[] {
  const ordered = pairs(frame, sources);
  const result: AiShot[] = [];
  // Cover several public source/target pairs before revisiting angle and power variants.
  const pairCount = Math.min(ordered.length, Math.max(1, Math.floor(limit / 4)));
  const variations = [{ scale: 1.1, angle: 0 }, { scale: 1.25, angle: 0 }, { scale: 1.1, angle: 0.025 },
    { scale: 1.1, angle: -0.025 }, { scale: 1.4, angle: 0 }];
  for (const variation of variations) for (const pair of ordered.slice(0, pairCount)) {
    const material = MATERIALS[pair.source.materialId];
    const friction = (material.friction + MATERIALS[frame.table.materialId].friction) / 2;
    const travel = Math.max(0.012, pair.distance - coinRadius(pair.source.materialId) - coinRadius(pair.target.materialId) + 0.018);
    // A launch heuristic supplies powers; production Rapier below judges every candidate.
    const velocity = Math.sqrt(2 * Math.abs(PHYSICS_CONFIG.gravity) * friction * travel);
    const ideal = (velocity * material.mass / PHYSICS_CONFIG.maxImpulse) ** (1 / PHYSICS_CONFIG.powerExponent);
    const c = Math.cos(variation.angle), s = Math.sin(variation.angle);
    result.push({ coinId: pair.source.id, direction: { x: pair.direction.x * c - pair.direction.z * s, z: pair.direction.x * s + pair.direction.z * c },
      power: Math.max(PHYSICS_CONFIG.minPower, Math.min(1, ideal * variation.scale)) });
    if (result.length >= limit) return result;
  }
  return result;
}
/** Snapshot clones use the same WASM, material registry, fixed steps and full-shot resolver as live play. */
export async function searchBattle(snapshot: SessionSnapshot, options: SearchOptions = {}): Promise<SearchEvidence> {
  const started = performance.now(), budget = bounded(options.timeMs, AI_LIMITS.timeMs);
  const baseline = await GameSession.restore(snapshot);
  let shots: AiShot[], fallback: AiShot, player: 0 | 1;
  try {
    const view = baseline.view, frame = baseline.frame;
    if (view.mode !== 'battle' || (view.phase !== 'selecting' && view.phase !== 'ready')) throw new Error('电脑只能从已结算对战状态思考');
    player = view.currentPlayer;
    const sources = view.canSelectCoin ? frame.coins : frame.coins.filter((coin) => coin.id === view.activeCoinId);
    if (!sources.length) throw new Error('电脑没有合法的当前硬币');
    const source = sources[0];
    const distance = Math.hypot(source.position.x, source.position.z);
    fallback = { coinId: source.id, direction: distance > 1e-6 ? { x: -source.position.x / distance, z: -source.position.z / distance } : { x: 0, z: -1 }, power: PHYSICS_CONFIG.minPower };
    shots = candidates(frame, sources, bounded(options.candidates, AI_LIMITS.candidates));
  } finally { baseline.dispose(); }
  let best = fallback, bestScore = -Infinity, completed = 0, successes = 0;
  let targetPosition: SearchEvidence['targetPosition'] = null;
  for (const shot of shots) {
    if (performance.now() - started >= budget) break;
    const clone = await GameSession.restore(snapshot);
    try {
      if (clone.view.canSelectCoin && !clone.selectCoin(shot.coinId)) continue;
      if (clone.view.activeCoinId !== shot.coinId || !clone.shoot(shot.direction, shot.power)) continue;
      let steps = 0;
      while (clone.view.phase === 'simulating' && steps++ < AI_LIMITS.candidateSteps) {
        clone.tick(PHYSICS_CONFIG.fixedDt);
        if (steps % 24 === 0 && performance.now() - started >= budget) break;
      }
      const view = clone.view;
      // A partial/timed-out search candidate never masquerades as a successful settled shot.
      if (view.phase === 'simulating' || view.phase === 'error') continue;
      completed++;
      const success = view.lastResult?.outcome === 'SUCCESS';
      if (success) successes++;
      const target = success ? clone.frame.coins.find((coin) => coin.id === view.activeCoinId) : undefined;
      const clearance = target ? tableClearance(clone.frame.table, target.position.x, target.position.z) : 0;
      // Prefer scored shots, then a safe final target and nearby next targets. No future random layout is known.
      const nextDistance = target ? Math.min(...clone.frame.coins.filter((coin) => coin.id !== target.id)
        .map((coin) => Math.hypot(coin.position.x - target.position.x, coin.position.z - target.position.z)), 1) : 1;
      const score = (view.winner === player ? 1000 : 0) + (success ? 100 : 0) + clearance * 8 - nextDistance
        - (view.foulReasons.includes('FALL') ? 20 : 0) - (view.foulReasons.includes('TIMEOUT') ? 30 : 0) - shot.power * 0.1;
      if (score > bestScore) { bestScore = score; best = shot; targetPosition = target ? { x: target.position.x, z: target.position.z } : null; }
    } finally { clone.dispose(); }
  }
  return { shot: best, candidates: completed, successes, elapsedMs: performance.now() - started, targetPosition };
}
/** Opening uses an empty production world; a miss is not a foul in the distance comparison. */
export async function searchOpening(level: LevelConfig): Promise<number> {
  if (level.purpose !== 'opening') throw new Error('先手思考需要专用空桌面');
  const started = performance.now();
  let bestPower = 0.45, bestDistance = -Infinity;
  // Moderate opponent aims well without a perfect edge shot on every run.
  const powers = [0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
  for (const power of powers) {
    if (performance.now() - started >= AI_LIMITS.timeMs) break;
    const world = await PhysicsWorld.create(level);
    try {
      if (!world.applyShot(level.activeCoinId, { x: 0, z: -1 }, power)) continue;
      let quiet = 0, fallen = false, settled = false;
      for (let step = 0; step < PHYSICS_CONFIG.maxShotSteps; step++) {
        const events = world.step();
        fallen ||= events.fallenCoinIds.length > 0;
        quiet = world.isSettled() ? quiet + 1 : 0;
        if (quiet >= PHYSICS_CONFIG.settledSteps) { settled = true; break; }
        if (step % 24 === 0 && performance.now() - started >= AI_LIMITS.timeMs) break;
      }
      const position = world.frame.coins[0]?.position;
      if (!fallen && settled && position && tableClearance(level.table, position.x, position.z) > 0.07) {
        const distance = Math.hypot(position.x - level.coins[0].x, position.z - level.coins[0].z);
        if (distance > bestDistance) { bestDistance = distance; bestPower = power; }
      }
    } finally { world.dispose(); }
  }
  return Math.max(PHYSICS_CONFIG.minPower, bestPower - Math.random() * 0.025);
}
