// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRAZYGAMES_SDK_URL, CrazyGamesAdapter, type CrazyGamesSDK, type CrazyGamesSettings } from '../../src/platform/CrazyGamesAdapter';

function mockSDK(environment = 'local', muted = false) {
  let listener: ((settings: CrazyGamesSettings) => void) | null = null;
  const calls: string[] = [];
  const sdk: CrazyGamesSDK = {
    environment,
    init: vi.fn(async () => { calls.push('init'); }),
    game: {
      settings: { muteAudio: muted },
      gameplayStart: vi.fn(() => { calls.push('gameplayStart'); }),
      gameplayStop: vi.fn(() => { calls.push('gameplayStop'); }),
      loadingStart: vi.fn(() => { calls.push('loadingStart'); }),
      loadingStop: vi.fn(() => { calls.push('loadingStop'); }),
      addSettingsChangeListener: vi.fn(value => { listener = value; }),
      removeSettingsChangeListener: vi.fn(value => { if (listener === value) listener = null; }),
    },
  };
  return { sdk, calls, update: (settings: CrazyGamesSettings) => listener?.(settings) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controlScriptEvents(): void {
  // happy-dom immediately emits a synthetic network error for executable
  // scripts. Keep the node inert so these tests control load/error explicitly.
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name: string, options?: ElementCreationOptions) => {
    const element = create(name, options);
    if (name === 'script') (element as HTMLScriptElement).type = 'application/json';
    return element;
  });
}

const adapters: CrazyGamesAdapter[] = [];
function adapter(sdk: CrazyGamesSDK) {
  const result = new CrazyGamesAdapter({ loadSDK: async () => sdk });
  adapters.push(result);
  return result;
}

