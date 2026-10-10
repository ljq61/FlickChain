import { describe, expect, it } from 'vitest';
import { CoinArrival } from '../../src/rendering/CoinArrival';

describe('coin arrival presentation', () => {
  it('stagger-drops coins, emits one impact per coin and restores exact authoritative poses', () => {
    const arrival = new CoinArrival();
    arrival.begin(['A', 'B', 'C']);
    expect(arrival.playing).toBe(true);
    expect(arrival.pose('A').height).toBe(0.18);
    arrival.advance(0.1);
    expect(arrival.pose('A').height).toBeLessThan(arrival.pose('B').height);
    const hits = [];
    for (let i = 0; i < 80; i++) {
      hits.push(...arrival.advance(1 / 60));
      for (const id of ['A', 'B', 'C']) expect(arrival.pose(id).height).toBeGreaterThanOrEqual(0);
    }
    expect(hits).toEqual(['A', 'B', 'C']);
    expect(arrival.playing).toBe(false);
    expect(arrival.pose('A')).toEqual({ height: 0, tilt: 0, yaw: 0 });
    expect(arrival.advance(1)).toEqual([]);
  });

  it('clears a replaced intro, skips reduced motion and drops background backlog', () => {
    const arrival = new CoinArrival();
    arrival.begin(['old']);
    arrival.advance(0.1);
    arrival.begin(['new']);
    expect(arrival.advance(5)).toEqual([]);
    expect(arrival.playing).toBe(true);
    expect(arrival.pose('old')).toEqual({ height: 0, tilt: 0, yaw: 0 });
    arrival.begin(['quiet'], true);
    expect(arrival.playing).toBe(false);
    expect(arrival.advance(0.1)).toEqual([]);
    arrival.begin([]);
    expect(arrival.playing).toBe(false);
  });
});
