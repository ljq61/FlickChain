import { describe, expect, it } from 'vitest';
import { SaveAdapter } from '../../src/platform/SaveAdapter';

describe('progress storage recovery', () => {
  it('recovers corrupt or unsupported saves without preventing play', () => {
    for (const raw of ['{broken', 'null', '{"schemaVersion":2,"completed":[],"sound":true}']) {
      const adapter = new SaveAdapter(['one'], { getItem: () => raw, setItem: () => {} });
      expect(adapter.read()).toEqual({ schemaVersion: 1, completed: [], sound: true, bestScore: 0 });
      expect(adapter.lastError).not.toBeNull();
    }
  });

  it('keeps only unique known completed levels and restores sound', () => {
    const adapter = new SaveAdapter(['one'], {
      getItem: () => JSON.stringify({ schemaVersion: 1, completed: ['one', 'gone', 'one', null], sound: false }),
      setItem: () => {},
    });
    expect(adapter.read()).toEqual({ schemaVersion: 1, completed: ['one'], sound: false, bestScore: 0 });
  });

  it('reports quota or permission failure without throwing', () => {
    const adapter = new SaveAdapter(['one'], { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(adapter.write({ schemaVersion: 1, completed: ['one'], sound: true, bestScore: 9 })).toBe(false);
    expect(adapter.lastError).toContain('not saved');
  });

  it('persists the best score across a new adapter and safely migrates old preferences', () => {
    let raw = JSON.stringify({ schemaVersion: 1, completed: ['one'], sound: false });
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const adapter = new SaveAdapter(['one'], storage);
    const old = adapter.read();
    expect(old).toMatchObject({ bestScore: 0, sound: false });
    expect(adapter.write({ ...old, bestScore: 27 })).toBe(true);
    expect(new SaveAdapter(['one'], storage).read()).toMatchObject({ bestScore: 27, sound: false });
  });

  it.each([-1, 0.5, '9', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid best scores %s without losing preferences', (bestScore) => {
    const adapter = new SaveAdapter([], { getItem: () => JSON.stringify({ schemaVersion: 1, completed: [], sound: false, bestScore }), setItem: () => {} });
    expect(adapter.read()).toMatchObject({ bestScore: 0, sound: false });
  });
});
