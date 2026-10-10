import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { LevelConfig } from '../../src/types/contracts';
function level(coins: [string, number, number][] = [['A', -0.18, 0], ['B', 0.12, 0]]): LevelConfig {
  return { schemaVersion: 1, id: 'test', name: 'test', lesson: 'test', table: { width: 1.2, depth: 1.6, materialId: 'wood' }, coins: coins.map(([id, x, z]) => ({ id, x, z, materialId: 'standard' })), activeCoinId: 'A', obstacles: [] };
}
const sessions: GameSession[] = [];
async function session(layout = level(), mode: 'challenge' | 'battle' = 'challenge') {
  const game = await GameSession.create(layout, mode);
  const initialCoinId = layout.activeCoinId ?? layout.coins[0]?.id;
  if (game.view.phase === 'selecting' && initialCoinId) expect(game.selectCoin(initialCoinId)).toBe(true);
  sessions.push(game); return game;
}
function finish(game: GameSession) {
  for (let i = 0; i < 1200 && game.view.phase === 'simulating'; i++) game.tick(1 / 60);
  expect(game.view.phase).not.toBe('simulating');
}
afterEach(() => { vi.restoreAllMocks(); for (const game of sessions.splice(0)) game.dispose(); });
describe('production physics and session lifecycle', () => {
  it('owns its level snapshot across async world creation', async () => {
    const layout = level();
    const pending = GameSession.create(layout, 'challenge');
    layout.activeCoinId = 'missing'; layout.id = 'mutated'; layout.coins[0].x = 99;
    const game = await pending; sessions.push(game);
    expect(game.view).toMatchObject({ levelId: 'test', activeCoinId: null, phase: 'selecting' });
    expect(game.selectCoin('A')).toBe(true);
    expect(game.view).toMatchObject({ activeCoinId: 'A', phase: 'ready' });
    expect(game.frame.coins[0].position.x).toBeCloseTo(-0.18, 3);
  });
  it('allows any public coin to be selected before the first shot', async () => {
    const game = await GameSession.create(level(), 'challenge'); sessions.push(game);
    expect(game.view).toMatchObject({ phase: 'selecting', activeCoinId: null });
    expect(game.selectCoin('B')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B' });
    expect(game.selectCoin('A')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'A' });
  });
  it('does not score or delete at first contact; commits final relay once', async () => {
    const game = await session();
    expect(game.shoot({ x: 1, z: 0 }, 0.7)).toBe(true);
    let bMoved = false;
    for (let i = 0; i < 80; i++) {
      game.tick(1 / 120);
      if (Math.abs(game.frame.coins.find((c) => c.id === 'B')!.position.x - 0.12) > 0.005) { bMoved = true; break; }
    }
    expect(bMoved).toBe(true);
    expect(game.view).toMatchObject({ phase: 'simulating', scores: [0, 0], remaining: 2, activeCoinId: 'A' });
    expect(game.shoot({ x: 1, z: 0 }, 0.6)).toBe(false);
    finish(game);
    expect(game.view).toMatchObject({ phase: 'complete', scores: [1, 0], remaining: 1, activeCoinId: 'B', chain: 1 });
    const finalB = game.frame.coins[0].position;
    game.tick(10); expect(game.frame.coins[0].position).toEqual(finalB); expect(game.view.scores).toEqual([1, 0]);
  });
  it('allows B to continue into C after A legally hits B', async () => {
    const game = await session(level([['A', -0.22, 0], ['B', 0, 0], ['C', 0.16, 0]]));
    const cStart = game.frame.coins.find((coin) => coin.id === 'C')!.position;
    game.shoot({ x: 1, z: 0 }, 0.85);
    finish(game);
    expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: 'B', remaining: 2, chain: 1 });
    expect(game.view.foulReasons).toEqual([]);
    expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(false);
    const cFinal = game.frame.coins.find((coin) => coin.id === 'C')!.position;
    expect(Math.hypot(cFinal.x - cStart.x, cFinal.z - cStart.z)).toBeGreaterThan(0.005);
  });
  it('misses fail Challenge and preserve the real moved board for next Battle player', async () => {
    const challenge = await session();
    challenge.shoot({ x: 0, z: 1 }, 0.3); finish(challenge);
    expect(challenge.view).toMatchObject({ phase: 'failed', scores: [0, 0], foulReasons: ['MISS'] });
    const battle = await session(level(), 'battle');
    const start = battle.frame.coins[0].position;
    battle.shoot({ x: 0, z: 1 }, 0.3); finish(battle);
    expect(battle.view).toMatchObject({ phase: 'selecting', currentPlayer: 1, activeCoinId: null, remaining: 2, scores: [0, 0] });
    expect(battle.frame.coins[0].position.z).toBeGreaterThan(start.z + 0.02);
    expect(battle.selectCoin('A')).toBe(true);
    expect(battle.view).toMatchObject({ phase: 'ready', activeCoinId: 'A' });
    expect(battle.selectCoin('B')).toBe(true);
    expect(battle.view).toMatchObject({ phase: 'ready', activeCoinId: 'B' });
  });
  it('a fall reducing Challenge to the last coin is failure, and Battle is a draw', async () => {
    const layout = level([['A', 0.5, 0], ['B', -0.35, 0.3]]);
    const challenge = await session(layout);
    challenge.shoot({ x: 1, z: 0 }, 1); finish(challenge);
    expect(challenge.view).toMatchObject({ phase: 'failed', scores: [0, 0], remaining: 1 });
    expect(challenge.view.foulReasons).toContain('FALL');
    const battle = await session(layout, 'battle');
    battle.shoot({ x: 1, z: 0 }, 1); finish(battle);
    expect(battle.view).toMatchObject({ phase: 'complete', scores: [0, 0], remaining: 1, winner: 'draw' });
  });
  it('a non-source fall after contact invalidates a would-be final relay', async () => {
    const game = await session(level([['A', 0.13, 0], ['B', 0.42, 0]]));
    game.shoot({ x: 1, z: 0 }, 0.8); finish(game);
    expect(game.view.phase).toBe('failed'); expect(game.view.foulReasons).toContain('FALL'); expect(game.view.scores).toEqual([0, 0]);
    expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(true);
  });
  it('Battle selects only remaining public coins after active A falls', async () => {
    const game = await session(level([['A', 0.5, 0], ['B', -0.35, 0.3], ['C', -0.2, -0.3]]), 'battle');
    game.shoot({ x: 1, z: 0 }, 1); finish(game);
    expect(game.view).toMatchObject({ phase: 'selecting', currentPlayer: 1, activeCoinId: null, remaining: 2 });
    expect(game.shoot({ x: 1, z: 0 }, 0.5)).toBe(false);
    expect(game.selectCoin('A')).toBe(false); expect(game.selectCoin('missing')).toBe(false);
    const b = game.frame.coins.find((coin) => coin.id === 'B')!.position;
    expect(game.selectCoin('B')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B', currentPlayer: 1 });
    expect(game.frame.coins.find((coin) => coin.id === 'B')!.position).toEqual(b);
  });
  it('pauses without simulation backlog, rejects malformed input and safely disposes', async () => {
    const game = await session();
    for (const [direction, power] of [[{ x: 0, z: 0 }, 0.5], [{ x: NaN, z: 1 }, 0.5], [{ x: Number.MAX_VALUE, z: Number.MAX_VALUE }, 0.5], [{ x: 1, z: 0 }, Infinity], [{ x: 1, z: 0 }, 1.1], [{ x: 1, z: 0 }, 0.01]] as const) expect(game.shoot(direction, power)).toBe(false);
    expect(game.view.shotCount).toBe(0);
    game.shoot({ x: 1, z: 0 }, 0.6); game.tick(1 / 60); game.pause();
    const frame = game.frame;
    game.tick(100); expect(game.frame).toEqual(frame); expect(game.shoot({ x: 1, z: 0 }, 0.6)).toBe(false);
    game.resume(); game.tick(0); expect(game.frame).toEqual(frame); finish(game);
    const clone = game.view; clone.scores[0] = 999; expect(game.view.scores[0]).toBe(1);
    game.dispose(); game.dispose(); game.pause(); game.resume(); game.tick(1);
    expect(game.frame.coins).toEqual([]); expect(game.shoot({ x: 1, z: 0 }, 0.5)).toBe(false); expect(game.selectCoin('B')).toBe(false);
  });
  it('consumes true coin and wall feedback once, clearing paused and disposed queues', async () => {
    const game = await session();
    expect(game.drainFeedback()).toEqual([]);
    game.shoot({ x: 1, z: 0 }, 0.7);
    let coin = false;
    for (let i = 0; i < 100 && !coin; i++) { game.tick(1 / 120); coin = game.drainFeedback().includes('coin'); }
    expect(coin).toBe(true); expect(game.drainFeedback()).toEqual([]);
    game.tick(1 / 120); expect(game.drainFeedback()).toEqual([]);
    finish(game); expect(game.view.scores).toEqual([1, 0]);

    const layout = level([['A', -0.12, 0], ['B', -0.3, 0.3]]);
    layout.obstacles = [{ id: 'wall', x: 0.16, z: 0, width: 0.006, depth: 0.6 }];
    const wall = await session(layout);
    wall.shoot({ x: 1, z: 0 }, 1);
    let wallHit = false;
    for (let i = 0; i < 100 && !wallHit; i++) { wall.tick(1 / 120); wallHit = wall.drainFeedback().includes('wall'); }
    expect(wallHit).toBe(true); expect(wall.drainFeedback()).toEqual([]);
    wall.tick(1 / 120); expect(wall.drainFeedback()).toEqual([]);
    finish(wall); expect(wall.view.foulReasons).toEqual(['MISS']);

    for (const action of ['pause', 'dispose'] as const) {
      const pending = await session(); pending.shoot({ x: 1, z: 0 }, 0.7);
      for (let i = 0; i < 60; i++) pending.tick(1 / 120);
      pending[action](); expect(pending.drainFeedback()).toEqual([]);
      pending.tick(1); expect(pending.drainFeedback()).toEqual([]);
    }
  });
  it('does not partially commit a relay whose fixed support precheck fails', async () => {
    const game = await session();
    vi.spyOn(PhysicsWorld.prototype, 'canRemoveSource').mockReturnValue(false);
    game.shoot({ x: 1, z: 0 }, 0.7); finish(game);
    expect(game.view).toMatchObject({ phase: 'error', scores: [0, 0], remaining: 2, activeCoinId: 'A' });
    expect(game.frame.coins.map((coin) => coin.id)).toEqual(['A', 'B']);
    expect(game.shoot({ x: 1, z: 0 }, 0.7)).toBe(false);
  });
  it('TIMEOUT freezes, scores zero, and continues Battle only with supported survivors', async () => {
    const game = await session(level(), 'battle');
    // Prevent settlement to exercise the production timeout clock; actual world remains supported.
    vi.spyOn(PhysicsWorld.prototype, 'isSettled').mockReturnValue(false);
    game.shoot({ x: 0, z: 1 }, 0.1);
    for (let i = 0; i < PHYSICS_CONFIG.maxShotSteps; i++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.view).toMatchObject({ phase: 'selecting', scores: [0, 0], currentPlayer: 1, activeCoinId: null });
    expect(game.view.foulReasons).toContain('TIMEOUT');
    expect(game.selectCoin('A')).toBe(true);
    expect(game.shoot({ x: 1, z: 0 }, 0.2)).toBe(true);
  });
  it('TIMEOUT cannot open a new turn for an unsupported frozen survivor', async () => {
    const game = await session(level(), 'battle');
    vi.spyOn(PhysicsWorld.prototype, 'isSettled').mockReturnValue(false);
    vi.spyOn(PhysicsWorld.prototype, 'allSupported').mockReturnValue(false);
    game.shoot({ x: 0, z: 1 }, 0.1);
    for (let i = 0; i < PHYSICS_CONFIG.maxShotSteps; i++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.view).toMatchObject({ phase: 'error', scores: [0, 0], remaining: 2, currentPlayer: 0 });
    expect(game.view.error).toContain('支撑'); expect(game.shoot({ x: 1, z: 0 }, 0.5)).toBe(false);
  });
});
