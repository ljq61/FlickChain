// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerInput } from '../../src/input/PointerInput';
import type { SceneManager } from '../../src/rendering/SceneManager';
import type { GameView, WorldFrame } from '../../src/types/contracts';

describe('public launch choices and relay pointer ownership', () => {
  let canvas: HTMLCanvasElement;
  let input: PointerInput;
  let view: GameView;
  let now: number;
  let orbit: ReturnType<typeof vi.fn>;
  const pickCoin = vi.fn();
  const shoot = vi.fn();
  const frame: WorldFrame = {
    table: { width: 1.2, depth: 1.6, materialId: 'wood' }, obstacles: [],
    coins: ['A', 'B'].map((id, i) => ({ id, materialId: 'standard', position: { x: i * 0.2, y: 0.003, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })),
  };
  function pointer(type: string, x: number, y = 200, id = 1) {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, isPrimary: id === 1, button: 0, clientX: x, clientY: y }));
  }
  function tap(x: number) { pointer('pointerdown', x); pointer('pointerup', x); }
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    view = { sessionId: 'pointer-test', revision: 0, mode: 'challenge', phase: 'ready', levelId: 'test', activeCoinId: 'A', canSelectCoin: true, currentPlayer: 0, scores: [0, 0], remaining: 2, chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null };
    canvas = document.createElement('canvas'); document.body.append(canvas);
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn(); canvas.hasPointerCapture = vi.fn(() => false);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    orbit = vi.fn();
    const scene = {
      canvas, orbitBy: orbit, getAimDirection: () => ({ x: 1, z: 0 }),
      projectToScreen: (p: { x: number; z: number }) => ({ x: 200 + p.x * 1000, y: 200 + p.z * 1000 }),
      // One generous finger anchor overlaps B: coin selection must take priority.
      getFingerHitPoints: () => [{ x: 0.19, y: 0.02, z: 0 }, { x: -0.1, y: 0.02, z: 0 }],
    } as unknown as SceneManager;
    input = new PointerInput(scene, () => ({ view, frame }), { pickCoin, shoot });
  });
  afterEach(() => { input.dispose(); canvas.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
  it('selects another public coin before firing without charging the previous finger', () => {
    tap(400);
    expect(pickCoin).toHaveBeenCalledExactlyOnceWith('B'); expect(shoot).not.toHaveBeenCalled();
  });
  it('ignores non-active coins after relay but charges the actual finger', () => {
    view.canSelectCoin = false; view.chain = 1;
    pointer('pointerdown', 400); now += 700; pointer('pointerup', 400);
    expect(pickCoin).not.toHaveBeenCalled(); expect(shoot).not.toHaveBeenCalled();
    pointer('pointerdown', 100); now += 625;
    expect(input.charge()?.elapsedMs).toBe(625);
    pointer('pointerup', 100);
    expect(shoot).toHaveBeenCalledExactlyOnceWith({ x: 1, z: 0 }, 0.5);
  });
  it('entry and player exchange select on tap, while paused input is blocked', () => {
    view.phase = 'selecting'; view.activeCoinId = null; view.currentPlayer = 1;
    tap(400); expect(pickCoin).toHaveBeenCalledExactlyOnceWith('B');
    pickCoin.mockClear(); view.phase = 'paused'; tap(200);
    expect(pickCoin).not.toHaveBeenCalled(); expect(shoot).not.toHaveBeenCalled();
  });
  it('cancels a hold when another pointer arrives or the session revision changes', () => {
    pointer('pointerdown', 200); now += 700; pointer('pointerdown', 300, 200, 2);
    pointer('pointerup', 200); pointer('pointerup', 300, 200, 2);
    expect(shoot).not.toHaveBeenCalled(); expect(input.charge()).toBeNull();
    pointer('pointerdown', 200); now += 700; view.revision++;
    pointer('pointerup', 200); expect(shoot).not.toHaveBeenCalled();
  });
  it('a fast tap on the active coin never fires, and blank drag still rotates', () => {
    tap(200); expect(shoot).not.toHaveBeenCalled(); expect(pickCoin).not.toHaveBeenCalled();
    pointer('pointerdown', 650); pointer('pointermove', 680); pointer('pointerup', 680);
    expect(orbit).toHaveBeenCalledWith(30, 0);
  });
  it('rejects coins outside a circular rim even inside its rectangular bounding box', () => {
    const oldTable = frame.table;
    const oldPosition = frame.coins[1].position;
    try {
      frame.table = { shape: 'circle', width: 1, depth: 1, materialId: 'wood' };
      frame.coins[1].position = { x: .4, y: .003, z: .4 };
      pointer('pointerdown', 600, 600); now += 700; pointer('pointerup', 600, 600);
      expect(pickCoin).not.toHaveBeenCalled(); expect(shoot).not.toHaveBeenCalled();
      frame.coins[1].position = { x: .3, y: .003, z: .3 };
      pointer('pointerdown', 500, 500); pointer('pointerup', 500, 500);
      expect(pickCoin).toHaveBeenCalledExactlyOnceWith('B');
    } finally {
      frame.table = oldTable;
      frame.coins[1].position = oldPosition;
    }
  });
});
