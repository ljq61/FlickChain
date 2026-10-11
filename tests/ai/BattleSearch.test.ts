import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { searchBattle, searchOpening, AI_LIMITS } from '../../src/ai/BattleSearch';
import { generateBattle, generateOpening } from '../../src/content/BattleGenerator';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { LevelConfig } from '../../src/types/contracts';
const board = (): LevelConfig => ({ schemaVersion: 1, id: 'ai-replay', name: 'AI replay', lesson: 'Production full shot',
  table: { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' }, obstacles: [], activeCoinId: 'a',
  coins: [{ id: 'a', x: -0.3, z: 0, materialId: 'standard' }, { id: 'b', x: 0, z: 0, materialId: 'standard' },
    { id: 'c', x: 0.32, z: 0.28, materialId: 'iron' }] });
function settle(game: GameSession): void {
  for (let step = 0; game.view.phase === 'simulating' && step < AI_LIMITS.candidateSteps; step++) game.tick(PHYSICS_CONFIG.fixedDt);
}
describe('production snapshot AI search', () => {
  it('returns a replayable scored shot, predicts the final target and leaves the live session untouched', async () => {
    const game = await GameSession.create(board(), 'battle', 1);
    try {
      const before = { frame: game.frame, view: game.view };
      const snapshot = game.exportSnapshot();
      const found = await searchBattle(snapshot);
      expect(found.candidates).toBeGreaterThan(0); expect(found.candidates).toBeLessThanOrEqual(AI_LIMITS.candidates);
      expect(found.successes).toBeGreaterThan(0);
      expect(found.elapsedMs).toBeLessThan(3000);
      expect({ frame: game.frame, view: game.view }).toEqual(before);
      const replay = await GameSession.restore(snapshot);
      try {
        expect(replay.selectCoin(found.shot.coinId)).toBe(true);
        expect(replay.shoot(found.shot.direction, found.shot.power)).toBe(true); settle(replay);
        expect(replay.view.lastResult?.outcome).toBe('SUCCESS');
        const target = replay.frame.coins.find((coin) => coin.id === replay.view.activeCoinId)!;
        expect(target.position.x).toBeCloseTo(found.targetPosition!.x, 6);
        expect(target.position.z).toBeCloseTo(found.targetPosition!.z, 6);
      } finally { replay.dispose(); }
    } finally { game.dispose(); }
  }, 10000);
  it('keeps the relay coin as its only legal source after a scored shot', async () => {
    const game = await GameSession.create(board(), 'battle', 1);
    try {
      game.selectCoin('a'); game.shoot({ x: 1, z: 0 }, 0.45); settle(game);
      expect(game.view.lastResult?.outcome).toBe('SUCCESS');
      expect(game.view.canSelectCoin).toBe(false);
      const result = await searchBattle(game.exportSnapshot(), { candidates: 8 });
      expect(result.shot.coinId).toBe(game.view.activeCoinId);
      expect(game.view.phase).toBe('ready');
      expect(Number.isFinite(result.shot.power)).toBe(true);
    } finally { game.dispose(); }
  });
  it('replays bounded decisions on random mixed-material boards without mutating live worlds', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      let state = seed * 8111;
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
      const game = await GameSession.create(generateBattle(random), 'battle', 1);
      try {
        const before = { frame: game.frame, view: game.view }, snapshot = game.exportSnapshot();
        const found = await searchBattle(snapshot, { candidates: 12 });
        expect(found.candidates).toBeGreaterThan(0);
        expect(found.candidates).toBeLessThanOrEqual(12);
        expect(found.elapsedMs).toBeLessThan(3000);
        expect({ frame: game.frame, view: game.view }).toEqual(before);
        const replay = await GameSession.restore(snapshot);
        try {
          expect(replay.selectCoin(found.shot.coinId)).toBe(true);
          expect(replay.shoot(found.shot.direction, found.shot.power)).toBe(true); settle(replay);
          expect(['selecting', 'ready', 'refilling', 'complete']).toContain(replay.view.phase);
          if (found.successes) expect(replay.view.lastResult?.outcome).toBe('SUCCESS');
        } finally { replay.dispose(); }
      } finally { game.dispose(); }
    }
  }, 15000);
  it('produces a legal bounded fallback when no simulation can finish in a tiny time budget', async () => {
    const game = await GameSession.create(board(), 'battle');
    try {
      const found = await searchBattle(game.exportSnapshot(), { timeMs: 1, candidates: 1 });
      expect(found.candidates).toBeLessThanOrEqual(1);
      expect(game.selectCoin(found.shot.coinId)).toBe(true);
      expect(game.shoot(found.shot.direction, found.shot.power)).toBe(true); settle(game);
      expect(game.view.phase).not.toBe('error');
    } finally { game.dispose(); }
  });
  it.each(['wood', 'marble'] as const)('chooses an opening power that settles safely on %s', async (materialId) => {
    const level = generateOpening({ shape: 'circle', width: 1.6, depth: 1.6, materialId });
    const power = await searchOpening(level);
    const world = await PhysicsWorld.create(level);
    try {
      expect(world.applyShot(level.activeCoinId, { x: 0, z: -1 }, power)).toBe(true);
      let fallen = false;
      for (let step = 0; step < PHYSICS_CONFIG.maxShotSteps; step++) {
        fallen ||= world.step().fallenCoinIds.length > 0;
        if (step > PHYSICS_CONFIG.settledSteps && world.isSettled()) break;
      }
      expect(fallen).toBe(false); expect(world.isSettled()).toBe(true);
      expect(world.frame.coins[0].position.z).toBeLessThan(0.2);
    } finally { world.dispose(); }
  });
});