afterEach(() => {
  for (const platform of adapters.splice(0)) platform.dispose();
  document.head.querySelectorAll(`script[src="${CRAZYGAMES_SDK_URL}"]`).forEach(script => script.remove());
  delete (window as Window & { CrazyGames?: unknown }).CrazyGames;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CrazyGames platform boundary', () => {
  it.each(['local', 'crazygames'])('initializes once in %s, with no early gameplay event', async environment => {
    const { sdk, calls } = mockSDK(environment);
    const platform = adapter(sdk);
    const first = platform.initialize();
    expect(platform.initialize()).toBe(first);
    await first;
    expect(calls).toEqual(['init']);
    expect(platform.status).toBe('ready');
    expect(platform.environment).toBe(environment);
    expect(sdk.game.addSettingsChangeListener).toHaveBeenCalledOnce();
    platform.setGameplay(false);
    platform.setLoading(false);
    expect(calls).toEqual(['init']);
  });

  it('reports loading and genuine play transitions in order, without repeated events', async () => {
    const { sdk, calls } = mockSDK();
    const platform = adapter(sdk);
    platform.setLoading(true);
    await platform.initialize();
    platform.setLoading(true);
    platform.setGameplay(true);
    expect(calls).toEqual(['init', 'loadingStart']);
    platform.setLoading(false);
    for (let index = 0; index < 120; index++) platform.setGameplay(true);
    platform.setGameplay(false);
    platform.setGameplay(false);
    platform.setGameplay(true);
    platform.setLoading(true);
    platform.setGameplay(false);
    platform.setLoading(false);
    expect(calls).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart', 'gameplayStop', 'loadingStart', 'loadingStop']);
  });

  it('retains only latest desired states across delayed SDK init', async () => {
    const { sdk, calls } = mockSDK();
    const gate = deferred<void>();
    sdk.init = vi.fn(() => gate.promise);
    const platform = adapter(sdk);
    const initialized = platform.initialize();
    platform.setLoading(true);
    platform.setGameplay(true);
    platform.setLoading(false);
    platform.setGameplay(false);
    gate.resolve();
    await initialized;
    expect(calls).toEqual([]);
    platform.setGameplay(true);
    expect(calls).toEqual(['gameplayStart']);
  });

  it('flushes active loading after delayed initialization, and waits to start play', async () => {
    const { sdk, calls } = mockSDK();
    const gate = deferred<void>();
    sdk.init = vi.fn(() => gate.promise);
    const platform = adapter(sdk);
    const initialized = platform.initialize();
    platform.setLoading(true);
    platform.setGameplay(true);
    gate.resolve();
    await initialized;
    expect(calls).toEqual(['loadingStart']);
    platform.setLoading(false);
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
  });

  it('does not report focus or visibility changes as gameplay breaks', async () => {
    const { sdk, calls } = mockSDK();
    const platform = adapter(sdk);
    await platform.initialize();
    platform.setGameplay(true);
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(calls).toEqual(['init', 'gameplayStart']);
  });

  it('handles initial mute and changes, with unsubscription and portal mute priority', async () => {
    const { sdk, update } = mockSDK('local', true);
    const platform = adapter(sdk);
    let preference = true;
    let enabled = true;
    const changed = vi.fn((muted: boolean) => { enabled = preference && !muted; });
    const unsubscribe = platform.onMuteChange(changed);
    await platform.initialize();
    expect(platform.muted).toBe(true);
    expect(enabled).toBe(false);
    preference = false;
    update({ muteAudio: false });
    expect(enabled).toBe(false);
    preference = true;
    update({ muteAudio: true });
    expect(enabled).toBe(false);
    update({ muteAudio: false });
    expect(enabled).toBe(true);
    update({ muteAudio: false });
    expect(changed).toHaveBeenCalledTimes(5);
    unsubscribe();
    update({ muteAudio: true });
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it('skips all game module access in disabled or unknown environments', async () => {
    const { sdk } = mockSDK('disabled');
    const access = vi.fn(() => { throw new Error('Disabled module must not be accessed'); });
    Object.defineProperty(sdk, 'game', { get: access });
    const platform = adapter(sdk);
    platform.setLoading(true);
    platform.setGameplay(true);
    await platform.initialize();
    platform.setLoading(false);
    platform.dispose();
    expect(access).not.toHaveBeenCalled();
    expect(platform.environment).toBe('disabled');
    expect(platform.lastError).toBeNull();
  });

  it('keeps initialization failures from rejecting the application bootstrap', async () => {
    const { sdk } = mockSDK();
    sdk.init = vi.fn(async () => { throw new Error('Portal unavailable'); });
    const platform = adapter(sdk);
    await expect(platform.initialize()).resolves.toBeUndefined();
    expect(platform.status).toBe('offline');
    expect(platform.lastError).toBe('Portal unavailable');
    platform.setGameplay(true);
    expect(sdk.game.gameplayStart).not.toHaveBeenCalled();
  });

  it('bounds a never-resolving loader, aborts it, and ignores late results', async () => {
    vi.useFakeTimers();
    const gate = deferred<CrazyGamesSDK>();
    const { sdk } = mockSDK();
    let signal!: AbortSignal;
    const platform = new CrazyGamesAdapter({ loadSDK: input => { signal = input; return gate.promise; }, timeoutMs: 50 });
    adapters.push(platform);
    const initialized = platform.initialize();
    await vi.advanceTimersByTimeAsync(50);
    await initialized;
    expect(platform.status).toBe('offline');
    expect(platform.lastError).toContain('timed out');
    expect(signal.aborted).toBe(true);
    gate.resolve(sdk);
    await Promise.resolve();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(platform.status).toBe('offline');
  });

  it('bounds SDK init separately from script load and prevents late events', async () => {
    vi.useFakeTimers();
    const { sdk } = mockSDK();
    const gate = deferred<void>();
    sdk.init = vi.fn(() => gate.promise);
    const platform = new CrazyGamesAdapter({ loadSDK: async () => sdk, timeoutMs: 50 });
    adapters.push(platform);
    platform.setGameplay(true);
    const initialized = platform.initialize();
    await vi.advanceTimersByTimeAsync(50);
    await initialized;
    gate.resolve();
    await Promise.resolve();
    expect(platform.status).toBe('offline');
    expect(sdk.game.addSettingsChangeListener).not.toHaveBeenCalled();
    expect(sdk.game.gameplayStart).not.toHaveBeenCalled();
  });

  it('catches SDK method and callback failures without spamming failed events', async () => {
    const { sdk } = mockSDK();
    sdk.game.gameplayStart = vi.fn(() => { throw new Error('Portal method failed'); });
    const platform = adapter(sdk);
    await platform.initialize();
    platform.setGameplay(true);
    platform.setGameplay(true);
    expect(platform.lastError).toBe('Portal method failed');
    expect(sdk.game.gameplayStart).toHaveBeenCalledOnce();
    expect(() => platform.onMuteChange(() => { throw new Error('Consumer failed'); })).not.toThrow();
    platform.dispose();
    expect(platform.status).toBe('disposed');
  });

  it('disposes idempotently, stops genuine play and removes the original settings listener', async () => {
    const { sdk, calls, update } = mockSDK();
    const platform = adapter(sdk);
    const changed = vi.fn();
    platform.onMuteChange(changed);
    await platform.initialize();
    platform.setGameplay(true);
    const listener = vi.mocked(sdk.game.addSettingsChangeListener).mock.calls[0][0];
    platform.dispose();
    platform.dispose();
    platform.setGameplay(true);
    platform.setLoading(true);
    update({ muteAudio: true });
    listener({ muteAudio: true });
    await platform.initialize();
    expect(calls).toEqual(['init', 'gameplayStart', 'gameplayStop']);
    expect(sdk.game.removeSettingsChangeListener).toHaveBeenCalledExactlyOnceWith(listener);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('disposes during initialization promptly without events after delayed resolution', async () => {
    const { sdk } = mockSDK();
    const gate = deferred<void>();
    sdk.init = vi.fn(() => gate.promise);
    const platform = adapter(sdk);
    const initialized = platform.initialize();
    await Promise.resolve();
    platform.setLoading(true);
    platform.setGameplay(true);
    platform.dispose();
    await initialized;
    gate.resolve();
    await Promise.resolve();
    expect(platform.status).toBe('disposed');
    expect(sdk.game.loadingStart).not.toHaveBeenCalled();
    expect(sdk.game.gameplayStart).not.toHaveBeenCalled();
    expect(sdk.game.addSettingsChangeListener).not.toHaveBeenCalled();
  });

  it('ends loading on disposal and tolerates listener cleanup errors', async () => {
    const { sdk, calls } = mockSDK();
    sdk.game.removeSettingsChangeListener = vi.fn(() => { throw new Error('Cleanup unavailable'); });
    const platform = adapter(sdk);
    await platform.initialize();
    platform.setLoading(true);
    platform.dispose();
    expect(calls).toEqual(['init', 'loadingStart', 'loadingStop']);
    expect(platform.lastError).toBe('Cleanup unavailable');
  });

  it('loads the canonical real SDK script once and waits for its load before init', async () => {
    controlScriptEvents();
    const { sdk } = mockSDK();
    const platform = new CrazyGamesAdapter();
    adapters.push(platform);
    const initialized = platform.initialize();
    platform.initialize();
    const scripts = document.head.querySelectorAll<HTMLScriptElement>(`script[src="${CRAZYGAMES_SDK_URL}"]`);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].async).toBe(true);
    expect(sdk.init).not.toHaveBeenCalled();
    (window as Window & { CrazyGames?: { SDK: CrazyGamesSDK } }).CrazyGames = { SDK: sdk };
    scripts[0].dispatchEvent(new Event('load'));
    await initialized;
    expect(platform.status).toBe('ready');
    expect(sdk.init).toHaveBeenCalledOnce();
  });

  it('reuses a preloaded global SDK without appending a script', async () => {
    const { sdk } = mockSDK();
    (window as Window & { CrazyGames?: { SDK: CrazyGamesSDK } }).CrazyGames = { SDK: sdk };
    const platform = new CrazyGamesAdapter();
    adapters.push(platform);
    await platform.initialize();
    expect(document.head.querySelector(`script[src="${CRAZYGAMES_SDK_URL}"]`)).toBeNull();
    expect(platform.status).toBe('ready');
  });

  it('continues offline on a script network error and removes its injected script', async () => {
    controlScriptEvents();
    const platform = new CrazyGamesAdapter();
    adapters.push(platform);
    const initialized = platform.initialize();
    const script = document.head.querySelector(`script[src="${CRAZYGAMES_SDK_URL}"]`)!;
    script.dispatchEvent(new Event('error'));
    await expect(initialized).resolves.toBeUndefined();
    expect(platform.status).toBe('offline');
    expect(platform.lastError).toContain('could not be loaded');
    expect(document.head.contains(script)).toBe(false);
  });

  it('does not initialize after disposal before first use', async () => {
    const { sdk } = mockSDK();
    const platform = adapter(sdk);
    platform.dispose();
    await platform.initialize();
    expect(sdk.init).not.toHaveBeenCalled();
  });
});
