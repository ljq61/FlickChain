// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../../src/ui/Shell';
import type { CampaignView, GameView, LevelConfig } from '../../src/types/contracts';

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

const campaign: CampaignView = { round: 3, score: 9, bestScore: 17, revivesRemaining: 3, transition: null };

describe('Shell instant coin start UI', () => {
  let root: HTMLDivElement;
  let shell: Shell;
  const callbacks = {
    start: vi.fn(), retry: vi.fn(), home: vi.fn(), next: vi.fn(), revive: vi.fn(), pause: vi.fn(), toggleSound: vi.fn(),
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

  it('keeps sound and settings in one corner rail, with no footer navigation', () => {
    shell.render(view('selecting'), [], true);
    const controls = root.querySelector('.topbar .corner-controls')!;
    const buttons = controls.querySelectorAll<HTMLButtonElement>('button');
    expect(Array.from(buttons, (button) => button.dataset.action)).toEqual(['sound', 'pause']);
    expect(buttons[1].getAttribute('aria-label')).toBe('设置');
    expect(buttons[1].hidden).toBe(false);
    expect(root.querySelector('[data-el="footer"] button')).toBeNull();
    buttons[1].click();
    expect(callbacks.pause).toHaveBeenCalledExactlyOnceWith();
    shell.render(null, [], true);
    expect(buttons[1].hidden).toBe(true);
    expect(buttons[0].hidden).toBe(false);
  });

  it('draws the home logo as paths while preserving its accessible name', () => {
    const title = root.querySelector('.menu-intro h1')!;
    expect(title.getAttribute('aria-label')).toBe('一弹到底');
    expect(title.querySelector('svg path')).not.toBeNull();
    expect(title.querySelector('svg text, svg image')).toBeNull();
  });

  it('enters single player immediately, with the local best score and no level list', () => {
    shell.render(null, [level.id], true, false, { ...campaign, round: 0 });
    expect(root.querySelector('[data-el="progress"]')!.textContent).toBe('本地最高 17 分');
    expect(root.querySelector('[data-el="levels"]')).toBeNull();
    expect(root.querySelector('[data-level-id]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="challenge"]')!.click();
    expect(callbacks.start).toHaveBeenCalledExactlyOnceWith('challenge', level.id);
    expect(callbacks.next).not.toHaveBeenCalled();
  });

  it('opens a secondary PVP/PVE choice before starting and restores home on return', () => {
    const battle = root.querySelector<HTMLButtonElement>('[data-action="battle"]')!;
    const pvp = root.querySelector<HTMLButtonElement>('[data-action="pvp"]')!;
    const pve = root.querySelector<HTMLButtonElement>('[data-action="pve"]')!;
    expect(battle.textContent).toBe('本地对战');
    battle.click();
    expect(callbacks.start).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="battle-actions"] .menu-progress')!.textContent).toBe('比远争先 · 先得 10 分获胜');
    expect(document.activeElement).toBe(pvp);
    shell.render(null, [], false);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(false);
    pvp.click();
    expect(callbacks.start).toHaveBeenCalledExactlyOnceWith('battle', level.id, 'pvp');
    callbacks.start.mockClear();
    pve.click();
    expect(callbacks.start).toHaveBeenCalledExactlyOnceWith('battle', level.id, 'pve');
    root.querySelector<HTMLButtonElement>('[data-action="battle-back"]')!.click();
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(battle);
    battle.click();
    shell.render({ ...view('ready'), mode: 'battle' }, [], true);
    shell.render(null, [], true);
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-el="live"]')!.textContent).toBe('');
  });

  it('keeps choices disabled during loading and returns a failed launch to the main menu', () => {
    root.querySelector<HTMLButtonElement>('[data-action="battle"]')!.click();
    shell.setLoading('正在准备对战');
    const pve = root.querySelector<HTMLButtonElement>('[data-action="pve"]')!;
    pve.click();
    expect(callbacks.start).not.toHaveBeenCalled();
    expect(pve.disabled).toBe(true);
    shell.setError('无法准备棋盘');
    root.querySelector<HTMLButtonElement>('[data-el="modal-secondary"]')!.click();
    expect(callbacks.home).toHaveBeenCalledOnce();
    shell.setError(null); shell.setLoading(null); shell.render(null, [], true);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(false);
  });

  it('shows points and remaining opportunities, with the small round below the panel and best in the footer', () => {
    shell.render({ ...view('ready'), remaining: 8 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('第 3 轮');
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('9');
    expect(root.querySelector('[data-el="player-one"]')!.textContent).toBe('9分');
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('3次机会');
    expect(root.querySelector('[data-el="scoreboard"]')!.textContent).not.toMatch(/累计|枚剩余/);
    expect(root.querySelector('[data-el="campaign-meta"]')).toBeNull();
    expect(root.querySelector('.level-info')!.textContent).not.toMatch(/最高|复活/);
    expect(root.querySelector('[data-el="scoreboard"]')!.nextElementSibling).toBe(root.querySelector('.level-info'));
    expect(root.querySelector('[data-el="revive-count"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-el="objective"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="footer"] [data-el="best-score"]')!.textContent).toBe('本地最高 17 分');
    shell.render(view('ready'), [], true, false, { ...campaign, revivesRemaining: 2 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('2次机会');
    shell.render(view('ready'), [], true, false, { ...campaign, revivesRemaining: 0, bestScore: 18 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('0次机会');
    expect(root.querySelector('[data-el="best-score"]')!.textContent).toBe('本地最高 18 分');
    shell.render(view('ready'), [], true);
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('3次机会');
  });

  it('omits the redundant single player turn while retaining battle turn ownership', () => {
    for (const phase of ['selecting', 'ready'] as const) {
      shell.render(view(phase), [], true, false, campaign);
      expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(true);
      expect(root.querySelector('[data-el="live"]')!.textContent).not.toContain('轮到你了');
    }
    shell.render(view('simulating'), [], true, false, campaign);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('弹射中');
    expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(false);
    shell.render({ ...view('ready'), mode: 'battle', currentPlayer: 1 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('玩家二的回合');
    expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(false);
  });

  it('hides the single player mode label while retaining the round and battle identity', () => {
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="mode"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('');
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('第 3 轮');
    shell.render({ ...view('ready'), mode: 'battle' }, [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="mode"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('双人抢 10 分');
  });

  it('preserves the current operation prompt beside first material explanations', () => {
    for (const tutorial of ['青色铁币重量和摩擦力更大', '大理石桌面比木头桌面更容易滑行，摩擦力更低']) {
      shell.render(view('ready'), [], true, false, { ...campaign, tutorial });
      const tip = root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!;
      expect(tip.hidden).toBe(false);
      expect(tip.textContent).toBe(tutorial);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('按住硬币后的手指蓄力');
      expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('松手弹射');
      expect(root.querySelector('[data-el="live"]')!.textContent).toContain(tutorial);
    }
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render({ ...view('ready'), mode: 'battle' }, [], true, false, { ...campaign, tutorial: '青色铁币重量和摩擦力更大' });
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
  });

  it('teaches the full charge timeout for the early ready shots without replacing material tips', () => {
    const chargeTip = '满力后持续按住2秒会蓄力失败，请松手重新蓄力';
    const earlyCampaign = { ...campaign, round: 1 };
    shell.render(view('selecting'), [], true, false, earlyCampaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render(view('ready'), [], true, false, earlyCampaign);
    expect(root.querySelector('[data-el="tutorial-tip"]')!.textContent).toBe(chargeTip);
    const materialTip = '青色铁币重量和摩擦力更大';
    shell.render(view('ready'), [], true, false, { ...earlyCampaign, tutorial: materialTip });
    expect(root.querySelector('[data-el="tutorial-tip"]')!.textContent).toBe(`${materialTip}\n${chargeTip}`);
    shell.render({ ...view('ready'), shotCount: 3 }, [], true, false, earlyCampaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render(view('ready'), [], true, false, { ...earlyCampaign, round: 3 });
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
  });

  it('offers restart only inside settings and routes its three actions to existing owners', () => {
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector('[data-el="footer"] [data-action="retry"]')).toBeNull();
    shell.render(view('paused'), [], true, false, campaign);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('游戏设置');
    for (const name of ['modal-seal', 'modal-kicker', 'modal-description']) {
      expect(root.querySelector<HTMLElement>(`[data-el="${name}"]`)!.hidden).toBe(true);
    }
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toBe('');
    expect(root.querySelector('[data-el="modal"]')!.hasAttribute('aria-describedby')).toBe(false);
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    const secondary = root.querySelector<HTMLButtonElement>('[data-el="modal-secondary"]')!;
    const tertiary = root.querySelector<HTMLButtonElement>('[data-el="modal-tertiary"]')!;
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('data-variant')).toBe('settings');
    for (const [button, label] of [[primary, '继续游戏'], [secondary, '重新开始'], [tertiary, '返回菜单']] as const) {
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.title).toBe(label);
      expect(button.classList.contains('modal-icon-button')).toBe(true);
      expect(button.querySelector('svg[aria-hidden="true"] path')).not.toBeNull();
    }
    expect(tertiary.hidden).toBe(false);
    const icon = primary.firstElementChild;
    shell.render(view('paused'), [], true, false, campaign);
    expect(primary.firstElementChild).toBe(icon);
    primary.click(); secondary.click(); tertiary.click();
    expect(callbacks.pause).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.retry).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.home).toHaveBeenCalledExactlyOnceWith();
  });

  it('restores ordinary result and error actions after the settings icons without stale accessible names', () => {
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    const secondary = root.querySelector<HTMLButtonElement>('[data-el="modal-secondary"]')!;
    const tertiary = root.querySelector<HTMLButtonElement>('[data-el="modal-tertiary"]')!;
    shell.render(view('paused'), [], true, false, campaign);
    shell.render({ ...view('failed'), foulReasons: ['MISS'] }, [], true, false, campaign);
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('data-variant')).toBe('result');
    for (const name of ['modal-seal', 'modal-kicker', 'modal-description']) {
      expect(root.querySelector<HTMLElement>(`[data-el="${name}"]`)!.hidden).toBe(false);
    }
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('aria-describedby')).toBe('result-description');
    for (const [button, label] of [[primary, '复活继续'], [secondary, '重新开始'], [tertiary, '返回菜单']] as const) {
      expect(button.textContent).toBe(label);
      expect(button.querySelector('svg')).toBeNull();
      expect(button.hasAttribute('aria-label')).toBe(false);
      expect(button.hasAttribute('title')).toBe(false);
      expect(button.classList.contains('modal-icon-button')).toBe(false);
      expect(button.dataset.icon).toBeUndefined();
    }
    primary.click();
    expect(callbacks.revive).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.pause).not.toHaveBeenCalled();
    shell.render(view('paused'), [], true, false, campaign);
    shell.setError('测试重建棋盘');
    expect(primary.textContent).toBe('重建本局');
    expect(primary.dataset.action).toBe('retry');
    expect(secondary.textContent).toBe('返回菜单');
    expect(secondary.dataset.action).toBe('home');
    expect(tertiary.hidden).toBe(true);
    for (const button of [primary, secondary, tertiary]) {
      expect(button.querySelector('svg')).toBeNull();
      expect(button.hasAttribute('aria-label')).toBe(false);
      expect(button.hasAttribute('title')).toBe(false);
      expect(button.classList.contains('modal-icon-button')).toBe(false);
    }
    primary.click(); secondary.click();
    expect(callbacks.retry).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.home).toHaveBeenCalledExactlyOnceWith();
  });

  it('hands over a completed round without a result modal or next button', () => {
    shell.render(view('complete'), [], true, false, { ...campaign, transition: 'clearing' });
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-action="next"]')).toBeNull();
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toContain('下一轮接着来');
    expect(root.querySelector('[data-el="footer"] [data-action="retry"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-el="pause"]')!.disabled).toBe(false);
    shell.render({ ...view('ready'), canSelectCoin: false }, [], true, true, { ...campaign, round: 4, transition: 'arriving' });
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('留下的这枚');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
  });

  it('offers each remaining revive after settling, then shows the final run result at zero', () => {
    const failure = { ...view('failed'), foulReasons: ['FALL' as const] };
    shell.render({ ...failure, phase: 'simulating' }, [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    shell.render(failure, [], true, false, campaign);
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    expect(primary.textContent).toBe('复活继续');
    expect(document.activeElement).toBe(primary);
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('补回掉落');
    for (const revivesRemaining of [3, 2, 1] as const) {
      shell.render(failure, [], true, false, { ...campaign, revivesRemaining });
      expect(primary.textContent).toBe('复活继续');
      expect(primary.dataset.action).toBe('revive');
      expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain(`剩余 ${revivesRemaining} 次复活机会`);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe(`还剩 ${revivesRemaining} 次复活机会`);
      primary.click();
    }
    expect(callbacks.revive).toHaveBeenCalledTimes(3);
    shell.render(view('selecting'), [], true, false, { ...campaign, revivesRemaining: 0 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('0次机会');
    shell.render(failure, [], true, false, { ...campaign, revivesRemaining: 0 });
    expect(primary.textContent).toBe('再来一局');
    expect(primary.dataset.action).toBe('retry');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toBe('累计 9 分 · 最高 17 分\n到达第 3 轮');
    expect(root.querySelector('[data-action="revive"]')).toBeNull();
  });

  it('pauses an arrival and traps then restores focus without losing the transition', () => {
    shell.render(view('ready'), [], true, true, { ...campaign, transition: 'arriving' });
    const pause = root.querySelector<HTMLButtonElement>('[data-el="pause"]')!;
    pause.focus();
    shell.render(view('paused'), [], true, true, { ...campaign, transition: 'arriving' });
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    const tertiary = root.querySelector<HTMLButtonElement>('[data-el="modal-tertiary"]')!;
    expect(document.activeElement).toBe(primary);
    primary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(tertiary);
    tertiary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(primary);
    shell.render(view('ready'), [], true, true, { ...campaign, transition: 'arriving' });
    expect(document.activeElement).toBe(pause);
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('硬币轻落桌面');
  });

  it('keeps the local battle result and scores', () => {
    root.querySelector<HTMLButtonElement>('[data-action="battle"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-action="pvp"]')!.click();
    expect(callbacks.start).toHaveBeenCalledExactlyOnceWith('battle', level.id, 'pvp');
    shell.render({ ...view('ready'), mode: 'battle', scores: [3, 9], currentPlayer: 1, remaining: 6 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="score-one-label"]')!.textContent).toBe('玩家一');
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('3');
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('9');
    expect(root.querySelector<HTMLElement>('[data-el="player-two"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-el="player-two"]')!.dataset.active).toBe('true');
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('6枚剩余');
    expect(root.querySelector<HTMLElement>('[data-el="objective"]')!.hidden).toBe(false);
    shell.render({ ...view('paused'), mode: 'battle' }, [], true, false, campaign);
    shell.render({ ...view('complete'), mode: 'battle', scores: [3, 10], winner: 1 }, [], true, false, { ...campaign, round: 0 });
    expect(root.querySelector('[data-el="revive-count"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-el="best-score"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="best-score"]')!.textContent).toBe('本地最高 17 分');
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('玩家二获胜');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toContain('3  :  10');
    expect(root.querySelector('[data-el="modal-primary"]')!.textContent).toBe('再来一局');
    expect(root.querySelector('[data-el="modal-primary"]')!.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('先得 10 分');
    shell.render({ ...view('ready'), mode: 'battle', phase: 'refilling' }, [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('重新摆满九枚硬币');
  });

  it('shows both opening distances and a forfeited coin without treating the trial as match completion', () => {
    const opening: GameView = {
      ...view('ready'), mode: 'battle', canSelectCoin: false,
      battle: { variant: 'pvp', stage: 'opening', distances: [null, null], fallen: [false, false], openingAttempt: 1 },
    };
    shell.render(opening, [], true);
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('未弹');
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('未弹');
    expect(root.querySelector<HTMLElement>('[data-el="remaining-cell"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('比远争先');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('掉落放弃先手');
    shell.render({ ...opening, phase: 'complete', battle: { ...opening.battle!, distances: [0.78, null] } }, [], true);
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('78 cm');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-el="pause"]')!.disabled).toBe(false);
    shell.render({ ...opening, phase: 'complete', currentPlayer: 1, winner: 0, battle: { ...opening.battle!, distances: [0.78, null], fallen: [false, true] } }, [], true);
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('掉落弃权');
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('玩家二掉落，放弃先手');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('玩家一获得先手');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
  });

  it('labels the PVE computer turn honestly, retains compact settings and reports the correct winner', () => {
    const battle: GameView = {
      ...view('ready'), mode: 'battle', currentPlayer: 1, inputOwner: 'computer', battleWinScore: 10,
      battle: { variant: 'pve', stage: 'playing', distances: [0.7, 0.8], fallen: [false, false], openingAttempt: 1 },
    };
    for (const phase of ['ready', 'selecting'] as const) {
      shell.render({ ...battle, phase }, [], true);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('电脑思考中');
      expect(root.querySelector('[data-el="prompt-description"]')!.textContent).not.toContain('按住');
      expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('电脑的回合');
      expect(root.querySelector('[data-el="score-one-label"]')!.textContent).toBe('你');
      expect(root.querySelector('[data-el="score-two-label"]')!.textContent).toBe('电脑');
      expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('人机抢 10 分');
    }
    shell.render({ ...battle, phase: 'refilling' }, [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('随机新增八枚硬币');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('残局和双方分数保留');
    shell.render({ ...battle, phase: 'paused' }, [], true);
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('data-variant')).toBe('settings');
    expect(root.querySelector('[data-el="modal-primary"]')!.getAttribute('aria-label')).toBe('继续游戏');
    shell.render({ ...battle, phase: 'complete', scores: [3, 10], winner: 1 }, [], true);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('电脑获胜');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toBe('你 3  :  10 电脑');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('先得 10 分');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(false);
    shell.render({ ...battle, phase: 'complete', scores: [10, 3], winner: 0 }, [], true);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('你获胜');
  });
});
