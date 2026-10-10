// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../../src/ui/Shell';
import type { GameView, LevelConfig } from '../../src/types/contracts';

const level: LevelConfig = {
  schemaVersion: 1,
  id: 'shell-test',
  name: '测试关卡',
  lesson: '测试提示',
  table: { width: 1.2, depth: 1.6, materialId: 'wood' },
  coins: [
    { id: 'A', x: -0.2, z: 0, materialId: 'standard' },
    { id: 'B', x: 0.2, z: 0, materialId: 'standard' },
  ],
  activeCoinId: 'A',
  obstacles: [],
};

function view(phase: GameView['phase']): GameView {
  return {
    sessionId: 'shell-session', revision: 0, mode: 'challenge', phase, levelId: level.id,
    activeCoinId: phase === 'ready' ? 'B' : null, canSelectCoin: true, currentPlayer: 0, scores: [0, 0], remaining: 2,
    chain: 0, shotCount: 0, foulReasons: [], lastResult: null, winner: null, error: null,
  };
}

describe('Shell instant coin start UI', () => {
  let root: HTMLDivElement;
  let shell: Shell;
  const callbacks = {
    start: vi.fn(), retry: vi.fn(), home: vi.fn(), next: vi.fn(), pause: vi.fn(), toggleSound: vi.fn(),
  };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    shell = new Shell(root, [level], callbacks);
  });

  afterEach(() => {
    shell.dispose();
    root.remove();
    vi.clearAllMocks();
  });

  it('starts directly from a tapped coin: no confirm button exists', () => {
    shell.render(view('selecting'), [], true);
    expect(root.querySelector('[data-el="selection-actions"]')).toBeNull();
    expect(root.querySelector('[data-el="confirm-selection"]')).toBeNull();
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('点选一枚硬币直接开始');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('立即成为当前币');
  });

  it('prompts the finger hold charge in the ready phase', () => {
    shell.render(view('ready'), [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('按住硬币后的手指蓄力');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('力度越大');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('可点其他硬币');
  });

  it('explains the fixed target after a relay', () => {
    shell.render({ ...view('ready'), canSelectCoin: false, chain: 1 }, [], true);
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('刚击中的硬币');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).not.toContain('可点其他硬币');
  });

  it('keeps the footer controls without a selection slot', () => {
    shell.render(view('selecting'), [], true);
    const controls = root.querySelector('[data-el="footer"] .play-controls')!;
    expect(controls.querySelectorAll('button').length).toBe(3);
  });
});
