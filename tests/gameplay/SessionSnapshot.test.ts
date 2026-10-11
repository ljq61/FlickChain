import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { LevelConfig } from '../../src/types/contracts';

const level = (): LevelConfig => ({ schemaVersion: 1, id: 'snapshot', name: 'snapshot', lesson: 'snapshot',
  table: { width: 1.2, depth: 1.6, materialId: 'wood' },
  coins: [{ id: 'A', x: -.22, z: 0, materialId: 'standard' }, { id: 'B', x: 0, z: 0, materialId: 'standard' }, { id: 'C', x: -.35, z: .4, materialId: 'iron' }], activeCoinId: 'A',
  obstacles: [{ id: 'glass', kind: 'glass', x: .28, z: -.33, width: .12, depth: .12 }] });
const sessions: GameSession[] = [];
function finish(game: GameSession) { for (let i = 0; i < 1800 && game.view.phase === 'simulating'; i++) game.tick(PHYSICS_CONFIG.fixedDt); expect(game.view.phase).not.toBe('simulating'); }
async function create() { const game = await GameSession.create(level(), 'battle'); sessions.push(game); return game; }
afterEach(() => sessions.splice(0).forEach((game) => game.dispose()));
describe('exact settled production snapshot replay', () => {
  it('keeps a moved board and its business state identical throughout the next real shot', async () => {
    const game = await create(); game.selectCoin('A'); game.shoot({ x: 0, z: -1 }, .2); finish(game);
    expect(game.view.phase).toBe('selecting');
    expect(game.frame.coins[0].position.z).not.toBe(0);
    const snapshot = game.exportSnapshot();
    const clone = await GameSession.restore(snapshot); sessions.push(clone);
    expect(clone.frame).toEqual(game.frame); expect(clone.view).toEqual(game.view);
    const a = game.frame.coins.find((coin) => coin.id === 'A')!.position;
    const b = game.frame.coins.find((coin) => coin.id === 'B')!.position;
    const direction = { x: b.x - a.x, z: b.z - a.z };
    for (const session of [game, clone]) { expect(session.selectCoin('A')).toBe(true); expect(session.shoot(direction, .4)).toBe(true); }
    for (let step = 0; step < 1800 && game.view.phase === 'simulating'; step++) {
      game.tick(PHYSICS_CONFIG.fixedDt); clone.tick(PHYSICS_CONFIG.fixedDt);
      expect(clone.frame).toEqual(game.frame); expect(clone.view).toEqual(game.view); expect(clone.drainFeedback()).toEqual(game.drainFeedback());
    }
    expect(game.view.phase).not.toBe('simulating'); expect(game.view.scores).toEqual([0, 1]);
  });
  it('restores a relay after source removal without recreating its authored coin or reopening selection', async () => {
    const game = await create(); game.selectCoin('A'); game.shoot({ x: 1, z: 0 }, .42); finish(game);
    expect(game.view).toMatchObject({ phase: 'ready', scores: [1, 0], activeCoinId: 'B', canSelectCoin: false });
    const snapshot = game.exportSnapshot();
    const clone = await GameSession.restore(snapshot); sessions.push(clone);
    snapshot.view.scores[0] = 999; snapshot.physics.bytes.fill(0);
    expect(clone.view).toEqual(game.view); expect(clone.frame).toEqual(game.frame);
    expect(clone.frame.coins.some((coin) => coin.id === 'A')).toBe(false);
    expect(clone.selectCoin('C')).toBe(false);
    for (const session of [game, clone]) { session.shoot({ x: -1, z: 0 }, .2); finish(session); }
    expect(clone.frame).toEqual(game.frame); expect(clone.view).toEqual(game.view);
  });
  it('refuses export during a shot, pause and disposal, and rejects an inconsistent clone state', async () => {
    const game = await create(); const snapshot = game.exportSnapshot();
    const invalid = structuredClone(snapshot); invalid.view.phase = 'ready'; invalid.view.activeCoinId = 'missing';
    await expect(GameSession.restore(invalid)).rejects.toThrow('映射');
    game.selectCoin('A'); game.shoot({ x: 1, z: 0 }, .42);
    expect(() => game.exportSnapshot()).toThrow('静止');
    game.pause(); expect(() => game.exportSnapshot()).toThrow('静止');
    game.resume(); finish(game); game.dispose(); expect(() => game.exportSnapshot()).toThrow('静止');
  });
  it('restores a ten-point match above five and preserves the target throughout a real shot', async () => {
    const game = await GameSession.create(level(), 'battle', 1, 10); sessions.push(game);
    const snapshot = game.exportSnapshot(); snapshot.view.scores = [6, 8];
    const clone = await GameSession.restore(snapshot); sessions.push(clone);
    expect(clone.view).toMatchObject({ battleWinScore: 10, scores: [6, 8] });
    clone.selectCoin('A'); clone.shoot({ x: 1, z: 0 }, .42); finish(clone);
    expect(clone.view).toMatchObject({ phase: 'ready', winner: null, battleWinScore: 10, scores: [6, 9] });
  });
  it('defaults legacy snapshots to ten and rejects invalid or already-winning match snapshots', async () => {
    const game = await create(); const legacy = game.exportSnapshot(); delete legacy.view.battleWinScore;
    const clone = await GameSession.restore(legacy); sessions.push(clone);
    expect(clone.view.battleWinScore).toBe(10);
    for (const goal of [0, 5, 6, null, NaN]) {
      const invalid = game.exportSnapshot(); Object.assign(invalid.view, { battleWinScore: goal });
      await expect(GameSession.restore(invalid)).rejects.toThrow('状态无效');
    }
    const winning = game.exportSnapshot(); winning.view.scores[1] = 10;
    await expect(GameSession.restore(winning)).rejects.toThrow('状态无效');
  });
  it('restores an edge-overhanging retained coin after a valid Battle refill without revalidating it as a fresh spawn', async () => {
    const layout = level(); layout.coins = [{ id: 'A', x: .5, z: 0, materialId: 'standard' }, { id: 'B', x: -.5, z: .3, materialId: 'standard' }];
    const game = await GameSession.create(layout, 'battle'); sessions.push(game);
    game.selectCoin('A'); game.shoot({ x: 1, z: 0 }, .22); finish(game);
    const a = game.frame.coins.find((coin) => coin.id === 'A')!;
    expect(a.position.x).toBeGreaterThan(.6 - .035 - PHYSICS_CONFIG.initialClearance);
    game.selectCoin('B'); game.shoot({ x: -1, z: 0 }, 1); finish(game);
    expect(game.view.phase).toBe('refilling');
    const refill: LevelConfig = { ...layout, coins: [{ id: 'A', materialId: 'standard', x: a.position.x, z: a.position.z }, { id: 'C', materialId: 'iron', x: 0, z: .4 }], activeCoinId: 'A' };
    expect(game.refill(refill)).toBe(true); game.selectCoin('A');
    const clone = await GameSession.restore(game.exportSnapshot()); sessions.push(clone);
    expect(clone.frame).toEqual(game.frame); expect(clone.view).toEqual(game.view);
    for (const session of [game, clone]) { session.shoot({ x: -1, z: 0 }, .2); finish(session); }
    expect(clone.frame).toEqual(game.frame); expect(clone.view).toEqual(game.view);
  });
});
