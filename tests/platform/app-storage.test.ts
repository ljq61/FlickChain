// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '../../src/app/GameApp';
import { LEVELS } from '../../src/content/levels';
import type { GameMode, GameView, LevelConfig, WorldFrame } from '../../src/types/contracts';

// Rendering, hardware input, sound and physics are outside this persistence test.
// GameApp, Shell, SaveAdapter and the shipped level catalog remain real.
const harness = vi.hoisted(() => ({
  sessions: [] as Array<{ view: GameView; frame: WorldFrame; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('../../src/core/GameSession', () => ({
  GameSession: {
    create: vi.fn(async (level: LevelConfig, mode: GameMode) => {
      const session = {
        view: {
          sessionId: `storage-test-${harness.sessions.length}`,
          revision: 0,
          mode,
          phase: 'ready' as const,
          levelId: level.id,
          activeCoinId: level.activeCoinId,
          currentPlayer: 0 as const,
          scores: [0, 0] as [number, number],
          remaining: level.coins.length,
          chain: 0,
          shotCount: 0,
          foulReasons: [],
          lastResult: null,
          winner: null,
          error: null,
        },
        frame: { coins: [], table: level.table, obstacles: level.obstacles },
        tick: vi.fn(),
        drainFeedback: () => [],
        dispose: vi.fn(),
      };
      harness.sessions.push(session);
      return session;
    }),
  },
}));

vi.mock('../../src/rendering/SceneManager', () => ({
  SceneManager: class { setLevel = vi.fn(); render = vi.fn(); focusCoin = vi.fn(); clearFocus = vi.fn(); dispose = vi.fn(); },
}));
vi.mock('../../src/input/PointerInput', () => ({
  PointerInput: class { cancel = vi.fn(); dispose = vi.fn(); charge = vi.fn(() => null); },
}));
vi.mock('../../src/ui/SoundManager', () => ({
  SoundManager: class {
    enabled = true;
    unlock = vi.fn(); play = vi.fn(); slide = vi.fn(); suspend = vi.fn(); dispose = vi.fn();
  },
}));

describe('app progress recovery and non-blocking save notices', () => {
  let root: HTMLDivElement;
  let app: GameApp | undefined;
  let raf: FrameRequestCallback | undefined;
  let frameTime: number;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    harness.sessions.length = 0;
    frameTime = 0;
    raf = undefined;
    root = document.createElement('div');
    document.body.append(root);
    storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      raf = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    app?.dispose();
    app = undefined;
    root.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const node = root.querySelector<T>(selector);
    expect(node, selector).not.toBeNull();
    return node!;
  }

  function advanceFrame(): void {
    expect(raf).toBeDefined();
    const callback = raf!;
    raf = undefined;
    frameTime += 16;
    callback(frameTime);
  }

  async function initialize(): Promise<void> {
    app = new GameApp(root);
    await app.initialize();
    expect(element('[data-el="loading"]').hidden).toBe(true);
  }

  async function startLevel(index = 0): Promise<void> {
    element<HTMLButtonElement>('[data-action="levels"]').click();
    const button = element<HTMLButtonElement>(`[data-level-id="${LEVELS[index].id}"]`);
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => {
      expect(element('.flick-shell').dataset.screen).toBe('game');
      expect(element('[data-el="level-name"]').textContent).toBe(LEVELS[index].name);
      expect(element('[data-el="loading"]').hidden).toBe(true);
    });
  }

  function completeCurrentLevel(): void {
    const session = harness.sessions.at(-1)!;
    session.view = { ...session.view, phase: 'complete', scores: [LEVELS[0].coins.length - 1, 0], remaining: 1 };
    advanceFrame();
  }

  it.each(['corrupt-json', 'read-security-error'] as const)('%s keeps first-level play available', async (failure) => {
    if (failure === 'corrupt-json') storage.getItem.mockReturnValue('{broken-json');
    else storage.getItem.mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });

    await initialize();
    expect(storage.getItem).toHaveBeenCalledWith('flickchain.progress.v1');
    expect(element('[data-el="notice"]').hidden).toBe(false);
    expect(element('[data-el="notice-message"]').textContent).toContain('无法读取');
    expect(element('[data-el="modal-layer"]').hidden).toBe(true);
    expect(element<HTMLButtonElement>('[data-el="sound"]').getAttribute('aria-pressed')).toBe('true');
    await startLevel();
    advanceFrame();
    expect(element('.flick-shell').dataset.phase).toBe('ready');
    expect(element('[data-el="modal-layer"]').hidden).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('quota failure preserves the completed result, unlocks progress in memory and permits the next level', async () => {
    storage.setItem.mockImplementation(() => { throw new DOMException('Storage full', 'QuotaExceededError'); });
    await initialize();
    await startLevel();
    completeCurrentLevel();

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, raw] = storage.setItem.mock.calls[0];
    expect(key).toBe('flickchain.progress.v1');
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, completed: [LEVELS[0].id], sound: true });
    expect(element('.flick-shell').dataset.phase).toBe('complete');
    expect(element('[data-el="modal-title"]').textContent).toBe('接力完成！');
    expect(element('[data-el="notice"]').hidden).toBe(false);
    expect(element('[data-el="notice-message"]').textContent).toContain('未保存');
    expect(element<HTMLButtonElement>('[data-el="modal-primary"]').dataset.action).toBe('next');
    expect(document.activeElement).toBe(element('[data-el="modal-primary"]'));

    advanceFrame();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    element<HTMLButtonElement>('[data-el="modal-primary"]').click();
    await vi.waitFor(() => expect(element('[data-el="level-name"]').textContent).toBe(LEVELS[1].name));
    expect(element('.flick-shell').dataset.phase).toBe('ready');
    expect(element('[data-el="modal-layer"]').hidden).toBe(true);

    element<HTMLButtonElement>('[data-action="home"]').click();
    await vi.waitFor(() => expect(element('.flick-shell').dataset.screen).toBe('home'));
    element<HTMLButtonElement>('[data-action="levels"]').click();
    expect(element<HTMLButtonElement>(`[data-level-id="${LEVELS[0].id}"]`).dataset.status).toBe('complete');
    expect(element<HTMLButtonElement>(`[data-level-id="${LEVELS[1].id}"]`).disabled).toBe(false);
  });

  it('dismisses a save notice across subsequent frames and level loads without closing the result', async () => {
    storage.setItem.mockImplementation(() => { throw new DOMException('Storage full', 'QuotaExceededError'); });
    await initialize();
    await startLevel();
    completeCurrentLevel();
    element<HTMLButtonElement>('[data-action="dismiss-notice"]').click();
    expect(element('[data-el="notice"]').hidden).toBe(true);
    expect(element('[data-el="modal-layer"]').hidden).toBe(false);
    expect(element('[data-el="modal-title"]').textContent).toBe('接力完成！');
    advanceFrame();
    expect(element('[data-el="notice"]').hidden).toBe(true);
    element<HTMLButtonElement>('[data-el="modal-primary"]').click();
    await vi.waitFor(() => expect(element('[data-el="level-name"]').textContent).toBe(LEVELS[1].name));
    expect(element('[data-el="notice"]').hidden).toBe(true);
  });

  it('replays an already completed later level when its prerequisite is missing from the save', async () => {
    storage.getItem.mockReturnValue(JSON.stringify({ schemaVersion: 1, completed: [LEVELS[2].id], sound: false }));
    await initialize();
    expect(element<HTMLButtonElement>('[data-el="sound"]').getAttribute('aria-pressed')).toBe('false');
    expect(element<HTMLButtonElement>(`[data-level-id="${LEVELS[1].id}"]`).disabled).toBe(true);
    const completedButton = element<HTMLButtonElement>(`[data-level-id="${LEVELS[2].id}"]`);
    expect(completedButton.dataset.status).toBe('complete');
    expect(completedButton.getAttribute('aria-label')).toContain('可重玩');

    await startLevel(2);
    advanceFrame();
    expect(element('.flick-shell').dataset.phase).toBe('ready');
    expect(harness.sessions.at(-1)!.view.levelId).toBe(LEVELS[2].id);
    expect(element('[data-el="notice"]').hidden).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
