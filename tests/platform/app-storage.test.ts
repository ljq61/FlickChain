// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '../../src/app/GameApp';
import { LEVELS } from '../../src/content/levels';
import type { AiShot } from '../../src/ai/AIClient';
import type { SessionSnapshot } from '../../src/core/GameSession';
import type { BattleVariant, CoinTransform, GameMode, GameView, LevelConfig, WorldFrame } from '../../src/types/contracts';

const harness = vi.hoisted(() => ({
  sessions: [] as Array<{
    view: GameView; frame: WorldFrame; lastFallenCoinIds: string[];
    dispose: ReturnType<typeof vi.fn>; advanceRound: ReturnType<typeof vi.fn>; revive: ReturnType<typeof vi.fn>;
    shoot: ReturnType<typeof vi.fn>; selectCoin: ReturnType<typeof vi.fn>; refill: ReturnType<typeof vi.fn>; exportSnapshot: ReturnType<typeof vi.fn>;
  }>,
  creations: [] as Array<{ level: LevelConfig; mode: GameMode; firstPlayer: 0 | 1 }>,
  openings: [] as Array<{ view: GameView; frame: WorldFrame; level: LevelConfig; shoot: ReturnType<typeof vi.fn>; advance: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  aiRequests: [] as Array<{ kind: 'opening' | 'battle'; payload: LevelConfig | SessionSnapshot; resolve: (decision: AiShot | number) => void; reject: (error: Error) => void }>,
  cancelAI: vi.fn(), disposeAI: vi.fn(), resetView: vi.fn(),
  handLoad: vi.fn(async () => {}),
  inputState: null as null | (() => { view: GameView | null; frame: WorldFrame | null }),
  inputCallbacks: null as null | { pickCoin: (id: string) => void; shoot: (direction: { x: number; z: number }, power: number) => void },
  play: vi.fn(), stopSounds: vi.fn(), suspendSound: vi.fn(), arrivals: [] as string[][],
}));

// App, Shell, generator and storage remain real. Physics and renderer are tested separately.
vi.mock('../../src/core/GameSession', () => ({ GameSession: {
  create: vi.fn(async (level: LevelConfig, mode: GameMode, firstPlayer: 0 | 1 = 0) => {
    harness.creations.push({ level: structuredClone(level), mode, firstPlayer });
    let config = level;
    const frameFor = (next: LevelConfig, retained: CoinTransform[] = []): WorldFrame => ({
      table: next.table, obstacles: next.obstacles,
      coins: next.coins.map(coin => retained.find(item => item.id === coin.id) ?? {
        id: coin.id, materialId: coin.materialId, position: { x: coin.x, y: 0.004, z: coin.z }, rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    });
    let paused: GameView['phase'] = 'selecting';
    const session = {
      view: { sessionId: `app-test-${harness.sessions.length}`, revision: 0, mode, phase: 'selecting', levelId: level.id,
        activeCoinId: null, canSelectCoin: true, currentPlayer: firstPlayer, scores: [0, 0], remaining: level.coins.length,
        chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null } as GameView,
      frame: frameFor(level), lastFallenCoinIds: [] as string[],
      tick: vi.fn(), drainFeedback: () => [], dispose: vi.fn(),
      selectCoin: vi.fn((id: string) => { session.view = { ...session.view, phase: 'ready', activeCoinId: id, revision: session.view.revision + 1 }; return true; }),
      shoot: vi.fn(() => { session.view = { ...session.view, phase: 'simulating', revision: session.view.revision + 1 }; return true; }),
      pause() { paused = session.view.phase; session.view = { ...session.view, phase: 'paused', revision: session.view.revision + 1 }; },
      resume() { session.view = { ...session.view, phase: paused, revision: session.view.revision + 1 }; },
      exportSnapshot: vi.fn(() => ({ view: structuredClone(session.view), lastFallenIds: [...session.lastFallenCoinIds],
        physics: { version: 'app-test', level: structuredClone(config), bytes: new Uint8Array([9, 5]), tableHandle: 0,
          coins: session.frame.coins.map((coin, index) => ({ id: coin.id, materialId: coin.materialId, bodyHandle: index, colliderHandle: index, free: false, supportSteps: 0 })),
          fallen: [], frozen: false, obstacles: [], shotSourceId: null, shotTargets: [], pendingImpactTargets: [] } })),
      refill: vi.fn((next: LevelConfig) => {
        config = next; session.frame = frameFor(next, session.frame.coins);
        session.view = { ...session.view, phase: session.view.canSelectCoin ? 'selecting' : 'ready', levelId: next.id, remaining: next.coins.length,
          revision: session.view.revision + 1, foulReasons: [], lastResult: null };
        return true;
      }),
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
vi.mock('../../src/core/OpeningSession', () => ({ OpeningSession: {
  create: vi.fn(async (level: LevelConfig, variant: BattleVariant) => {
    let paused: GameView['phase'] = 'ready';
    const session = {
      level, frame: { table: level.table, obstacles: [], coins: level.coins.map(coin => ({ id: coin.id, materialId: coin.materialId,
        position: { x: coin.x, y: .004, z: coin.z }, rotation: { x: 0, y: 0, z: 0, w: 1 } })) } as WorldFrame,
      view: { sessionId: `opening-app-test-${harness.openings.length}`, revision: 0, mode: 'battle', phase: 'ready', levelId: level.id,
        activeCoinId: level.activeCoinId, canSelectCoin: false, currentPlayer: 0, scores: [0, 0], remaining: 1,
        chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null,
        battle: { variant, stage: 'opening', distances: [null, null], fallen: [false, false], openingAttempt: 1 } } as GameView,
      tick: vi.fn(), drainFeedback: () => [], dispose: vi.fn(),
      shoot: vi.fn(() => { session.view = { ...session.view, phase: 'simulating', revision: session.view.revision + 1 }; return true; }),
      pause() { paused = session.view.phase; session.view = { ...session.view, phase: 'paused', revision: session.view.revision + 1 }; },
      resume() { session.view = { ...session.view, phase: paused, revision: session.view.revision + 1 }; },
      advance: vi.fn(async () => {
        if (session.view.winner !== null) return false;
        const repeat = session.view.currentPlayer === 1;
        session.view = { ...session.view, phase: 'ready', currentPlayer: repeat ? 0 : 1, activeCoinId: level.activeCoinId,
          revision: session.view.revision + 1, battle: { ...session.view.battle!,
            ...(repeat ? { distances: [null, null] as [null, null], fallen: [false, false] as [boolean, boolean], openingAttempt: session.view.battle!.openingAttempt + 1 } : {}) } };
        return true;
      }),
    };
    harness.openings.push(session); return session;
  }),
} }));
vi.mock('../../src/ai/AIClient', () => ({ AIClient: class {
  choose(payload: SessionSnapshot) { return this.request('battle', payload); }
  chooseOpening(payload: LevelConfig) { return this.request('opening', payload); }
  private request(kind: 'opening' | 'battle', payload: LevelConfig | SessionSnapshot) {
    return new Promise<AiShot | number>((resolve, reject) => { harness.aiRequests.push({ kind, payload, resolve, reject }); });
  }
  // Leave old promises unresolved so tests can inject a late worker response after cancellation.
  cancel = harness.cancelAI; dispose = harness.disposeAI;
} }));
vi.mock('../../src/rendering/SceneManager', async () => {
  const { CoinArrival } = await import('../../src/rendering/CoinArrival');
  return { SceneManager: class {
    arrival = new CoinArrival(); clearing = 0;
    initializeHand = harness.handLoad; setLevel = vi.fn(); resetView = harness.resetView; render = vi.fn(); focusCoin = vi.fn(); clearFocus = vi.fn(); dispose = vi.fn();
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
    harness.sessions.length = 0; harness.creations.length = 0; harness.openings.length = 0; harness.aiRequests.length = 0;
    harness.arrivals.length = 0; harness.inputState = null; harness.inputCallbacks = null;
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
    expect(node('.remaining-cell').textContent).toBe('2次机会');
    for (const allowance of [1, 0]) {
      fail();
      expect(node<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('revive');
      node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(90);
      expect(node('.remaining-cell').textContent).toBe(`${allowance}次机会`);
    }
    expect(session.revive).toHaveBeenCalledTimes(3);
    fail();
    expect(node<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('retry');
    expect(root.querySelector('[data-action="revive"]')).toBeNull();
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toMatchObject({ bestScore: 2 });
  });

  it('introduces iron and marble exactly in their first campaign round and clears their next-round tips', async () => {
    await initialize(); await start(); frames(90);
    expect(node('.remaining-cell').textContent).toBe('3次机会');
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

  describe('local Battle route and asynchronous turn ownership', () => {
    async function startBattle(variant: BattleVariant = 'pvp') {
      node<HTMLButtonElement>('[data-action="battle"]').click();
      expect(harness.openings).toHaveLength(0);
      expect(node('[data-el="battle-actions"]').hidden).toBe(false);
      node<HTMLButtonElement>(`[data-action="${variant}"]`).click();
      await vi.waitFor(() => expect(harness.openings).toHaveLength(1));
      frames(90);
      return harness.openings[0];
    }
    function settleTrial(distance: number, fallen = false, winner: 0 | 1 | null = null): void {
      const opening = harness.openings.at(-1)!;
      const battle = structuredClone(opening.view.battle!);
      battle.distances[opening.view.currentPlayer] = distance;
      battle.fallen[opening.view.currentPlayer] = fallen;
      opening.view = { ...opening.view, phase: 'complete', activeCoinId: null, revision: opening.view.revision + 1, battle, winner };
      frames();
    }
    async function reachBattle(variant: BattleVariant = 'pvp', firstPlayer: 0 | 1 = 0) {
      const opening = await startBattle(variant);
      settleTrial(.7);
      frames(90);
      await vi.waitFor(() => expect(opening.view).toMatchObject({ phase: 'ready', currentPlayer: 1 }));
      frames(90);
      settleTrial(firstPlayer === 0 ? .5 : .9, false, firstPlayer);
      frames(90);
      await vi.waitFor(() => expect(harness.sessions.at(-1)!.view.mode).toBe('battle'));
      frames(90);
      return harness.sessions.at(-1)!;
    }
    function battleDecision(session = harness.sessions.at(-1)!): AiShot {
      return { coinId: session.frame.coins[0].id, direction: { x: 1, z: 0 }, power: .43 };
    }

    it.each(['pvp', 'pve'] as const)('routes %s through two timed trials and passes the elected player into a fresh nine-coin game', async variant => {
      await initialize();
      const opening = await startBattle(variant);
      expect(opening.level).toMatchObject({ purpose: 'opening', obstacles: [] });
      expect(opening.frame.coins).toHaveLength(1);
      expect(opening.frame.coins[0]).toMatchObject({ materialId: 'standard', position: { x: 0, z: .64 } });
      expect(harness.creations.filter(({ mode }) => mode === 'battle')).toHaveLength(0);
      expect(harness.inputState!().view).toMatchObject({ inputOwner: 'human', canSelectCoin: false, battle: { stage: 'opening', variant } });
      harness.inputCallbacks!.shoot({ x: 0, z: -1 }, .45);
      expect(opening.shoot).toHaveBeenCalledExactlyOnceWith({ x: 0, z: -1 }, .45);
      settleTrial(.55);
      frames(60);
      expect(opening.advance).not.toHaveBeenCalled();
      expect(node('[data-el="modal-layer"]').hidden).toBe(true);
      frames(30);
      await vi.waitFor(() => expect(opening.view.currentPlayer).toBe(1));
      expect(opening.advance).toHaveBeenCalledTimes(1);
      frames(90);
      settleTrial(.82, false, 1);
      frames(90);
      await vi.waitFor(() => expect(harness.creations.at(-1)!.mode).toBe('battle'));
      const created = harness.creations.at(-1)!;
      expect(created.firstPlayer).toBe(1);
      expect(created.level.coins).toHaveLength(9);
      expect(created.level.obstacles.length).toBeGreaterThanOrEqual(1);
      expect(created.level.obstacles.length).toBeLessThanOrEqual(5);
      expect(created.level.coins.every(coin => ['standard', 'iron'].includes(coin.materialId))).toBe(true);
      expect(created.level.table).toEqual(opening.level.table);
      expect(opening.dispose).toHaveBeenCalledExactlyOnceWith();
      expect(harness.sessions.at(-1)!.view).toMatchObject({ currentPlayer: 1, scores: [0, 0], remaining: 9 });
      expect(harness.inputState!().view).toBeNull(); // arrival, then computer when PVE
      frames(90);
      expect(node('[data-el="mode"]').textContent).toBe(variant === 'pve' ? '人机抢 5 分' : '双人抢 5 分');
      expect(harness.inputState!().view?.currentPlayer ?? null).toBe(variant === 'pve' ? null : 1);
      expect(harness.resetView).toHaveBeenCalledTimes(3);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('repeats tied trials and freezes the comparison delay while paused', async () => {
      await initialize();
      const opening = await startBattle();
      settleTrial(.6);
      node<HTMLButtonElement>('[data-action="pause"]').click(); frames(200);
      expect(opening.advance).not.toHaveBeenCalled();
      node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(90);
      await vi.waitFor(() => expect(opening.view.currentPlayer).toBe(1));
      frames(90); settleTrial(.6); frames(90);
      await vi.waitFor(() => expect(opening.view.battle?.openingAttempt).toBe(2));
      expect(opening.view).toMatchObject({ currentPlayer: 0, phase: 'ready', battle: { distances: [null, null], fallen: [false, false] } });
      expect(harness.creations.filter(({ mode }) => mode === 'battle')).toHaveLength(0);
      expect(node('[data-el="modal-layer"]').hidden).toBe(true);
    });

    it.each([0, 1])('refills %s surviving coins without resetting scores, turn, or fixed relay ownership', async retainedCount => {
      await initialize();
      const session = await reachBattle();
      const carry = structuredClone(session.frame.coins.at(-1)!);
      session.frame.coins = retainedCount ? [carry] : [];
      session.view = { ...session.view, phase: 'refilling', scores: [3, 2], currentPlayer: 0, remaining: retainedCount,
        activeCoinId: retainedCount ? carry.id : null, canSelectCoin: !retainedCount };
      frames();
      expect(session.refill).toHaveBeenCalledTimes(1);
      expect(session.view).toMatchObject({ scores: [3, 2], currentPlayer: 0, remaining: 9, canSelectCoin: !retainedCount,
        activeCoinId: retainedCount ? carry.id : null, phase: retainedCount ? 'ready' : 'selecting' });
      if (retainedCount) expect(session.frame.coins.find(coin => coin.id === carry.id)).toEqual(carry);
      expect(harness.arrivals.at(-1)).toHaveLength(9 - retainedCount);
      expect(harness.arrivals.at(-1)).not.toContain(carry.id);
      expect(harness.inputState!().view).toBeNull();
      frames(90);
      expect(harness.inputState!().view?.phase).toBe(retainedCount ? 'ready' : 'selecting');
      expect(node('[data-el="score-one"]').textContent).toBe('3');
      expect(node('[data-el="score-two"]').textContent).toBe('2');
      expect(harness.creations.filter(({ mode }) => mode === 'battle')).toHaveLength(1);
    });

    it('restarts computer search from the refilled board while preserving the locked relay and scores', async () => {
      await initialize();
      const session = await reachBattle('pve', 1); frames(35);
      const initial = harness.aiRequests.slice().reverse().find(item => item.kind === 'battle')!;
      initial.resolve(battleDecision(session)); await Promise.resolve(); frames(55);
      expect(session.shoot).toHaveBeenCalledTimes(1);
      const carry = structuredClone(session.frame.coins.at(-1)!);
      session.frame.coins = [carry];
      session.view = { ...session.view, phase: 'refilling', scores: [3, 4], currentPlayer: 1,
        remaining: 1, activeCoinId: carry.id, canSelectCoin: false, revision: session.view.revision + 1 };
      frames();
      expect(session.refill).toHaveBeenCalledTimes(1);
      expect(harness.inputState!().view).toBeNull();
      frames(130);
      const fresh = harness.aiRequests.slice().reverse().find(item => item.kind === 'battle')!;
      expect(fresh).not.toBe(initial);
      expect((fresh.payload as SessionSnapshot).view).toMatchObject({ remaining: 9, scores: [3, 4], activeCoinId: carry.id, canSelectCoin: false });
      expect(session.frame.coins.find(coin => coin.id === carry.id)).toEqual(carry);
      const shot = { ...battleDecision(session), coinId: carry.id };
      fresh.resolve(shot); await Promise.resolve(); frames(55);
      expect(session.shoot).toHaveBeenCalledTimes(2);
      expect(session.shoot).toHaveBeenLastCalledWith(shot.direction, shot.power);
      expect(session.selectCoin).toHaveBeenCalledTimes(1); // initial free choice only
      expect(harness.inputState!().view).toBeNull();
    });

    it('uses the opening AI request while blocking human actions and then fires only the accepted computer decision', async () => {
      await initialize();
      const opening = await startBattle('pve');
      settleTrial(.65); frames(90);
      await vi.waitFor(() => expect(opening.view.currentPlayer).toBe(1));
      frames(90);
      const request = harness.aiRequests.at(-1)!;
      expect(request.kind).toBe('opening'); expect(request.payload).toEqual(opening.level);
      expect(harness.inputState!().view).toBeNull();
      harness.inputCallbacks!.shoot({ x: 1, z: 0 }, 1); harness.inputCallbacks!.pickCoin(opening.level.activeCoinId);
      expect(opening.shoot).not.toHaveBeenCalled();
      request.resolve(.64); await Promise.resolve(); frames(55);
      expect(opening.shoot).toHaveBeenCalledExactlyOnceWith({ x: 0, z: -1 }, .64);
      expect(opening.view.phase).toBe('simulating');
      expect(harness.play).toHaveBeenCalledWith('flick', .64);
    });

    it('passes the exact settled snapshot to normal AI and restores human controls after the turn changes', async () => {
      await initialize();
      const session = await reachBattle('pve', 1);
      frames(35);
      const request = harness.aiRequests.slice().reverse().find(item => item.kind === 'battle')!;
      expect(request).toBeDefined();
      expect(session.exportSnapshot).toHaveBeenCalledTimes(1);
      expect(request.payload).toEqual(session.exportSnapshot.mock.results[0].value);
      expect((request.payload as SessionSnapshot).view).toMatchObject({ currentPlayer: 1, phase: 'selecting', remaining: 9 });
      expect(harness.inputState!().view).toBeNull();
      harness.inputCallbacks!.pickCoin(session.frame.coins[0].id); harness.inputCallbacks!.shoot({ x: 1, z: 0 }, .9);
      expect(session.selectCoin).not.toHaveBeenCalled(); expect(session.shoot).not.toHaveBeenCalled();
      const shot = battleDecision(session);
      request.resolve(shot); await Promise.resolve(); frames(55);
      expect(session.selectCoin).toHaveBeenCalledExactlyOnceWith(shot.coinId);
      expect(session.shoot).toHaveBeenCalledExactlyOnceWith(shot.direction, shot.power);
      expect(harness.inputState!().view).toBeNull();
      session.view = { ...session.view, phase: 'selecting', currentPlayer: 0, activeCoinId: null, canSelectCoin: true, revision: session.view.revision + 1 };
      frames();
      expect(harness.inputState!().view).toMatchObject({ inputOwner: 'human', currentPlayer: 0, canSelectCoin: true });
      expect(node('[data-el="prompt-title"]').textContent).toBe('点选一枚硬币直接开始');
    });

    it.each(['pause', 'home', 'restart', 'dispose'] as const)('%s cancels a pending computer result so the old turn never shoots', async action => {
      await initialize();
      const session = await reachBattle('pve', 1); frames(35);
      const request = harness.aiRequests.slice().reverse().find(item => item.kind === 'battle')!;
      expect(request).toBeDefined();
      const cancelledBefore = harness.cancelAI.mock.calls.length;
      if (action === 'dispose') app!.dispose();
      else {
        node<HTMLButtonElement>('[data-action="pause"]').click(); frames();
        if (action === 'home') node<HTMLButtonElement>('[data-el="modal-tertiary"]').click();
        else if (action === 'restart') node<HTMLButtonElement>('[data-el="modal-secondary"]').click();
      }
      if (action !== 'dispose') expect(harness.cancelAI.mock.calls.length).toBeGreaterThan(cancelledBefore);
      request.resolve(battleDecision(session)); await Promise.resolve();
      if (action === 'dispose') {
        expect(harness.disposeAI).toHaveBeenCalledTimes(1);
      } else if (action === 'pause') {
        frames(100); expect(session.view.phase).toBe('paused');
        node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(40);
        const fresh = harness.aiRequests.slice().reverse().find(item => item.kind === 'battle')!;
        expect(fresh).not.toBe(request);
        expect(session.shoot).not.toHaveBeenCalled();
        fresh.resolve(battleDecision(session)); await Promise.resolve(); frames(55);
        expect(session.shoot).toHaveBeenCalledTimes(1);
      } else if (action === 'home') {
        await vi.waitFor(() => expect(node('.flick-shell').dataset.screen).toBe('home')); frames(100);
        expect(session.dispose).toHaveBeenCalledTimes(1);
        expect(node('[data-el="main-actions"]').hidden).toBe(false);
      } else {
        await vi.waitFor(() => expect(harness.openings).toHaveLength(2)); frames(100);
        expect(session.dispose).toHaveBeenCalledTimes(1);
        expect(harness.openings.at(-1)!.view).toMatchObject({ phase: 'ready', currentPlayer: 0, scores: [0, 0], battle: { variant: 'pve', stage: 'opening' } });
        expect(harness.openings.at(-1)!.shoot).not.toHaveBeenCalled();
      }
      expect(session.shoot).toHaveBeenCalledTimes(action === 'pause' ? 1 : 0);
    });

    it.each(['pause', 'home', 'restart', 'dispose'] as const)('%s also cancels a late opening AI response', async action => {
      await initialize();
      const opening = await startBattle('pve');
      settleTrial(.65); frames(90);
      await vi.waitFor(() => expect(opening.view.currentPlayer).toBe(1));
      frames(90);
      const request = harness.aiRequests.at(-1)!;
      expect(request.kind).toBe('opening');
      if (action === 'dispose') app!.dispose();
      else {
        node<HTMLButtonElement>('[data-action="pause"]').click(); frames();
        if (action === 'home') node<HTMLButtonElement>('[data-el="modal-tertiary"]').click();
        else if (action === 'restart') node<HTMLButtonElement>('[data-el="modal-secondary"]').click();
      }
      request.resolve(.7); await Promise.resolve();
      if (action === 'pause') {
        frames(100);
        expect(opening.shoot).not.toHaveBeenCalled();
        node<HTMLButtonElement>('[data-el="modal-primary"]').click(); frames(40);
        const fresh = harness.aiRequests.at(-1)!;
        expect(fresh).not.toBe(request); expect(fresh.kind).toBe('opening');
        fresh.resolve(.58); await Promise.resolve(); frames(55);
        expect(opening.shoot).toHaveBeenCalledExactlyOnceWith({ x: 0, z: -1 }, .58);
      } else if (action === 'home') {
        await vi.waitFor(() => expect(node('.flick-shell').dataset.screen).toBe('home')); frames(100);
        expect(opening.dispose).toHaveBeenCalledTimes(1);
      } else if (action === 'restart') {
        await vi.waitFor(() => expect(harness.openings).toHaveLength(2)); frames(100);
        expect(opening.dispose).toHaveBeenCalledTimes(1);
        expect(harness.openings.at(-1)!.shoot).not.toHaveBeenCalled();
      } else expect(harness.disposeAI).toHaveBeenCalledTimes(1);
      expect(opening.shoot).toHaveBeenCalledTimes(action === 'pause' ? 1 : 0);
    });

    it('shows first-to-five victory without refilling or advancing the old board', async () => {
      await initialize();
      const session = await reachBattle();
      session.view = { ...session.view, phase: 'complete', winner: 0, scores: [5, 3], remaining: 1 };
      frames(150);
      expect(session.refill).not.toHaveBeenCalled(); expect(session.advanceRound).not.toHaveBeenCalled();
      expect(node('[data-el="modal-layer"]').hidden).toBe(false);
      expect(node('[data-el="modal-title"]').textContent).toBe('玩家一获胜');
      expect(node('[data-el="modal-score"]').textContent).toBe('玩家一 5  :  3 玩家二');
      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });
});
