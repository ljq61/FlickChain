import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession, type SessionSnapshot } from '../../src/core/GameSession';
import { AI_LIMITS, CASUAL_AI_PROFILE, chooseCasualBattle, searchBattle, searchOpening, type AiShot } from '../../src/ai/BattleSearch';
import { generateBattle, generateOpening } from '../../src/content/BattleGenerator';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import type { AIRequest, AIResponse } from '../../src/ai/AIClient';
import type { LevelConfig } from '../../src/types/contracts';

function seeded(seed: number): () => number {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function settle(game: GameSession): void {
  for (let step = 0; game.view.phase === 'simulating' && step < AI_LIMITS.candidateSteps; step++) game.tick(PHYSICS_CONFIG.fixedDt);
}
async function replay(snapshot: SessionSnapshot, shot: AiShot) {
  const game = await GameSession.restore(snapshot);
  try {
    if (game.view.canSelectCoin) expect(game.selectCoin(shot.coinId)).toBe(true);
    expect(game.view.activeCoinId).toBe(shot.coinId);
    expect(game.shoot(shot.direction, shot.power)).toBe(true);
    settle(game); expect(game.view.phase).not.toBe('simulating'); expect(game.view.phase).not.toBe('error');
    return game.view;
  } finally { game.dispose(); }
}
const board = (): LevelConfig => ({ schemaVersion: 1, id: 'casual-relay', name: 'Casual relay', lesson: 'Real handoff',
  table: { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' }, obstacles: [], activeCoinId: 'a',
  coins: [{ id: 'a', x: -0.5, z: 0, materialId: 'standard' }, { id: 'b', x: -0.15, z: 0, materialId: 'standard' },
    { id: 'c', x: 0.2, z: 0, materialId: 'standard' }, { id: 'd', x: 0.5, z: 0.28, materialId: 'iron' },
    { id: 'e', x: -0.35, z: 0.35, materialId: 'standard' }] });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('casual production decisions', () => {
  it('still scores with a small execution error and preserves the live snapshot', async () => {
    const game = await GameSession.create(board(), 'battle', 1);
    try {
      const snapshot = game.exportSnapshot(), before = structuredClone(snapshot);
      const values = [0.6, 0.55];
      const shot = await chooseCasualBattle(snapshot, () => values.shift() ?? 0.5);
      expect(Number.isFinite(shot.power)).toBe(true);
      expect(shot.power).toBeGreaterThanOrEqual(PHYSICS_CONFIG.minPower); expect(shot.power).toBeLessThanOrEqual(1);
      expect(Math.hypot(shot.direction.x, shot.direction.z)).toBeCloseTo(1, 12);
      const view = await replay(snapshot, shot);
      expect(view.lastResult?.outcome).toBe('SUCCESS'); expect(view.scores).toEqual([0, 1]);
      expect(snapshot).toEqual(before); expect(game.view.scores).toEqual([0, 0]);
    } finally { game.dispose(); }
  });
  it('the actual Worker applies streak error after two real scored relays and hands the board back without changing points', async () => {
    const game = await GameSession.create(board(), 'battle', 1);
    try {
      for (let index = 0; index < 2; index++) {
        const found = await searchBattle(game.exportSnapshot(), CASUAL_AI_PROFILE);
        if (game.view.canSelectCoin) expect(game.selectCoin(found.shot.coinId)).toBe(true);
        expect(game.shoot(found.shot.direction, found.shot.power)).toBe(true); settle(game);
        expect(game.view.lastResult?.outcome).toBe('SUCCESS');
      }
      expect(game.view).toMatchObject({ chain: 2, scores: [0, 2], canSelectCoin: false });
      const snapshot = game.exportSnapshot(), before = structuredClone(snapshot);
      const postMessage = vi.fn<(response: AIResponse) => void>();
      vi.stubGlobal('postMessage', postMessage); vi.stubGlobal('onmessage', null);
      vi.spyOn(Math, 'random').mockReturnValue(0.999999);
      await import('../../src/ai/BattleWorker');
      const worker = globalThis as unknown as { onmessage: (event: MessageEvent<AIRequest>) => Promise<void> };
      await worker.onmessage({ data: { id: 73, kind: 'battle', snapshot } } as MessageEvent<AIRequest>);
      const response = postMessage.mock.calls[0][0];
      expect(response).toMatchObject({ id: 73, kind: 'battle' });
      if ('shot' in response) {
        expect(response.shot.coinId).toBe(game.view.activeCoinId);
        const view = await replay(snapshot, response.shot);
        expect(view.lastResult).toMatchObject({ outcome: 'FOUL', reasons: ['MISS'] });
        expect(view).toMatchObject({ currentPlayer: 0, canSelectCoin: true, chain: 0, scores: [0, 2] });
      } else throw new Error('Worker did not return its actual battle shot');
      expect(snapshot).toEqual(before); expect(game.view.scores).toEqual([0, 2]);
    } finally { game.dispose(); }
  }, 10000);
  it('finishes a first verified safe opening even when cold initialization consumed the time budget', async () => {
    let calls = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => calls++ === 0 ? 0 : CASUAL_AI_PROFILE.timeMs + 1);
    const level = generateOpening({ shape: 'circle', width: 1.6, depth: 1.6, materialId: 'marble' });
    expect(await searchOpening(level, () => 0)).toBe(0.4);
  });
  it('seeded production board replays show ordinary hits and extra handoffs after a streak', async () => {
    let expertHits = 0, normalHits = 0, streakHits = 0, elapsedMs = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const random = seeded(seed * 8111), game = await GameSession.create(generateBattle(random), 'battle', 1);
      try {
        const snapshot = game.exportSnapshot(), before = structuredClone(snapshot);
        const expert = await searchBattle(snapshot);
        expertHits += (await replay(snapshot, expert.shot)).lastResult?.outcome === 'SUCCESS' ? 1 : 0;
        const started = performance.now();
        const normal = await chooseCasualBattle(snapshot, seeded(seed * 37));
        elapsedMs = Math.max(elapsedMs, performance.now() - started);
        normalHits += (await replay(snapshot, normal)).lastResult?.outcome === 'SUCCESS' ? 1 : 0;
        const streakSnapshot = structuredClone(snapshot); streakSnapshot.view.chain = 2;
        const streak = await chooseCasualBattle(streakSnapshot, seeded(seed * 37));
        const streakView = await replay(streakSnapshot, streak);
        streakHits += streakView.lastResult?.outcome === 'SUCCESS' ? 1 : 0;
        if (streakView.lastResult?.outcome !== 'SUCCESS') expect(streakView.scores).toEqual([0, 0]);
        expect(snapshot).toEqual(before);
      } finally { game.dispose(); }
    }
    expect(normalHits).toBeGreaterThan(0);
    expect(normalHits).toBeLessThanOrEqual(expertHits);
    expect(streakHits).toBeLessThan(normalHits);
    expect(streakHits).toBeLessThanOrEqual(6);
    expect(elapsedMs).toBeLessThan(2000);
    console.info(`Casual replay sample (8 seeded initial boards): expert=${expertHits}, normal=${normalHits}, after-two=${streakHits}; max casual search=${Math.round(elapsedMs)}ms`);
  }, 30000);
});
