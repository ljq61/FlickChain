import { createHash } from 'node:crypto';
import { GameSession } from '../../src/core/GameSession';
import { COIN_RADIUS, COIN_THICKNESS, MATERIALS, PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { Direction, LevelConfig } from '../../src/types/contracts';

export interface ReplayShot { sourceCoinId: string; targetCoinId: string; direction: Direction; power: number }
export interface LevelSolution {
  levelId: string;
  schemaVersion: 1;
  configVersion: string;
  configFingerprint: string;
  shots: ReplayShot[];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function fingerprint(level: LevelConfig): string {
  return createHash('sha256').update(canonical({ level, physics: PHYSICS_CONFIG, materials: MATERIALS, COIN_RADIUS, COIN_THICKNESS })).digest('hex');
}
export function finishShot(session: GameSession): void {
  let frames = 0;
  while (session.view.phase === 'simulating' && frames++ < 1000) session.tick(1 / 60);
  if (session.view.phase === 'simulating') throw new Error('Shot exceeded the production step budget');
}
export async function replayPrefix(level: LevelConfig, shots: ReplayShot[]): Promise<GameSession> {
  const session = await GameSession.create(level, 'challenge');
  try {
    if (session.view.phase === 'selecting') {
      const initialCoinId = shots[0]?.sourceCoinId ?? level.activeCoinId ?? level.coins[0]?.id;
      if (!initialCoinId || !session.selectCoin(initialCoinId)) throw new Error('Replay initial selection rejected');
    }
    for (const shot of shots) {
      if (session.view.activeCoinId !== shot.sourceCoinId || !session.shoot(shot.direction, shot.power)) throw new Error('Replay input rejected');
      finishShot(session);
      const result = session.view.lastResult;
      if (result?.outcome !== 'SUCCESS' || result.targetCoinId !== shot.targetCoinId) throw new Error(`Replay failed: ${JSON.stringify(session.view)}`);
    }
    return session;
  } catch (error) { session.dispose(); throw error; }
}

/** Offline bounded search; each branch reconstructs from production input replay. */
export async function discoverSolution(level: LevelConfig): Promise<{ solution: LevelSolution; candidates: number }> {
  let candidates = 0;
  const powers = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
  const angles = [0, -0.025, 0.025, -0.05, 0.05];
  async function search(prefix: ReplayShot[]): Promise<ReplayShot[] | null> {
    const snapshot = await replayPrefix(level, prefix);
    const view = snapshot.view, frame = snapshot.frame;
    snapshot.dispose();
    if (view.phase === 'complete') return prefix;
    const source = frame.coins.find((coin) => coin.id === view.activeCoinId)!;
    for (const target of frame.coins.filter((coin) => coin.id !== source.id)) {
      const base = Math.atan2(target.position.z - source.position.z, target.position.x - source.position.x);
      for (const angle of angles) for (const power of powers) {
        if (++candidates > 500) throw new Error(`${level.id}: search budget exhausted`);
        const shot: ReplayShot = { sourceCoinId: source.id, targetCoinId: target.id,
          direction: { x: Math.cos(base + angle), z: Math.sin(base + angle) }, power };
        const candidate = await replayPrefix(level, prefix);
        let success = false;
        try {
          if (candidate.shoot(shot.direction, shot.power)) {
            finishShot(candidate);
            success = candidate.view.lastResult?.outcome === 'SUCCESS' && candidate.view.lastResult.targetCoinId === target.id;
          }
        } finally { candidate.dispose(); }
        if (success) {
          const result = await search([...prefix, shot]);
          if (result) return result;
        }
      }
    }
    return null;
  }
  const shots = await search([]);
  if (!shots) throw new Error(`${level.id}: no complete solution found`);
  return { solution: { levelId: level.id, schemaVersion: 1, configVersion: PHYSICS_CONFIG.version, configFingerprint: fingerprint(level), shots }, candidates };
}
