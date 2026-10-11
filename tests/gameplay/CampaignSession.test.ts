import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { generateRevival } from '../../src/content/CampaignGenerator';
import type { LevelConfig } from '../../src/types/contracts';

const sessions: GameSession[] = [];
const layout = (coins: [string, number, number][] = [['A', -0.18, 0], ['B', 0.12, 0]]): LevelConfig => ({
  schemaVersion: 1, id: 'round-1', name: 'test', lesson: 'test',
  table: { width: 1.2, depth: 1.6, materialId: 'wood' },
  coins: coins.map(([id, x, z]) => ({ id, x, z, materialId: 'standard' })), activeCoinId: coins[0][0], obstacles: [],
});
async function create(level = layout(), mode: 'challenge' | 'battle' = 'challenge') {
  const game = await GameSession.create(level, mode); sessions.push(game);
  expect(game.selectCoin(level.activeCoinId)).toBe(true); return game;
}
function settle(game: GameSession) {
  for (let i = 0; i < 1200 && game.view.phase === 'simulating'; i++) game.tick(1 / 60);
  expect(game.view.phase).not.toBe('simulating');
}
function continuation(game: GameSession): LevelConfig {
  const frame = game.frame;
  return { ...layout(), id: 'round-2', table: frame.table, obstacles: frame.obstacles,
    activeCoinId: frame.coins[0].id,
    coins: [...frame.coins.map((c) => ({ id: c.id, x: c.position.x, z: c.position.z, materialId: c.materialId })),
      { id: 'new', x: -0.3, z: -0.3, materialId: 'iron' }],
  };
}
afterEach(() => { for (const game of sessions.splice(0)) game.dispose(); });

