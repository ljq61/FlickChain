import { describe, expect, it } from 'vitest';
import { SaveAdapter } from '../../src/platform/SaveAdapter';

describe('progress storage recovery', () => {
  it('recovers corrupt or unsupported saves without preventing play', () => {
    for (const raw of ['{broken', 'null', '{"schemaVersion":2,"completed":[],"sound":true}']) {
      const adapter = new SaveAdapter(['one'], { getItem: () => raw, setItem: () => {} });
      expect(adapter.read()).toEqual({ schemaVersion: 1, completed: [], sound: true });
      expect(adapter.lastError).not.toBeNull();
    }
  });

  it('keeps only unique known completed levels and restores sound', () => {
    const adapter = new SaveAdapter(['one'], {
      getItem: () => JSON.stringify({ schemaVersion: 1, completed: ['one', 'gone', 'one', null], sound: false }),
      setItem: () => {},
    });
    expect(adapter.read()).toEqual({ schemaVersion: 1, completed: ['one'], sound: false });
  });

  it('reports quota or permission failure without throwing', () => {
    const adapter = new SaveAdapter(['one'], { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(adapter.write({ schemaVersion: 1, completed: ['one'], sound: true })).toBe(false);
    expect(adapter.lastError).toContain('未保存');
  });
});
