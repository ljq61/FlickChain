// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '../../src/app/GameApp';
import { LEVELS } from '../../src/content/levels';
import type { CoinTransform, GameMode, GameView, LevelConfig, WorldFrame } from '../../src/types/contracts';

const harness = vi.hoisted(() => ({
  sessions: [] as Array<{
    view: GameView; frame: WorldFrame; lastFallenCoinIds: string[];
    dispose: ReturnType<typeof vi.fn>; advanceRound: ReturnType<typeof vi.fn>; revive: ReturnType<typeof vi.fn>;
  }>,
  handLoad: vi.fn(async () => {}),
  inputState: null as null | (() => { view: GameView | null; frame: WorldFrame | null }),
  inputCallbacks: null as null | { pickCoin: (id: string) => void; shoot: (direction: { x: number; z: number }, power: number) => void },
  play: vi.fn(), stopSounds: vi.fn(), suspendSound: vi.fn(), arrivals: [] as string[][],
}));

// App, Shell, generator and storage remain real. Physics and renderer are tested separately.
vi.mock('../../src/core/GameSession', () => ({ GameSession: {
  create: vi.fn(async (level: LevelConfig, mode: GameMode) => {
    const frameFor = (next: LevelConfig, retained: CoinTransform[] = []): WorldFrame => ({
      table: next.table, obstacles: next.obstacles,
      coins: next.coins.map(coin => retained.find(item => item.id === coin.id) ?? {
        id: coin.id, materialId: coin.materialId, position: { x: coin.x, y: 0.004, z: coin.z }, rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    });
    let paused: GameView['phase'] = 'selecting';
    const session = {
      view: { sessionId: `app-test-${harness.sessions.length}`, revision: 0, mode, phase: 'selecting', levelId: level.id,
        activeCoinId: null, canSelectCoin: true, currentPlayer: 0, scores: [0, 0], remaining: level.coins.length,
        chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null } as GameView,
      frame: frameFor(level), lastFallenCoinIds: [] as string[],
      tick: vi.fn(), drainFeedback: () => [], dispose: vi.fn(),
      selectCoin(id: string) { session.view = { ...session.view, phase: 'ready', activeCoinId: id }; return true; },
      shoot: vi.fn(() => { session.view.phase = 'simulating'; return true; }),
      pause() { paused = session.view.phase; session.view.phase = 'paused'; },
      resume() { session.view.phase = paused; },
      advanceRound: vi.fn((next: LevelConfig) => {
        const carry = session.frame.coins[0];
        session.frame = frameFor(next, session.frame.coins);
        session.view = { ...session.view, phase: 'ready', levelId: next.id, remaining: next.coins.length, activeCoinId: carry.id, canSelectCoin: false };
        return true;
      }),
      revive: vi.fn((next: LevelConfig) => {
        session.frame = frameFor(next, session.frame.coins);
        session.view = { ...session.view, phase: 'selecting', canSelectCoin: true, activeCoinId: null, remaining: next.coins.length, foulReasons: [] };
        session.lastFallenCoinIds = [];
        return true;
      }),
    };
    harness.sessions.push(session);
    return session;
  }),
} }));
vi.mock('../../src/rendering/SceneManager', async () => {
  const { CoinArrival } = await import('../../src/rendering/CoinArrival');
  return { SceneManager: class {
    arrival = new CoinArrival(); clearing = 0;
    initializeHand = harness.handLoad; setLevel = vi.fn(); render = vi.fn(); focusCoin = vi.fn(); clearFocus = vi.fn(); dispose = vi.fn();
    beginCoinArrival(ids: string[]) { harness.arrivals.push(ids); this.arrival.begin(ids); }
    advanceCoinArrival(seconds: number) { return this.arrival.advance(seconds); }
    get isIntroducing() { return this.arrival.playing; }
    beginObstacleRemoval() { this.clearing = 0.6; }
    advanceObstacleRemoval(seconds: number) { this.clearing = Math.max(0, this.clearing - seconds); }
    get isRemovingObstacles() { return this.clearing > 0; }
  } };
});
vi.mock('../../src/input/PointerInput', () => ({ PointerInput: class {
  constructor(_scene: unknown, getState: typeof harness.inputState, callbacks: typeof harness.inputCallbacks) {
    harness.inputState = getState; harness.inputCallbacks = callbacks;
  }
  cancel = vi.fn(); dispose = vi.fn(); charge = vi.fn(() => null);
} }));
vi.mock('../../src/ui/SoundManager', () => ({ SoundManager: class {
  enabled = true; unlock = vi.fn(); play = harness.play; slide = vi.fn(); stopCurrentSounds = harness.stopSounds; suspend = harness.suspendSound; dispose = vi.fn();
} }));

describe('continuous Challenge app and persistence', () => {
  let root: HTMLDivElement; let app: GameApp | undefined; let raf: FrameRequestCallback | undefined; let time: number;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    harness.sessions.length = 0; harness.arrivals.length = 0; harness.inputState = null; harness.inputCallbacks = null;
    harness.handLoad.mockReset().mockResolvedValue(undefined);
    time = 0; raf = undefined;
    root = document.createElement('div'); document.body.append(root);
    storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { raf = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => { app?.dispose(); app = undefined; root.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  function node<T extends HTMLElement = HTMLElement>(selector: string): T {
    const item = root.querySelector<T>(selector); expect(item, selector).not.toBeNull(); return item!;
  }
  function frames(count = 1): void {
    for (let i = 0; i < count; i++) { const callback = raf!; expect(callback).toBeDefined(); raf = undefined; callback(time += 16); }
  }
  async function initialize(): Promise<void> {
    app = new GameApp(root, () => 0.5); await app.initialize();
    expect(node('[data-el="loading"]').hidden).toBe(true);
  }
  async function start(): Promise<void> {
    node<HTMLButtonElement>('[data-action="challenge"]').click();
    await vi.waitFor(() => expect(node('.flick-shell').dataset.screen).toBe('game'));
    expect(harness.sessions.at(-1)!.frame.coins).toHaveLength(4);
  }
  function complete(): CoinTransform {
    const session = harness.sessions.at(-1)!;
    const carry = session.frame.coins.at(-1)!;
    session.frame.coins = [carry];
    session.view = { ...session.view, phase: 'complete', scores: [session.view.scores[0] + 3, 0], remaining: 1, activeCoinId: carry.id };
    frames(); return structuredClone(carry);
  }
  function fail(fallenCount = 0): void {
    const session = harness.sessions.at(-1)!;
    session.lastFallenCoinIds = session.frame.coins.slice(0, fallenCount).map(coin => coin.id);
    session.frame.coins = session.frame.coins.slice(fallenCount);
    session.view = { ...session.view, phase: 'failed', foulReasons: fallenCount ? ['FALL'] : ['MISS'], remaining: session.frame.coins.length };
    frames();
  }

  it('enters four random coins directly and gates input until exactly one landing per new coin', async () => {
    await initialize(); await start();
    expect(root.querySelector('[data-level-id]')).toBeNull();
    expect(harness.inputState!().view).toBeNull();
    expect(node('[data-el="modal-layer"]').hidden).toBe(true);
    frames(90);
    expect(harness.inputState!().view?.phase).toBe('selecting');
    expect(harness.play.mock.calls.filter(([kind]) => kind === 'land')).toHaveLength(4);
    frames(30);
    expect(harness.play.mock.calls.filter(([kind]) => kind === 'land')).toHaveLength(4);
  });

  it('suspends background music when either the home screen or game becomes hidden', async () => {
    await initialize();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(harness.suspendSound).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    await start(); frames(90);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(harness.suspendSound).toHaveBeenCalledTimes(2);
    expect(harness.sessions.at(-1)!.view.phase).toBe('paused');
    hidden.mockRestore();
  });

  it('automatically carries the last coin and score into seven coins without a success modal or next click', async () => {
    await initialize(); await start(); frames(90);
    const session = harness.sessions.at(-1)!;
    const carry = complete();
    expect(node('[data-el="modal-layer"]').hidden).toBe(true);
    expect(harness.inputState!().view).toBeNull();
    frames(130);
    expect(session.advanceRound).toHaveBeenCalledTimes(1);
    expect(session.frame.coins).toHaveLength(7);
    expect(session.frame.coins.find(coin => coin.id === carry.id)).toEqual(carry);
    expect(session.view).toMatchObject({ scores: [3, 0], activeCoinId: carry.id, canSelectCoin: false, phase: 'ready' });
    expect(harness.arrivals.at(-1)).toHaveLength(6);
    expect(harness.arrivals.at(-1)).not.toContain(carry.id);
    expect(harness.sessions).toHaveLength(2); // preview plus one persistent campaign session
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toMatchObject({ bestScore: 3 });
  });

  it('freezes clearing during pause and returns home without resurrecting a pending round', async () => {
    await initialize(); await start(); frames(90); complete();
    const session = harness.sessions.at(-1)!;
    node<HTMLButtonElement>('[data-action="pause"]').click(); frames(120);
    expect(session.advanceRound).not.toHaveBeenCalled();
    node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(130);
    expect(session.advanceRound).toHaveBeenCalledTimes(1);
    complete();
    const stopped = harness.stopSounds.mock.calls.length;
    node<HTMLButtonElement>('[data-action="pause"]').click();
    node<HTMLButtonElement>('[data-action="home"]').click();
    await vi.waitFor(() => expect(node('.flick-shell').dataset.screen).toBe('home'));
    frames(120);
    expect(session.advanceRound).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(harness.stopSounds).toHaveBeenCalledTimes(stopped + 1);
  });

  it.each(['arriving', 'clearing'] as const)('restarts from settings during paused %s without resuming the old round', async (transition) => {
    await initialize(); await start();
    if (transition === 'clearing') { frames(90); complete(); }
    const old = harness.sessions.at(-1)!;
    node<HTMLButtonElement>('[data-action="pause"]').click();
    frames();
    expect(old.view.phase).toBe('paused');
    expect(harness.inputState!().view).toBeNull();
    const restart = node<HTMLButtonElement>('[data-el="modal-secondary"]');
    expect(restart.dataset.action).toBe('retry');
    restart.click();
    await vi.waitFor(() => expect(harness.sessions.at(-1)).not.toBe(old));
    frames(130);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(old.advanceRound).not.toHaveBeenCalled();
    expect(harness.sessions.at(-1)!.view).toMatchObject({ phase: 'selecting', scores: [0, 0], remaining: 4 });
    expect(harness.inputState!().view?.phase).toBe('selecting');
  });

  it.each([0, 2, 4])('uses three revivals, keeps score/poses and replenishes exactly %s fallen coins', async (fallenCount) => {
    await initialize(); await start(); frames(90);
    const session = harness.sessions.at(-1)!;
    session.view.scores = [2, 0]; frames(); fail(fallenCount);
    const survivors = structuredClone(session.frame.coins);
    expect(node<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('revive');
    node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(90);
    expect(session.revive).toHaveBeenCalledTimes(1);
    expect(session.frame.coins).toHaveLength(4);
    for (const coin of survivors) expect(session.frame.coins.find(item => item.id === coin.id)).toEqual(coin);
    expect(harness.arrivals.at(-1)).toHaveLength(fallenCount);
    expect(session.view).toMatchObject({ scores: [2, 0], canSelectCoin: true, activeCoinId: null, phase: 'selecting' });
    expect(node('[data-el="revive-count"]').textContent).toContain('2 次');
    for (const allowance of [1, 0]) {
      fail();
      expect(node<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('revive');
      node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(90);
      expect(node('[data-el="revive-count"]').textContent).toContain(`${allowance} 次`);
    }
    expect(session.revive).toHaveBeenCalledTimes(3);
    fail();
    expect(node<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('retry');
    expect(root.querySelector('[data-action="revive"]')).toBeNull();
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toMatchObject({ bestScore: 2 });
  });

  it('introduces iron and marble exactly in their first campaign round and clears their next-round tips', async () => {
    await initialize(); await start(); frames(90);
    expect(node('[data-el="revive-count"]').textContent).toContain('3 次');
    const next = () => { complete(); frames(180); };
    next();
    expect(node('[data-el="tutorial-tip"]').textContent).not.toContain('青色铁币');
    next();
    expect(node('[data-el="tutorial-tip"]').textContent).not.toContain('青色铁币');
    next();
    expect(node('[data-el="tutorial-tip"]').textContent).toContain('青色铁币重量和摩擦力更大');
    next();
    expect(node('[data-el="tutorial-tip"]').textContent).toContain('大理石桌面比木头桌面更容易滑行，摩擦力更低');
    expect(node('[data-el="tutorial-tip"]').textContent).not.toContain('青色铁币');
    next();
    expect(node('[data-el="tutorial-tip"]').textContent).not.toContain('大理石桌面');
  });

  it.each(['boot', 'entry'] as const)('retries a failed hand load at %s without leaving a stale loading gate', async (stage) => {
    if (stage === 'entry') await initialize();
    harness.handLoad.mockRejectedValueOnce(new Error('Hand model request failed (503)'));
    if (stage === 'boot') { app = new GameApp(root); await app.initialize(); }
    else node<HTMLButtonElement>('[data-action="challenge"]').click();
    await vi.waitFor(() => expect(node('[data-el="modal-description"]').textContent).toContain('503'));
    const count = harness.handLoad.mock.calls.length;
    node<HTMLButtonElement>('[data-el="modal-primary"]').click();
    await vi.waitFor(() => expect(harness.handLoad).toHaveBeenCalledTimes(count + 1));
    await vi.waitFor(() => expect(node('[data-el="modal-layer"]').hidden).toBe(true));
    expect(node('.flick-shell').dataset.screen).toBe(stage === 'boot' ? 'home' : 'game');
  });

  it.each(['corrupt-json', 'read-security-error'] as const)('%s leaves random play available', async (failure) => {
    if (failure === 'corrupt-json') storage.getItem.mockReturnValue('{broken');
    else storage.getItem.mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    await initialize();
    expect(node('[data-el="notice"]').hidden).toBe(false);
    await start(); frames(90);
    expect(harness.inputState!().view?.phase).toBe('selecting');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('continues the next round after a quota failure and keeps dismissed notices hidden', async () => {
    storage.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await initialize(); await start(); frames(90); complete();
    expect(node('[data-el="notice"]').hidden).toBe(false);
    expect(node('[data-el="notice-message"]').textContent).toContain('未保存');
    node<HTMLButtonElement>('[data-action="dismiss-notice"]').click(); frames(130);
    expect(harness.sessions.at(-1)!.advanceRound).toHaveBeenCalledTimes(1);
    expect(node('[data-el="notice"]').hidden).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(node('[data-el="modal-layer"]').hidden).toBe(true);
  });

  it('migrates old completed levels as preferences and shows the stored local best without selection', async () => {
    storage.getItem.mockReturnValue(JSON.stringify({ schemaVersion: 1, completed: [LEVELS[2].id], sound: false, bestScore: 21 }));
    await initialize();
    expect(node('[data-el="progress"]').textContent).toContain('21');
    expect(node<HTMLButtonElement>('[data-el="sound"]').getAttribute('aria-pressed')).toBe('false');
    await start(); frames(90);
    expect(root.querySelector('[data-level-id]')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
