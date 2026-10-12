import { afterEach, describe, expect, it } from 'vitest';
import { BATTLE_WIN_SCORE, GameSession } from '../../src/core/GameSession';
import type { BattleWinScore, LevelConfig } from '../../src/types/contracts';

const level = (): LevelConfig => ({ schemaVersion: 1, id: 'battle', name: 'battle', lesson: 'race to ten',
  table: { width: 2.4, depth: 2.4, materialId: 'wood' },
  coins: [{ id: 'A', x: -.18, z: 0, materialId: 'standard' }, { id: 'B', x: .12, z: 0, materialId: 'standard' }], activeCoinId: 'A', obstacles: [] });
const sessions: GameSession[] = [];
async function create(firstPlayer: 0 | 1 = 0) { const game = await GameSession.create(level(), 'battle', firstPlayer); sessions.push(game); game.selectCoin('A'); return game; }
function finish(game: GameSession) { for (let i = 0; i < 1000 && game.view.phase === 'simulating'; i++) game.tick(1 / 60); expect(game.view.phase).not.toBe('simulating'); }
function refill(game: GameSession, id: string, dx: number): LevelConfig {
  const coins = game.frame.coins.map((coin) => ({ id: coin.id, materialId: coin.materialId, x: coin.position.x, z: coin.position.z }));
  const retained = coins[0];
  coins.push({ id, materialId: 'standard', x: retained.x + dx, z: retained.z });
  return { ...level(), id: `refill-${id}`, activeCoinId: retained.id, coins };
}
afterEach(() => sessions.splice(0).forEach((game) => game.dispose()));
describe('configured settled point goal wins Battle', () => {
  it.each([{ player: 0 as const, goal: 10 as const }, { player: 1 as const, goal: 10 as const }])
  ('retains contestant $player relay through refills and ends only at $goal settled points', async ({ player, goal }) => {
    const game = await create(player);
    expect(BATTLE_WIN_SCORE).toBe(10);
    expect(game.view.battleWinScore).toBe(goal);
    let direction = 1;
    for (let point = 1; point <= goal; point++) {
      const before = game.view.scores[player];
      expect(game.shoot({ x: direction, z: 0 }, .42)).toBe(true);
      game.tick(1 / 120); expect(game.view.scores[player]).toBe(before);
      finish(game);
      expect(game.view.scores[player]).toBe(point);
      expect(game.view.currentPlayer).toBe(player);
      if (point < goal) {
        expect(game.view.remaining).toBe(1);
        expect(game.view).toMatchObject({ phase: 'refilling', winner: null, canSelectCoin: false });
        expect(game.shoot({ x: -direction, z: 0 }, .42)).toBe(false);
        const survivor = game.frame.coins[0]; direction = -direction;
        const layout = refill(game, `new-${point}`, direction * .2);
        if (point === goal - 1) layout.coins.push({ id: 'still-on-table-at-victory', materialId: 'iron', x: -.8, z: .8 });
        const invalid = structuredClone(layout); invalid.coins[0].x += .02;
        const beforeRefill = game.view;
        expect(game.refill(invalid)).toBe(false); expect(game.view).toEqual(beforeRefill);
        expect(game.refill(layout)).toBe(true);
        expect(game.frame.coins.find((coin) => coin.id === survivor.id)).toEqual(survivor);
        expect(game.view).toMatchObject({ phase: 'ready', activeCoinId: survivor.id, canSelectCoin: false, currentPlayer: player });
        expect(game.view.battleWinScore).toBe(goal);
        expect(game.selectCoin(`new-${point}`)).toBe(false);
        expect(game.refill(layout)).toBe(false);
      } else {
        expect(game.view).toMatchObject({ phase: 'complete', winner: player, remaining: 2, scores: player === 0 ? [goal, 0] : [0, goal] });
        expect(game.selectCoin(game.frame.coins[0].id)).toBe(false);
        expect(game.refill(refill(game, 'never-added', .2))).toBe(false);
        game.tick(10); expect(game.view.scores[player]).toBe(goal);
      }
    }
  });
  it('rejects an invalid winning score before creating physics', async () => {
    await expect(GameSession.create(level(), 'battle', 0, 6 as BattleWinScore)).rejects.toThrow('target score');
    await expect(GameSession.create(level(), 'battle', 0, 5 as BattleWinScore)).rejects.toThrow('target score');
  });
  it('a fall swaps the player before a refill and lets them freely choose a new public coin', async () => {
    const layout = level(); layout.coins[0].x = 1.08;
    const game = await GameSession.create(layout, 'battle'); sessions.push(game); game.selectCoin('A');
    game.shoot({ x: 1, z: 0 }, 1); finish(game);
    expect(game.view).toMatchObject({ phase: 'refilling', currentPlayer: 1, scores: [0, 0], winner: null, activeCoinId: null, canSelectCoin: true });
    const survivor = game.frame.coins[0];
    expect(game.refill(refill(game, 'C', -.2))).toBe(true);
    expect(game.view).toMatchObject({ phase: 'selecting', currentPlayer: 1, scores: [0, 0], activeCoinId: null, canSelectCoin: true });
    expect(game.frame.coins.find((coin) => coin.id === survivor.id)).toEqual(survivor);
    expect(game.selectCoin('C')).toBe(true); expect(game.selectCoin(survivor.id)).toBe(true);
  });
});
