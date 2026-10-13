// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../../src/ui/Shell';
import type { CampaignView, GameView, LevelConfig } from '../../src/types/contracts';

const level: LevelConfig = {
  schemaVersion: 1,
  id: 'shell-test',
  name: 'Test level',
  lesson: 'Test lesson',
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
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Pick a coin to start');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('Hit one coin directly for +1');
  });

  it('announces each battle turn once after arrival, including opening retries and match start', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    try {
      const battle: GameView = { ...view('ready'), mode: 'battle', battle: {
        variant: 'pve', stage: 'opening', openingAttempt: 1, distances: [null, null], fallen: [false, false],
      } };
      const banner = root.querySelector<HTMLElement>('[data-el="turn-banner"]')!;
      shell.render(battle, [], true, true); expect(banner.hidden).toBe(true);
      shell.render(battle, [], true); expect(banner.hidden).toBe(false); expect(banner.textContent).toBe('Your Turn');
      clock.mockReturnValue(1600); shell.render(battle, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, currentPlayer: 1 }, [], true); expect(banner.textContent).toBe('Computer’s Turn'); expect(banner.hidden).toBe(false);
      shell.render({ ...battle, currentPlayer: 1, phase: 'paused' }, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, currentPlayer: 1 }, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, currentPlayer: 1, shotCount: 2, scores: [0, 2] }, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, currentPlayer: 1 }, [], true, true);
      shell.render({ ...battle, currentPlayer: 1 }, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, battle: { ...battle.battle!, openingAttempt: 2 } }, [], true); expect(banner.hidden).toBe(false);
      shell.render({ ...battle, battle: { ...battle.battle!, stage: 'playing' } }, [], true); expect(banner.textContent).toBe('Your Turn');
      shell.setLoading('Loading'); expect(banner.hidden).toBe(true);
      shell.setLoading(null);
      shell.render({ ...battle, currentPlayer: 1, battle: { ...battle.battle!, variant: 'pvp', stage: 'playing' } }, [], true);
      expect(banner.textContent).toBe('Player 2’s Turn');
      shell.setError('Error'); expect(banner.hidden).toBe(true);
      shell.setError(null); shell.render(null, [], true); expect(banner.hidden).toBe(true);
      shell.render({ ...battle, battle: { ...battle.battle!, variant: 'pvp' } }, [], true); expect(banner.textContent).toBe('Player 1’s Turn');
    } finally { clock.mockRestore(); }
  });

  it('describes the visible computer charge in both opening and normal play', () => {
    for (const stage of ['opening', 'playing'] as const) {
      shell.render({ ...view('ready'), mode: 'battle', inputOwner: 'computer', currentPlayer: 1, computerCharging: true,
        battle: { variant: 'pve', stage, openingAttempt: 1, distances: [null, null], fallen: [false, false] } }, [], true);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Computer is charging');
    }
  });

  it('prompts the finger hold charge in the ready phase', () => {
    shell.render(view('ready'), [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Press and hold to charge');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('more power');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('Tap a coin to switch');
  });

  it('explains the fixed target after a relay', () => {
    shell.render({ ...view('ready'), canSelectCoin: false, chain: 1 }, [], true);
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('the coin you just hit');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).not.toContain('Tap a coin to switch');
  });

  it('keeps sound and settings in one corner rail, with no footer navigation', () => {
    shell.render(view('selecting'), [], true);
    const controls = root.querySelector('.topbar .corner-controls')!;
    const buttons = controls.querySelectorAll<HTMLButtonElement>('button');
    expect(Array.from(buttons, (button) => button.dataset.action)).toEqual(['sound', 'pause']);
    expect(buttons[1].getAttribute('aria-label')).toBe('Pause game');
    expect(buttons[1].hidden).toBe(false);
    expect(root.querySelector('[data-el="footer"] button')).toBeNull();
    buttons[1].click();
    expect(callbacks.pause).toHaveBeenCalledExactlyOnceWith();
    shell.render(null, [], true);
    expect(buttons[1].hidden).toBe(true);
    expect(buttons[0].hidden).toBe(false);
  });

  it('shares the English logo between home and gameplay with an accessible home title', () => {
    const title = root.querySelector('.menu-intro h1')!;
    const logo = title.querySelector<HTMLImageElement>('img')!;
    const gameBrand = root.querySelector<HTMLElement>('[data-el="game-brand"]')!;
    expect(title.getAttribute('aria-label')).toBe('FlickChain');
    expect(logo.getAttribute('src')).toMatch(/branding\/flickchain-logo\.png$/);
    expect(logo.getAttribute('alt')).toBe('');
    expect(gameBrand.querySelector('img')!.getAttribute('src')).toBe(logo.getAttribute('src'));
    expect(gameBrand.hidden).toBe(true);
    shell.render(view('selecting'), [], true);
    expect(gameBrand.hidden).toBe(false);
    shell.render(null, [], true);
    expect(gameBrand.hidden).toBe(true);
  });

  it('enters single player immediately, with the local best score and no level list', () => {
    shell.render(null, [level.id], true, false, { ...campaign, round: 0 });
    expect(root.querySelector('[data-el="progress"]')!.textContent).toBe('Best: 17');
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
    expect(battle.textContent).toBe('Local Battle');
    expect(pvp.textContent).toBe('2 Players');
    expect(pve.textContent).toBe('Vs. Computer');
    battle.click();
    expect(callbacks.start).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="battle-actions"] .menu-progress')!.textContent).toBe('First to 10 points');
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
    shell.setLoading('Preparing the battle');
    const pve = root.querySelector<HTMLButtonElement>('[data-action="pve"]')!;
    pve.click();
    expect(callbacks.start).not.toHaveBeenCalled();
    expect(pve.disabled).toBe(true);
    shell.setError('Could not prepare the table');
    root.querySelector<HTMLButtonElement>('[data-el="modal-secondary"]')!.click();
    expect(callbacks.home).toHaveBeenCalledOnce();
    shell.setError(null); shell.setLoading(null); shell.render(null, [], true);
    expect(root.querySelector<HTMLElement>('[data-el="battle-actions"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-el="main-actions"]')!.hidden).toBe(false);
  });

  it('shows points and remaining continues, with the small round below the panel and best in the footer', () => {
    shell.render({ ...view('ready'), remaining: 8 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('Round 3');
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('9');
    expect(root.querySelector('[data-el="player-one"]')!.textContent).toBe('9Score');
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('3Continues');
    expect(root.querySelector('[data-el="scoreboard"]')!.textContent).not.toMatch(/Total|Coins left/);
    expect(root.querySelector('[data-el="campaign-meta"]')).toBeNull();
    expect(root.querySelector('.level-info')!.textContent).not.toMatch(/Best|Continue/);
    expect(root.querySelector('[data-el="scoreboard"]')!.nextElementSibling).toBe(root.querySelector('.level-info'));
    expect(root.querySelector('[data-el="revive-count"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-el="objective"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="footer"] [data-el="best-score"]')!.textContent).toBe('Best: 17');
    shell.render(view('ready'), [], true, false, { ...campaign, revivesRemaining: 2 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('2Continues');
    shell.render(view('ready'), [], true, false, { ...campaign, revivesRemaining: 0, bestScore: 18 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('0Continues');
    expect(root.querySelector('[data-el="best-score"]')!.textContent).toBe('Best: 18');
    shell.render(view('ready'), [], true);
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('3Continues');
  });

  it('omits the redundant single player turn while retaining battle turn ownership', () => {
    for (const phase of ['selecting', 'ready'] as const) {
      shell.render(view(phase), [], true, false, campaign);
      expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(true);
      expect(root.querySelector('[data-el="live"]')!.textContent).not.toContain('Your turn');
    }
    shell.render(view('simulating'), [], true, false, campaign);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('Shot in motion');
    expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(false);
    shell.render({ ...view('ready'), mode: 'battle', currentPlayer: 1 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe("Player 2's turn");
    expect(root.querySelector<HTMLElement>('[data-el="turn-label"]')!.hidden).toBe(false);
  });

  it('hides the single player mode label while retaining the round and battle identity', () => {
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="mode"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('');
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('Round 3');
    shell.render({ ...view('ready'), mode: 'battle' }, [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="mode"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('First to 10');
  });

  it('preserves the current operation prompt beside first material explanations', () => {
    for (const tutorial of ['Iron coins are heavier and have more friction.', 'Marble has less friction than wood, so coins slide farther.']) {
      shell.render(view('ready'), [], true, false, { ...campaign, tutorial });
      const tip = root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!;
      expect(tip.hidden).toBe(false);
      expect(tip.textContent).toBe(tutorial);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Press and hold to charge');
      expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('release to flick');
      expect(root.querySelector('[data-el="live"]')!.textContent).toContain(tutorial);
    }
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render({ ...view('ready'), mode: 'battle' }, [], true, false, { ...campaign, tutorial: 'Iron coins are heavier and have more friction.' });
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
  });

  it('teaches the full charge timeout for the early ready shots without replacing material tips', () => {
    const chargeTip = 'Release within 2 seconds of full charge, or the shot is canceled.';
    const earlyCampaign = { ...campaign, round: 1 };
    shell.render(view('selecting'), [], true, false, earlyCampaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render(view('ready'), [], true, false, earlyCampaign);
    expect(root.querySelector('[data-el="tutorial-tip"]')!.textContent).toBe(chargeTip);
    const materialTip = 'Iron coins are heavier and have more friction.';
    shell.render(view('ready'), [], true, false, { ...earlyCampaign, tutorial: materialTip });
    expect(root.querySelector('[data-el="tutorial-tip"]')!.textContent).toBe(`${materialTip}\n${chargeTip}`);
    expect(root.querySelector('[data-el="live"]')!.textContent).toContain('release to flick.');
    expect(root.querySelector('[data-el="live"]')!.textContent).not.toContain('..');
    shell.render({ ...view('ready'), shotCount: 3 }, [], true, false, earlyCampaign);
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
    shell.render(view('ready'), [], true, false, { ...earlyCampaign, round: 3 });
    expect(root.querySelector<HTMLElement>('[data-el="tutorial-tip"]')!.hidden).toBe(true);
  });

  it('offers restart only inside settings and routes its three actions to existing owners', () => {
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector('[data-el="footer"] [data-action="retry"]')).toBeNull();
    shell.render(view('paused'), [], true, false, campaign);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Paused');
    for (const name of ['modal-seal', 'modal-kicker', 'modal-description']) {
      expect(root.querySelector<HTMLElement>(`[data-el="${name}"]`)!.hidden).toBe(true);
    }
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toBe('');
    expect(root.querySelector('[data-el="modal"]')!.hasAttribute('aria-describedby')).toBe(false);
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    const secondary = root.querySelector<HTMLButtonElement>('[data-el="modal-secondary"]')!;
    const tertiary = root.querySelector<HTMLButtonElement>('[data-el="modal-tertiary"]')!;
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('data-variant')).toBe('settings');
    for (const [button, label] of [[primary, 'Resume'], [secondary, 'Restart'], [tertiary, 'Main Menu']] as const) {
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
    for (const [button, label] of [[primary, 'Continue'], [secondary, 'Restart'], [tertiary, 'Main Menu']] as const) {
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
    shell.setError('Test table recovery');
    expect(primary.textContent).toBe('Restart');
    expect(primary.dataset.action).toBe('retry');
    expect(secondary.textContent).toBe('Main Menu');
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
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toContain('next round');
    expect(root.querySelector('[data-el="footer"] [data-action="retry"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-el="pause"]')!.disabled).toBe(false);
    shell.render({ ...view('ready'), canSelectCoin: false }, [], true, true, { ...campaign, round: 4, transition: 'arriving' });
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('last coin carries over');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
  });

  it('offers each remaining revive after settling, then shows the final run result at zero', () => {
    const failure = { ...view('failed'), foulReasons: ['FALL' as const] };
    shell.render({ ...failure, phase: 'simulating' }, [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    shell.render(failure, [], true, false, campaign);
    const primary = root.querySelector<HTMLButtonElement>('[data-el="modal-primary"]')!;
    expect(primary.textContent).toBe('Continue');
    expect(document.activeElement).toBe(primary);
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('Fallen coins will return');
    for (const revivesRemaining of [3, 2, 1] as const) {
      shell.render(failure, [], true, false, { ...campaign, revivesRemaining });
      expect(primary.textContent).toBe('Continue');
      expect(primary.dataset.action).toBe('revive');
      expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain(`${revivesRemaining} ${revivesRemaining === 1 ? 'continue' : 'continues'} left`);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe(`${revivesRemaining} ${revivesRemaining === 1 ? 'continue' : 'continues'} left`);
      primary.click();
    }
    expect(callbacks.revive).toHaveBeenCalledTimes(3);
    shell.render(view('selecting'), [], true, false, { ...campaign, revivesRemaining: 0 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('0Continues');
    shell.render(failure, [], true, false, { ...campaign, revivesRemaining: 0 });
    expect(primary.textContent).toBe('Play Again');
    expect(primary.dataset.action).toBe('retry');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toBe('Score: 9 · Best: 17\nReached Round 3');
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
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('New coins are dropping in');
  });

  it('keeps the local battle result and scores', () => {
    root.querySelector<HTMLButtonElement>('[data-action="battle"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-action="pvp"]')!.click();
    expect(callbacks.start).toHaveBeenCalledExactlyOnceWith('battle', level.id, 'pvp');
    shell.render({ ...view('ready'), mode: 'battle', scores: [3, 9], currentPlayer: 1, remaining: 6 }, [], true, false, campaign);
    expect(root.querySelector('[data-el="score-one-label"]')!.textContent).toBe('Player 1');
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('3');
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('9');
    expect(root.querySelector<HTMLElement>('[data-el="player-two"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-el="player-two"]')!.dataset.active).toBe('true');
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('6Coins left');
    expect(root.querySelector<HTMLElement>('[data-el="objective"]')!.hidden).toBe(false);
    shell.render({ ...view('paused'), mode: 'battle' }, [], true, false, campaign);
    shell.render({ ...view('complete'), mode: 'battle', scores: [3, 10], winner: 1 }, [], true, false, { ...campaign, round: 0 });
    expect(root.querySelector('[data-el="revive-count"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-el="best-score"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-el="best-score"]')!.textContent).toBe('Best: 17');
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Player 2 wins');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toContain('3  :  10');
    expect(root.querySelector('[data-el="modal-primary"]')!.textContent).toBe('Play Again');
    expect(root.querySelector('[data-el="modal-primary"]')!.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('First to 10');
    shell.render({ ...view('ready'), mode: 'battle', phase: 'refilling' }, [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Refilling to 9 coins');
  });

  it('shows both opening distances and a forfeited coin without treating the trial as match completion', () => {
    const opening: GameView = {
      ...view('ready'), mode: 'battle', canSelectCoin: false,
      battle: { variant: 'pvp', stage: 'opening', distances: [null, null], fallen: [false, false], openingAttempt: 1 },
    };
    shell.render(opening, [], true);
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('Ready');
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('Ready');
    expect(root.querySelector<HTMLElement>('[data-el="remaining-cell"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="level-name"]')!.textContent).toBe('Who Goes First?');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('fall or timeout forfeits');
    shell.render({ ...opening, phase: 'complete', battle: { ...opening.battle!, distances: [0.78, null] } }, [], true);
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('78 cm');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-el="pause"]')!.disabled).toBe(false);
    shell.render({ ...opening, phase: 'complete', battle: { ...opening.battle!, distances: [1.448, null], fallen: [false, false] } }, [], true);
    expect(root.querySelector('[data-el="score-one"]')!.textContent).toBe('145 cm');
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Player 1 flicked 145 cm');
    shell.render({ ...opening, phase: 'complete', currentPlayer: 1, winner: 0, battle: { ...opening.battle!, distances: [0.78, null], fallen: [false, true] } }, [], true);
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('Forfeit');
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe("Shot forfeited");
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('Player 1 goes first');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
  });

  it('labels the PVE computer turn honestly, retains compact settings and reports the correct winner', () => {
    const battle: GameView = {
      ...view('ready'), mode: 'battle', currentPlayer: 1, inputOwner: 'computer', battleWinScore: 10,
      battle: { variant: 'pve', stage: 'playing', distances: [0.7, 0.8], fallen: [false, false], openingAttempt: 1 },
    };
    for (const phase of ['ready', 'selecting'] as const) {
      shell.render({ ...battle, phase }, [], true);
      expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Computer is thinking');
      expect(root.querySelector('[data-el="prompt-description"]')!.textContent).not.toContain('Hold');
      expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe("Computer's turn");
      expect(root.querySelector('[data-el="score-one-label"]')!.textContent).toBe('You');
      expect(root.querySelector('[data-el="score-two-label"]')!.textContent).toBe('Computer');
      expect(root.querySelector('[data-el="mode"]')!.textContent).toBe('First to 10');
    }
    shell.render({ ...battle, phase: 'refilling' }, [], true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Adding 8 new coins');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('Scores and remaining coins carry over');
    shell.render({ ...battle, phase: 'paused' }, [], true);
    expect(root.querySelector('[data-el="modal"]')!.getAttribute('data-variant')).toBe('settings');
    expect(root.querySelector('[data-el="modal-primary"]')!.getAttribute('aria-label')).toBe('Resume');
    shell.render({ ...battle, phase: 'complete', scores: [3, 10], winner: 1 }, [], true);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Computer wins');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toBe('You 3  :  10 Computer');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('First to 10');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(false);
    shell.render({ ...battle, phase: 'complete', scores: [10, 3], winner: 0 }, [], true);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('You win');
  });

  it('uses English accessible names for menus, sound, and notices', () => {
    expect(root.querySelector('[data-action="challenge"]')!.textContent).toBe('Solo Play');
    expect(root.querySelector('.corner-controls')!.getAttribute('aria-label')).toBe('Game controls');
    expect(root.querySelector('[data-action="pvp"]')!.getAttribute('aria-label')).toBe('2 Players on this device');
    expect(root.querySelector('[data-action="pve"]')!.getAttribute('aria-label')).toBe('Play against the computer');
    const back = root.querySelector<HTMLButtonElement>('[data-action="battle-back"]')!;
    expect(back.getAttribute('aria-label')).toBe('Back to Main Menu');
    expect(back.title).toBe('Back to Main Menu');
    const sound = root.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    expect(sound.getAttribute('aria-label')).toBe('Sound on');
    shell.render(null, [], false);
    expect(sound.getAttribute('aria-label')).toBe('Sound off');
    expect(sound.getAttribute('aria-pressed')).toBe('false');
    sound.click();
    expect(callbacks.toggleSound).toHaveBeenCalledOnce();

    shell.setNotice('Progress could not be saved. You can keep playing.');
    const notice = root.querySelector<HTMLElement>('[data-el="notice"]')!;
    const dismiss = root.querySelector<HTMLButtonElement>('[data-action="dismiss-notice"]')!;
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute('aria-label')).toBe('Progress notification');
    expect(dismiss.textContent).toBe('Close');
    expect(dismiss.getAttribute('aria-label')).toBe('Close notification');
    expect(root.querySelector('[data-el="notice-message"]')!.textContent).toContain('keep playing');
    dismiss.click();
    expect(notice.hidden).toBe(true);
    shell.setNotice(null);
    shell.setNotice('Progress could not be saved. You can keep playing.');
    expect(notice.hidden).toBe(false);
  });

  it.each([
    ['MISS', 'No coins hit'],
    ['MULTI_HIT', 'The flicked coin hit more than one coin directly'],
    ['FALL', 'A coin fell off the table'],
    ['TIMEOUT', 'Coins took too long to stop'],
  ] as const)('explains %s in English while settling and in the result', (reason, explanation) => {
    shell.render({ ...view('simulating'), foulReasons: [reason] }, [], true, false, campaign);
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe(explanation);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('Foul · Coins in motion');
    expect(root.querySelector('[data-el="live"]')!.textContent).toContain(explanation);
    if (reason === 'MULTI_HIT') {
      expect(explanation).toContain('flicked coin');
      expect(explanation).toContain('directly');
      expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('Other coins can hit each other.');
    }
    shell.render({ ...view('failed'), foulReasons: [reason] }, [], true, false, campaign);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Chain broken');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain(explanation);
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain(reason === 'FALL' ? 'Fallen coins will return' : 'Keep your score and coins');
    if (reason === 'MULTI_HIT') expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('Other coins can hit each other.');
  });

  it('describes an opening forfeit without claiming that the coin necessarily fell', () => {
    // OpeningSession uses fallen for both a fall and a shot that times out on the table.
    shell.render({
      ...view('complete'), mode: 'battle', currentPlayer: 1, winner: 0,
      battle: { variant: 'pve', stage: 'opening', distances: [0.8, 0.5], fallen: [false, true], openingAttempt: 1 },
    }, [], true);
    expect(root.querySelector('[data-el="score-two"]')!.textContent).toBe('Forfeit');
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('Shot forfeited');
    expect(root.querySelector('[data-el="live"]')!.textContent).not.toContain('coin fell');
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('You go first');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
  });

  it('shows a complete final-run sentence even when no foul reason is supplied', () => {
    shell.render(view('failed'), [], true, false, { ...campaign, revivesRemaining: 0 });
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Game over');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toBe('Play again to beat your best score.');
    expect(root.querySelector('[data-el="modal-primary"]')!.textContent).toBe('Play Again');
  });

  it('labels the last continue in the singular without changing the starting allowance', () => {
    shell.render(view('ready'), [], true, false, campaign);
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('3Continues');
    shell.render(view('ready'), [], true, false, { ...campaign, revivesRemaining: 1 });
    expect(root.querySelector('.remaining-cell')!.textContent).toBe('1Continue');
    shell.render({ ...view('failed'), foulReasons: ['MISS'] }, [], true, false, { ...campaign, revivesRemaining: 1 });
    expect(root.querySelector('[data-el="prompt-title"]')!.textContent).toBe('1 continue left');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toContain('1 continue left.');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).not.toContain('1 continues');
  });

  it('uses grammatical human ownership, opening results, and draw copy in PVE', () => {
    const battle: GameView = {
      ...view('ready'), mode: 'battle', inputOwner: 'human', currentPlayer: 0,
      battle: { variant: 'pve', stage: 'playing', distances: [0.8, 0.7], fallen: [false, false], openingAttempt: 1 },
    };
    shell.render(battle, [], true);
    expect(root.querySelector('[data-el="turn-label"]')!.textContent).toBe('Your turn');
    shell.render({ ...battle, phase: 'complete', winner: 0, battle: { ...battle.battle!, stage: 'opening' } }, [], true);
    expect(root.querySelector('[data-el="prompt-description"]')!.textContent).toContain('You go first');
    expect(root.querySelector<HTMLElement>('[data-el="modal-layer"]')!.hidden).toBe(true);
    shell.render({ ...battle, phase: 'complete', scores: [9, 9], winner: 'draw' }, [], true);
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Draw');
    expect(root.querySelector('[data-el="modal-score"]')!.textContent).toBe('You 9  :  9 Computer');
    expect(root.querySelector('[data-el="modal-primary"]')!.textContent).toBe('Play Again');
    expect(root.querySelector('[data-el="modal-secondary"]')!.textContent).toBe('Main Menu');
  });

  it('keeps every shell state and accessible label English, including loading and error fallback', () => {
    const assertEnglish = (): void => {
      const accessibleNames = Array.from(root.querySelectorAll('[aria-label], [title]'), (element) =>
        `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`).join(' ');
      expect(`${root.textContent} ${accessibleNames}`).not.toMatch(/[\u3400-\u9fff\u3002\uff0c\uff1b]/u);
    };
    assertEnglish();
    shell.setLoading('Preparing the table');
    expect(root.querySelector('[data-el="loading-message"]')!.textContent).toBe('Preparing the table');
    assertEnglish();
    shell.setLoading(null);
    for (const phase of ['selecting', 'ready', 'simulating', 'paused', 'complete', 'failed', 'refilling', 'error'] as const) {
      shell.render({ ...view(phase), foulReasons: phase === 'failed' ? ['MISS'] : [] }, [], false, false, { ...campaign, round: 1 });
      assertEnglish();
    }
    expect(root.querySelector('[data-el="modal-title"]')!.textContent).toBe('Something went wrong');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toBe('Restart the game or return to the Main Menu.');
    shell.setError('The table could not be loaded. Please restart.');
    expect(root.querySelector('[data-el="modal-description"]')!.textContent).toBe('The table could not be loaded. Please restart.');
    assertEnglish();
  });
});
