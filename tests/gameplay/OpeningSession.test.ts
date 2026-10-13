import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpeningSession } from '../../src/core/OpeningSession';
import { GameSession } from '../../src/core/GameSession';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { LevelConfig } from '../../src/types/contracts';

const level = (): LevelConfig => ({ schemaVersion: 1, purpose: 'opening', id: 'opening', name: '先手', lesson: '距离',
  table: { width: 1.2, depth: 1.6, materialId: 'wood' }, coins: [{ id: 'opener', x: 0, z: .64, materialId: 'standard' }], activeCoinId: 'opener', obstacles: [] });
const sessions: OpeningSession[] = [];
async function create(variant: 'pvp' | 'pve' = 'pvp') { const game = await OpeningSession.create(level(), variant); sessions.push(game); return game; }
function finish(game: OpeningSession) {
  for (let i = 0; i < 1000 && game.view.phase === 'simulating'; i++) game.tick(1 / 60);
  expect(game.view.phase).toBe('complete');
  expect(game.view.scores).toEqual([0, 0]); expect(game.view.foulReasons).toEqual([]); expect(game.view.lastResult).toBeNull();
}
afterEach(() => { vi.restoreAllMocks(); sessions.splice(0).forEach((game) => game.dispose()); });
describe('production-physics opening distance comparison', () => {
  it('counts the measured distance when a half-overhanging coin rests on the round table', async () => {
    const config = level(); config.table = { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' };
    const game = await OpeningSession.create(config, 'pvp'); sessions.push(game);
    expect(game.shoot({ x: 0, z: -1 }, .75)).toBe(true);
    finish(game);
    const coin = game.frame.coins[0];
    expect(coin.position.z).toBeLessThan(-.8);
    expect(coin.position.z).toBeGreaterThan(-.835);
    expect(coin.position.y).toBeGreaterThan(0);
    expect(game.view.battle!.fallen[0]).toBe(false);
    expect(game.view.battle!.distances[0]).toBeCloseTo(Math.hypot(coin.position.x, coin.position.z - .64), 5);
    expect((game as unknown as { shotSteps: number }).shotSteps).toBeLessThan(PHYSICS_CONFIG.maxShotSteps);
    expect(await game.advance()).toBe(true);
    expect(game.shoot({ x: 0, z: -1 }, .74)).toBe(true);
    finish(game);
    expect(game.view.battle!.fallen).toEqual([false, false]);
    expect(game.view.battle!.distances[0]!).toBeGreaterThan(game.view.battle!.distances[1]!);
    expect(game.view.winner).toBe(0);
  });
  it('launches both gold coins from the near side toward -Z, then chooses the farther safe contestant', async () => {
    const game = await create(); const initial = game.frame;
    expect(game.view).toMatchObject({ phase: 'ready', canSelectCoin: false, currentPlayer: 0, battle: { stage: 'opening', openingAttempt: 1 } });
    expect(game.shoot({ x: 1, z: 0 }, .3)).toBe(true);
    expect(game.shoot({ x: 0, z: -1 }, .4)).toBe(false);
    finish(game);
    expect(game.frame.coins[0].position.x).toBeCloseTo(0, 6);
    expect(game.frame.coins[0].position.z).toBeLessThan(.64);
    expect(game.view.winner).toBeNull();
    const firstDistance = game.view.battle!.distances[0]!;
    expect(firstDistance).toBeGreaterThan(.05);
    expect(await game.advance()).toBe(true);
    expect(game.frame).toEqual(initial);
    expect(game.view).toMatchObject({ phase: 'ready', currentPlayer: 1 });
    game.shoot({ x: 0, z: -1 }, .5); finish(game);
    expect(game.view.battle!.distances[1]!).toBeGreaterThan(firstDistance);
    expect(game.view).toMatchObject({ winner: 1, battle: { fallen: [false, false] } });
    expect(await game.advance()).toBe(false);
  });
  it.each([0, 1] as const)('contestant %s forfeits when falling even if its measured distance is greater', async (falling) => {
    const game = await create();
    game.shoot({ x: 0, z: -1 }, falling === 0 ? 1 : .3); finish(game); await game.advance();
    game.shoot({ x: 0, z: -1 }, falling === 1 ? 1 : .3); finish(game);
    expect(game.view.battle!.fallen[falling]).toBe(true);
    expect(game.view.battle!.distances[falling]!).toBeGreaterThan(game.view.battle!.distances[falling === 0 ? 1 : 0]!);
    expect(game.view.winner).toBe(falling === 0 ? 1 : 0);
  });
  it.each([.3, 1])('replays a complete paired opening when both outcomes are equal at power %s', async (power) => {
    const game = await create();
    for (let player = 0; player < 2; player++) {
      expect(game.view.currentPlayer).toBe(player); game.shoot({ x: 0, z: -1 }, power); finish(game);
      if (player === 0) expect(await game.advance()).toBe(true);
    }
    expect(game.view.winner).toBeNull();
    expect(await game.advance()).toBe(true);
    expect(game.view).toMatchObject({ currentPlayer: 0, phase: 'ready', battle: { openingAttempt: 2, distances: [null, null], fallen: [false, false] } });
    expect(game.frame.coins[0].position.z).toBeCloseTo(.64, 6);
  });
  it('keeps simulation frozen during pause and assigns the PVE second launch to the computer', async () => {
    const game = await create('pve');
    game.shoot({ x: 0, z: -1 }, .3); game.tick(1 / 60); game.pause();
    const frame = game.frame;
    game.tick(30); expect(game.frame).toEqual(frame);
    expect(game.shoot({ x: 0, z: -1 }, .3)).toBe(false); expect(await game.advance()).toBe(false);
    game.resume(); finish(game); await game.advance();
    expect(game.view).toMatchObject({ currentPlayer: 1, inputOwner: 'computer', phase: 'ready' });
  });
  it('treats timeout as a forfeited opening, without scoring a MISS', async () => {
    const game = await create();
    vi.spyOn(PhysicsWorld.prototype, 'isSettled').mockReturnValue(false);
    vi.spyOn(PhysicsWorld.prototype, 'isCoinRestingOnTable').mockReturnValue(false);
    game.shoot({ x: 0, z: -1 }, .3);
    for (let step = 0; step < PHYSICS_CONFIG.maxShotSteps; step++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.view).toMatchObject({ phase: 'complete', scores: [0, 0], foulReasons: [], battle: { fallen: [true, false] } });
  });
  it('rejects malformed shots and strict opening level variants', async () => {
    const game = await create();
    for (const [direction, power] of [[{ x: NaN, z: 1 }, .3], [{ x: 0, z: 0 }, .3], [{ x: 0, z: -1 }, 1.1], [{ x: 0, z: -1 }, .01]] as const) expect(game.shoot(direction, power)).toBe(false);
    expect(game.view.shotCount).toBe(0);
    await expect(GameSession.create(level(), 'battle')).rejects.toThrow('先手');
    const iron = level(); iron.coins[0].materialId = 'iron';
    await expect(OpeningSession.create(iron, 'pvp')).rejects.toThrow('金币');
    const obstacle = level(); obstacle.obstacles.push({ id: 'glass', kind: 'glass', x: .2, z: 0, width: .12, depth: .12 });
    await expect(OpeningSession.create(obstacle, 'pvp')).rejects.toThrow('障碍');
    const ordinary = level(); delete ordinary.purpose;
    await expect(PhysicsWorld.create(ordinary)).rejects.toThrow('两枚');
  });
  it('prevents overlapping advances and never resurrects a disposed session during async creation', async () => {
    const game = await create(); game.shoot({ x: 0, z: -1 }, .3); finish(game);
    const advancing = game.advance();
    expect(await game.advance()).toBe(false);
    game.dispose(); expect(await advancing).toBe(false);
    expect(game.frame.coins).toEqual([]); expect(game.view.phase).toBe('error');
  });
  it('keeps the next contestant paused when a settings pause races an asynchronous advance', async () => {
    const game = await create(); game.shoot({ x: 0, z: -1 }, .3); finish(game);
    const advancing = game.advance(); game.pause();
    expect(await advancing).toBe(true);
    expect(game.view).toMatchObject({ phase: 'paused', currentPlayer: 1 });
    const frame = game.frame; game.tick(30); expect(game.frame).toEqual(frame);
    expect(game.shoot({ x: 0, z: -1 }, .3)).toBe(false);
    game.resume(); expect(game.view.phase).toBe('ready');
    expect(game.shoot({ x: 0, z: -1 }, .3)).toBe(true);
  });
});
