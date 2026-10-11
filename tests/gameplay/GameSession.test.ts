import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type RAPIER from '@dimforge/rapier3d-compat';
import { COIN_THICKNESS, PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
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
  it.each(['challenge', 'battle'] as const)('allows repeated public coin selection before the first %s shot', async (mode) => {
    const game = await GameSession.create(level(), mode); sessions.push(game);
    const board = game.frame;
    expect(game.view).toMatchObject({ phase: 'selecting', activeCoinId: null, canSelectCoin: true });
    const initial = game.view;
    expect(game.selectCoin('missing')).toBe(false);
    expect(game.view).toEqual(initial);
    expect(game.selectCoin('B')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B', canSelectCoin: true });
    expect(game.selectCoin('A')).toBe(true);
    expect(game.selectCoin('B')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B', scores: [0, 0], shotCount: 0, revision: initial.revision + 3 });
    expect(game.frame).toEqual(board);
    expect(game.shoot({ x: -1, z: 0 }, 0.42)).toBe(true);
    expect(game.view).toMatchObject({ phase: 'simulating', activeCoinId: 'B', canSelectCoin: false });
    expect(game.selectCoin('A')).toBe(false);
  });
  it('does not score or delete at first contact; commits final relay once', async () => {
    const game = await session();
    expect(game.shoot({ x: 1, z: 0 }, 0.42)).toBe(true);
    let bMoved = false;
    for (let i = 0; i < 80; i++) {
      game.tick(1 / 120);
      if (Math.abs(game.frame.coins.find((c) => c.id === 'B')!.position.x - 0.12) > 0.005) { bMoved = true; break; }
    }
    expect(bMoved).toBe(true);
    expect(game.view).toMatchObject({ phase: 'simulating', scores: [0, 0], remaining: 2, activeCoinId: 'A' });
    expect(game.shoot({ x: 1, z: 0 }, 0.6)).toBe(false);
    finish(game);
    expect(game.view).toMatchObject({ phase: 'complete', scores: [1, 0], remaining: 1, activeCoinId: 'B', chain: 1, canSelectCoin: false });
    expect(game.selectCoin('B')).toBe(false);
    const finalB = game.frame.coins[0].position;
    game.tick(10); expect(game.frame.coins[0].position).toEqual(finalB); expect(game.view.scores).toEqual([1, 0]);
  });
  it('preserves free starting selection across pause and resume when player 2 starts Battle', async () => {
    const game = await GameSession.create(level(), 'battle', 1); sessions.push(game);
    game.pause();
    expect(game.selectCoin('B')).toBe(false);
    expect(game.shoot({ x: 1, z: 0 }, 0.5)).toBe(false);
    game.resume();
    expect(game.selectCoin('B')).toBe(true);
    game.pause();
    expect(game.selectCoin('A')).toBe(false);
    game.resume();
    expect(game.selectCoin('A')).toBe(true);
    expect(game.view).toMatchObject({ phase: 'ready', currentPlayer: 1, activeCoinId: 'A', canSelectCoin: true, shotCount: 0 });
  });
  it.each(['challenge', 'battle'] as const)('locks %s continuation to B after A legally hits B', async (mode) => {
    const game = await session(level([['A', -0.22, 0], ['B', 0, 0], ['C', 0.16, 0]]), mode);
    const cStart = game.frame.coins.find((coin) => coin.id === 'C')!.position;
    game.shoot({ x: 1, z: 0 }, 0.51);
    finish(game);
    expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: 'B', remaining: 2, chain: 1, canSelectCoin: false });
    expect(game.view.foulReasons).toEqual([]);
    // Relay continuation fixes control to the hit coin: no re-picking while the run continues.
    expect(game.selectCoin('C')).toBe(false);
    game.pause(); expect(game.selectCoin('C')).toBe(false); game.resume();
    expect(game.selectCoin('C')).toBe(false);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B' });
    expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(false);
    const cFinal = game.frame.coins.find((coin) => coin.id === 'C')!.position;
    expect(Math.hypot(cFinal.x - cStart.x, cFinal.z - cStart.z)).toBeGreaterThan(0.005);
  });
  it('misses fail Challenge and preserve the real moved board for next Battle player', async () => {
    const challenge = await session();
    challenge.shoot({ x: 0, z: 1 }, 0.3); finish(challenge);
    expect(challenge.view).toMatchObject({ phase: 'failed', scores: [0, 0], foulReasons: ['MISS'] });
    expect(challenge.selectCoin('B')).toBe(false);
    const battle = await session(level(), 'battle');
    const start = battle.frame.coins[0].position;
    battle.shoot({ x: 0, z: 1 }, 0.3); finish(battle);
    expect(battle.view).toMatchObject({ phase: 'selecting', currentPlayer: 1, activeCoinId: null, remaining: 2, scores: [0, 0], canSelectCoin: true });
    expect(battle.frame.coins[0].position.z).toBeGreaterThan(start.z + 0.02);
    expect(battle.selectCoin('A')).toBe(true);
    expect(battle.view).toMatchObject({ phase: 'ready', activeCoinId: 'A' });
    expect(battle.selectCoin('B')).toBe(true);
    expect(battle.selectCoin('A')).toBe(true);
    expect(battle.view).toMatchObject({ phase: 'ready', activeCoinId: 'A', canSelectCoin: true });
    battle.shoot({ x: 0, z: 1 }, 0.1); finish(battle);
    expect(battle.view).toMatchObject({ phase: 'selecting', currentPlayer: 0, canSelectCoin: true });
    expect(battle.selectCoin('B')).toBe(true);
    expect(battle.selectCoin('A')).toBe(true);
  });
  it('a fall reducing Challenge to the last coin fails, and Battle refills after swapping player', async () => {
    const layout = level([['A', 0.5, 0], ['B', -0.35, 0.3]]);
    const challenge = await session(layout);
    challenge.shoot({ x: 1, z: 0 }, 1); finish(challenge);
    expect(challenge.view).toMatchObject({ phase: 'failed', scores: [0, 0], remaining: 1 });
    expect(challenge.view.foulReasons).toContain('FALL');
    const battle = await session(layout, 'battle');
    battle.shoot({ x: 1, z: 0 }, 1); finish(battle);
    expect(battle.view).toMatchObject({ phase: 'refilling', scores: [0, 0], remaining: 1, winner: null, currentPlayer: 1, canSelectCoin: true });
  });
  it('a non-source fall after contact invalidates a would-be final relay', async () => {
    const game = await session(level([['A', 0.13, 0], ['B', 0.42, 0]]));
    game.shoot({ x: 1, z: 0 }, 0.55); finish(game);
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
    expect(game.view.canSelectCoin).toBe(true);
    expect(game.selectCoin('B')).toBe(true);
    expect(game.selectCoin('A')).toBe(true);
    game.shoot({ x: 1, z: 0 }, 0.36); game.tick(1 / 60); game.pause();
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
    game.shoot({ x: 1, z: 0 }, 0.42);
    let coin = false;
    for (let i = 0; i < 100 && !coin; i++) { game.tick(1 / 120); coin = game.drainFeedback().includes('coin'); }
    expect(coin).toBe(true); expect(game.drainFeedback()).toEqual([]);
    game.tick(1 / 120); expect(game.drainFeedback()).toEqual([]);
    finish(game); expect(game.view.scores).toEqual([1, 0]);

    const layout = level([['A', -0.12, 0], ['B', -0.3, 0.3]]);
    layout.obstacles = [{ id: 'wall', x: 0.16, z: 0, width: 0.006, depth: 0.6 }];
    const wall = await session(layout);
    wall.shoot({ x: 1, z: 0 }, 0.6);
    let wallHit = false;
    for (let i = 0; i < 100 && !wallHit; i++) { wall.tick(1 / 120); wallHit = wall.drainFeedback().includes('wall'); }
    expect(wallHit).toBe(true); expect(wall.drainFeedback()).toEqual([]);
    wall.tick(1 / 120); expect(wall.drainFeedback()).toEqual([]);
    finish(wall); expect(wall.view.foulReasons).toEqual(['MISS']);

    for (const action of ['pause', 'dispose'] as const) {
      const pending = await session(); pending.shoot({ x: 1, z: 0 }, 0.42);
      for (let i = 0; i < 60; i++) pending.tick(1 / 120);
      pending[action](); expect(pending.drainFeedback()).toEqual([]);
      pending.tick(1); expect(pending.drainFeedback()).toEqual([]);
    }
  });
  it('commits a legal real-contact shot when A rests stacked on B, and B can continue', async () => {
    const game = await session(level([['A', -.22, 0], ['B', 0, 0], ['C', -.35, .4]]));
    const physics = (game as unknown as { physics: PhysicsWorld }).physics;
    const bindings = (physics as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
    expect(game.shoot({ x: 1, z: 0 }, .6)).toBe(true);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      game.tick(PHYSICS_CONFIG.fixedDt);
      hit = game.drainFeedback().includes('coin');
    }
    expect(hit).toBe(true);
    expect(game.view).toMatchObject({ phase: 'simulating', scores: [0, 0], remaining: 3 });
    // Reconstruct the observed stacked end pose in the production Rapier bodies,
    // after an actual source hit. No contact or settlement method is mocked.
    const a = bindings.get('A')!.body, b = bindings.get('B')!.body;
    const bp = b.translation();
    a.setTranslation({ x: bp.x, y: bp.y + COIN_THICKNESS + .002, z: bp.z }, true);
    a.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    for (const body of [a, b]) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const remove = physics.removeCoin.bind(physics);
    let beforeRemoval: typeof game.frame.coins = [];
    vi.spyOn(physics, 'removeCoin').mockImplementation((id) => {
      beforeRemoval = structuredClone(game.frame.coins.filter((coin) => coin.id !== id));
      remove(id);
    });
    finish(game);
    expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: 'B', chain: 1, remaining: 2 });
    expect(game.view.foulReasons).toEqual([]);
    expect(game.frame.coins.find((coin) => coin.id === 'A')).toBeUndefined();
    expect(game.frame.coins).toEqual(beforeRemoval);
    expect(game.selectCoin('C')).toBe(false);
    const retainedB = structuredClone(game.frame.coins.find((coin) => coin.id === 'B')!);
    game.tick(1); expect(game.frame.coins.find((coin) => coin.id === 'B')).toEqual(retainedB);
    expect(game.shoot({ x: -1, z: 0 }, .2)).toBe(true);
    game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.frame.coins.find((coin) => coin.id === 'B')!.position.x).toBeLessThan(retainedB.position.x);
  });
  it.each(['challenge', 'battle'] as const)('lands B safely before committing a relay when source A supports it in %s', async (mode) => {
    const game = await session(level([['A', -.22, 0], ['B', 0, 0], ['C', -.35, .4]]), mode);
    const physics = (game as unknown as { physics: PhysicsWorld }).physics;
    const bindings = (physics as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
    game.shoot({ x: 1, z: 0 }, .6);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) { game.tick(PHYSICS_CONFIG.fixedDt); hit = game.drainFeedback().includes('coin'); }
    expect(hit).toBe(true);
    const a = bindings.get('A')!.body, b = bindings.get('B')!.body;
    const ap = a.translation();
    b.setTranslation({ x: ap.x, y: ap.y + COIN_THICKNESS + .002, z: ap.z }, true);
    for (const body of [a, b]) {
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (let i = 0; i < 600 && physics.hasCoin('A'); i++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(physics.hasCoin('A')).toBe(false);
    expect(game.view).toMatchObject({ phase: 'simulating', activeCoinId: null, scores: [0, 0], remaining: 2, lastResult: null, currentPlayer: 0 });
    const pending = game.frame;
    const pendingB = pending.coins.find((coin) => coin.id === 'B')!;
    expect(pendingB.position.y).toBeGreaterThan(COIN_THICKNESS / 2 + .003);
    expect(game.shoot({ x: -1, z: 0 }, .2)).toBe(false);
    expect(game.selectCoin('B')).toBe(false);
    game.pause(); game.tick(100); expect(game.frame).toEqual(pending);
    game.resume(); expect(game.view.phase).toBe('simulating');
    game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.frame.coins.find((coin) => coin.id === 'B')!.position.y).toBeLessThan(pendingB.position.y);
    finish(game);
    expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: 'B', scores: [1, 0], chain: 1, remaining: 2, currentPlayer: 0 });
    expect(game.view.foulReasons).toEqual([]);
    expect(physics.isSettled()).toBe(true);
    const landedB = game.frame.coins.find((coin) => coin.id === 'B')!;
    expect(landedB.position.y).toBeLessThan(COIN_THICKNESS / 2 + .002);
    expect(landedB.position.x).toBeCloseTo(pendingB.position.x, 5);
    expect(landedB.position.z).toBeCloseTo(pendingB.position.z, 5);
    expect(game.frame.coins.find((coin) => coin.id === 'C')!.position.x).toBe(pending.coins.find((coin) => coin.id === 'C')!.position.x);
    expect(game.shoot({ x: -1, z: 0 }, .2)).toBe(true);
    game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.frame.coins.find((coin) => coin.id === 'B')!.position.x).toBeLessThan(landedB.position.x);
  });
  it('keeps cleanup motion subject to TIMEOUT without awarding the pending point', async () => {
    const game = await session(level([['A', -.22, 0], ['B', 0, 0], ['C', -.35, .4]]));
    const physics = (game as unknown as { physics: PhysicsWorld }).physics;
    const bindings = (physics as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
    game.shoot({ x: 1, z: 0 }, .6);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) { game.tick(PHYSICS_CONFIG.fixedDt); hit = game.drainFeedback().includes('coin'); }
    expect(hit).toBe(true);
    const a = bindings.get('A')!.body, b = bindings.get('B')!.body, ap = a.translation();
    b.setTranslation({ x: ap.x, y: ap.y + COIN_THICKNESS + .002, z: ap.z }, true);
    for (const body of [a, b]) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    for (let i = 0; i < 600 && physics.hasCoin('A'); i++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(game.view).toMatchObject({ phase: 'simulating', scores: [0, 0] });
    for (let i = 0; i < PHYSICS_CONFIG.maxShotSteps && game.view.phase === 'simulating'; i++) {
      b.setAngvel({ x: 0, y: 3, z: 0 }, true); game.tick(PHYSICS_CONFIG.fixedDt);
    }
    expect(game.view).toMatchObject({ phase: 'failed', scores: [0, 0], remaining: 2, foulReasons: ['TIMEOUT'] });
  });
  it.each(['challenge', 'battle'] as const)('preserves a real cleanup fall as a foul in %s', async (mode) => {
    const game = await session(level([['A', -.22, 0], ['B', 0, 0], ['C', -.35, .4]]), mode);
    const physics = (game as unknown as { physics: PhysicsWorld }).physics;
    const bindings = (physics as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
    game.shoot({ x: 1, z: 0 }, .6);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) { game.tick(PHYSICS_CONFIG.fixedDt); hit = game.drainFeedback().includes('coin'); }
    expect(hit).toBe(true);
    const a = bindings.get('A')!.body, b = bindings.get('B')!.body, ap = a.translation();
    b.setTranslation({ x: ap.x, y: ap.y + COIN_THICKNESS + .002, z: ap.z }, true);
    for (const body of [a, b]) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    for (let i = 0; i < 600 && physics.hasCoin('A'); i++) game.tick(PHYSICS_CONFIG.fixedDt);
    expect(physics.hasCoin('A')).toBe(false);
    expect(game.view).toMatchObject({ phase: 'simulating', scores: [0, 0] });
    // Actual Rapier motion crosses the rim during the pending landing; the
    // already-valid hit never grants permission to ignore this physical fall.
    b.applyImpulse({ x: .048, y: 0, z: 0 }, true);
    finish(game);
    expect(game.view).toMatchObject({ phase: mode === 'challenge' ? 'failed' : 'refilling', scores: [0, 0], remaining: 1 });
    expect(game.view.foulReasons).toEqual(['FALL']);
    expect(game.lastFallenCoinIds).toEqual(['B']);
    expect(game.frame.coins.map((coin) => coin.id)).toEqual(['C']);
  });
  it('still times out a genuinely moving supported board after a legal target hit', async () => {
    const game = await session(level([['A', -.22, 0], ['B', 0, 0], ['C', -.35, .4]]));
    const physics = (game as unknown as { physics: PhysicsWorld }).physics;
    const bindings = (physics as unknown as { coins: Map<string, { body: RAPIER.RigidBody }> }).coins;
    game.shoot({ x: 1, z: 0 }, .6);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) { game.tick(PHYSICS_CONFIG.fixedDt); hit = game.drainFeedback().includes('coin'); }
    expect(hit).toBe(true);
    const a = bindings.get('A')!.body;
    // Sustain real angular motion each physics frame. allSupported stays true;
    // this must not turn the timeout into a valid relay or hide it by freezing first.
    for (let i = 0; i < PHYSICS_CONFIG.maxShotSteps && game.view.phase === 'simulating'; i++) {
      a.setAngvel({ x: 0, y: 3, z: 0 }, true);
      game.tick(PHYSICS_CONFIG.fixedDt);
    }
    expect(game.view).toMatchObject({ phase: 'failed', scores: [0, 0], remaining: 3 });
    expect(game.view.foulReasons).toEqual(['TIMEOUT']);
    expect(game.frame.coins.some((coin) => coin.id === 'A')).toBe(true);
  });
  it('does not partially commit a relay whose fixed support precheck fails', async () => {
    const game = await session();
    vi.spyOn(PhysicsWorld.prototype, 'canRemoveSource').mockReturnValue(false);
    game.shoot({ x: 1, z: 0 }, 0.42); finish(game);
    expect(game.view).toMatchObject({ phase: 'error', scores: [0, 0], remaining: 2, activeCoinId: 'A' });
    expect(game.frame.coins.map((coin) => coin.id)).toEqual(['A', 'B']);
    expect(game.shoot({ x: 1, z: 0 }, 0.42)).toBe(false);
    expect(game.selectCoin('B')).toBe(false);
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
