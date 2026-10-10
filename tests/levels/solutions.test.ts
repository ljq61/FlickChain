import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/core/GameSession';
import { LEVELS } from '../../src/content/levels';
import { PHYSICS_CONFIG } from '../../src/physics/MaterialRegistry';
import solutions from './solutions.json';
import { fingerprint, finishShot } from './replay';

describe('complete level solutions through production Rapier/GameSession', () => {
  it('has exactly one recorded semantic solution for every delivered level', () => {
    expect(solutions.map((solution) => solution.levelId)).toEqual(LEVELS.map((level) => level.id));
  });
  for (const level of LEVELS) {
    it(`${level.id}: clears all coins with exactly N-1 legal shots`, async () => {
      const solution = solutions.find((entry) => entry.levelId === level.id)!;
      expect(solution.schemaVersion).toBe(level.schemaVersion);
      expect(solution.configVersion).toBe(PHYSICS_CONFIG.version);
      expect(solution.configFingerprint, 'Configuration changed: explicitly regenerate and review complete solutions').toBe(fingerprint(level));
      expect(solution.shots.length).toBe(level.coins.length - 1);
      const session = await GameSession.create(level, 'challenge');
      try {
        expect(session.view.phase).toBe('selecting');
        expect(session.selectCoin(solution.shots[0].sourceCoinId)).toBe(true);
        for (const [index, shot] of solution.shots.entries()) {
          expect(session.view.activeCoinId).toBe(shot.sourceCoinId);
          expect(session.shoot(shot.direction, shot.power)).toBe(true);
          expect(session.shoot(shot.direction, shot.power), 'No second impulse during the shot').toBe(false);
          let targetFinalPosition = null;
          let frames = 0;
          while (session.view.phase === 'simulating' && frames++ < 1000) {
            targetFinalPosition = session.frame.coins.find((coin) => coin.id === shot.targetCoinId)!.position;
            session.tick(1 / 60);
          }
          expect(session.view.lastResult).toEqual({ outcome: 'SUCCESS', sourceCoinId: shot.sourceCoinId, targetCoinId: shot.targetCoinId, reasons: [] });
          expect(session.view.foulReasons).toEqual([]);
          expect(session.frame.coins.some((coin) => coin.id === shot.sourceCoinId)).toBe(false);
          expect(session.view.activeCoinId).toBe(shot.targetCoinId);
          expect(session.view.scores).toEqual([index + 1, 0]);
          expect(session.view.currentPlayer).toBe(0);
          expect(session.view.remaining).toBe(level.coins.length - index - 1);
          const target = session.frame.coins.find((coin) => coin.id === shot.targetCoinId)!;
          expect(Math.hypot(target.position.x - targetFinalPosition!.x, target.position.z - targetFinalPosition!.z), 'Relay preserves the physical final position').toBeLessThan(0.002);
          expect(session.view.phase).toBe(index === solution.shots.length - 1 ? 'complete' : 'ready');
        }
        expect(session.view.shotCount).toBe(level.coins.length - 1);
        expect(session.view.chain).toBe(level.coins.length - 1);
        expect(session.view.remaining).toBe(1);
        expect(session.shoot({ x: 1, z: 0 }, 1)).toBe(false);
      } finally { session.dispose(); }
    });
    it(`${level.id}: validates a stable initial world and a fresh replay after disposal`, async () => {
      const previous = await GameSession.create(level, 'challenge'); previous.dispose();
      const fresh = await GameSession.create(level, 'challenge');
      try {
        for (const config of level.coins) {
          const coin = fresh.frame.coins.find((entry) => entry.id === config.id)!;
          expect(Math.hypot(coin.position.x - config.x, coin.position.z - config.z)).toBeLessThan(0.002);
        }
        const shot = solutions.find((entry) => entry.levelId === level.id)!.shots[0];
        expect(fresh.view.phase).toBe('selecting');
        expect(fresh.selectCoin(shot.sourceCoinId)).toBe(true);
        expect(fresh.shoot(shot.direction, shot.power)).toBe(true);
        finishShot(fresh);
        expect(fresh.view.lastResult?.outcome).toBe('SUCCESS');
      } finally { fresh.dispose(); }
    });
  }
});