describe('continuous Challenge with authoritative retained bodies', () => {
  it('continues from the exact survivor pose and scores cumulatively across rounds', async () => {
    const game = await create();
    game.shoot({ x: 1, z: 0 }, 0.42); settle(game);
    expect(game.view.phase).toBe('complete');
    const survivor = game.frame.coins[0];
    const next = continuation(game);
    // Arrange the next target for a real legal second relay on the same body.
    next.coins[1] = { id: 'new', x: survivor.position.x, z: survivor.position.z + 0.15, materialId: 'standard' };
    expect(game.advanceRound(next)).toBe(true);
    expect(game.frame.coins[0]).toEqual(survivor);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: survivor.id, canSelectCoin: false,
      remaining: 2, levelId: 'round-2', scores: [1, 0], chain: 1, shotCount: 1 });
    expect(game.selectCoin('new')).toBe(false);
    expect(game.advanceRound(next)).toBe(false); expect(game.revive(next)).toBe(false);
    game.shoot({ x: 0, z: 1 }, 0.32); settle(game);
    expect(game.view).toMatchObject({ phase: 'complete', scores: [2, 0], chain: 2, shotCount: 2, activeCoinId: 'new' });
    expect(game.lastFallenCoinIds).toEqual([]);
  });
  it('rejects invalid next rounds atomically and refuses relocation or rematerialization of the survivor', async () => {
    const game = await create(); game.shoot({ x: 1, z: 0 }, 0.42); settle(game);
    const frame = game.frame, view = game.view;
    for (const edit of [
      (level: LevelConfig) => { level.coins[0].x += 0.01; },
      (level: LevelConfig) => { level.coins[0].materialId = 'iron'; },
      (level: LevelConfig) => { level.coins[1].x = level.coins[0].x; level.coins[1].z = level.coins[0].z; },
      (level: LevelConfig) => { level.activeCoinId = 'new'; },
      (level: LevelConfig) => { level.table.width = 2; },
      (level: LevelConfig) => { level.coins[1].x = Infinity; },
    ]) {
      const next = continuation(game); edit(next);
      expect(game.advanceRound(next)).toBe(false);
      expect(game.frame).toEqual(frame); expect(game.view).toEqual(view);
    }
    expect(game.advanceRound(continuation(game))).toBe(true);
  });
  it('revives a settled fall with exact retained pose and replacement coins, then opens public selection', async () => {
    const game = await create(layout([['A', 0.5, 0], ['B', -0.35, 0.3], ['C', -0.2, -0.3]]));
    game.shoot({ x: 1, z: 0 }, 1);
    const during = { ...layout(), id: 'replacement' };
    expect(game.revive(during)).toBe(false);
    expect(game.advanceRound(during)).toBe(false);
    settle(game);
    expect(game.view).toMatchObject({ phase: 'failed', remaining: 2 });
    expect(game.lastFallenCoinIds).toEqual(['A']);
    const last = game.lastFallenCoinIds as string[]; last.push('fake'); expect(game.lastFallenCoinIds).toEqual(['A']);
    const survivors = game.frame.coins;
    const next = continuation(game);
    expect(game.revive(next)).toBe(true);
    expect(game.frame.coins.filter((coin) => coin.id !== 'new')).toEqual(survivors);
    expect(game.view).toMatchObject({ phase: 'selecting', canSelectCoin: true, activeCoinId: null,
      remaining: 3, scores: [0, 0], shotCount: 1, foulReasons: [], lastResult: null });
    expect(game.lastFallenCoinIds).toEqual([]); expect(game.drainFeedback()).toEqual([]);
    expect(game.selectCoin('A')).toBe(false);
    expect(game.selectCoin('new')).toBe(true);
    expect(game.shoot({ x: 0, z: -1 }, 0.1)).toBe(true);
    settle(game); expect(game.view.phase).toBe('failed'); expect(game.lastFallenCoinIds).toEqual([]);
  });
  it('revives a miss without adding coins and preserves earned score across a failed relay', async () => {
    const game = await create(layout([['A', -0.22, 0], ['B', 0, 0], ['C', 0.16, 0]]));
    game.shoot({ x: 1, z: 0 }, 0.51); settle(game);
    expect(game.view.scores).toEqual([1, 0]);
    game.shoot({ x: 0, z: -1 }, 0.1); settle(game);
    expect(game.view.phase).toBe('failed');
    const frame = game.frame;
    const next = continuation(game); next.coins.pop();
    game.pause(); expect(game.revive(next)).toBe(false); game.resume();
    expect(game.revive(next)).toBe(true);
    expect(game.frame).toEqual(frame);
    expect(game.view).toMatchObject({ scores: [1, 0], remaining: 2, shotCount: 2, phase: 'selecting' });
    game.dispose(); expect(game.revive(next)).toBe(false); expect(game.advanceRound(next)).toBe(false);
  });
  it('cannot use Challenge continuation APIs during Battle, including settled completion', async () => {
    const game = await create(layout(), 'battle');
    game.shoot({ x: 1, z: 0 }, 0.42); settle(game);
    const next = continuation(game); const frame = game.frame;
    expect(game.advanceRound(next)).toBe(false); expect(game.revive(next)).toBe(false);
    expect(game.frame).toEqual(frame);
  });
  it.each(['toward', 'away'] as const)('handles a revived, already touching neighbor when shooting %s', async (direction) => {
    const config = layout([['A', 0, 0], ['B', 0.0825, 0], ['C', -0.0825, 0]]);
    config.table = { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' };
    config.obstacles = [{ id: 'cup', kind: 'glass', x: 0.2, z: 0, width: 0.14, depth: 0.14 }];
    const game = await create(config);
    game.shoot({ x: 1, z: 0 }, 0.6); settle(game);
    expect(game.view).toMatchObject({ phase: 'failed', scores: [0, 0], foulReasons: ['MULTI_HIT'] });
    const before = game.frame;
    const revived = generateRevival(config, before.coins, 0, () => 0.5);
    expect(game.revive(revived)).toBe(true);
    expect(game.frame).toEqual(before); // Keep the natural resting contact, without separation.
    expect(game.selectCoin('A')).toBe(true);
    const a = before.coins.find((coin) => coin.id === 'A')!.position;
    const c = before.coins.find((coin) => coin.id === 'C')!.position;
    expect(game.shoot(direction === 'toward' ? { x: c.x - a.x, z: c.z - a.z } : { x: 0, z: -1 }, 0.2)).toBe(true);
    settle(game);
    if (direction === 'toward') {
      expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: 'C', remaining: 2, foulReasons: [] });
      expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(false);
      const finalC = game.frame.coins.find((coin) => coin.id === 'C')!.position;
      expect(Math.hypot(finalC.x - c.x, finalC.z - c.z)).toBeGreaterThan(0.01);
    } else {
      expect(game.view).toMatchObject({ phase: 'failed', scores: [0, 0], remaining: 3, foulReasons: ['MISS'] });
      expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(true);
    }
  });

});
