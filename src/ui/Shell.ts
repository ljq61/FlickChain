import type { BattleVariant, CampaignView, FoulReason, GameMode, GameView, LevelConfig } from '../types/contracts';
import { TITLE_LOGO } from './TitleLogo';
import './styles.css';

const FOUL_TEXT: Record<FoulReason, string> = {
  MISS: 'No coins hit',
  MULTI_HIT: 'The flicked coin hit more than one coin directly',
  FALL: 'A coin fell off the table',
  TIMEOUT: 'Coins took too long to stop',
};
const SECONDARY_HIT_TIP = 'Other coins can hit each other.';

const COIN_ICON = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="16" stroke="currentColor"/><circle cx="24" cy="24" r="12" stroke="currentColor" stroke-width="1.5"/><path d="M24 4v4m20 16h-4M24 44v-4M4 24h4" stroke="currentColor" stroke-width="2"/></svg>';
const PEOPLE_ICON = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="17" cy="14" r="6" stroke="currentColor" stroke-width="2"/><circle cx="33" cy="15" r="5" stroke="currentColor" stroke-width="2"/><path d="M5 39v-6a12 12 0 0 1 24 0v6H5Zm24-16a10 10 0 0 1 14 9v7H33" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COMPUTER_ICON = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="7" y="8" width="34" height="24" rx="4" stroke="currentColor" stroke-width="2"/><path d="M24 33v7m-9 0h18M16 18h2m12 0h2m-15 7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="m14 6-8 8 8 8M7 14h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_ICON = '<svg class="button-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m11 7 14 9-14 9V7Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const RESTART_ICON = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 12a10 10 0 1 1-1 8M7 5v7h7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HOME_ICON = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m4 15 12-10 12 10M7 13v14h7v-8h4v8h7V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface Callbacks {
  start: (mode: GameMode, levelId: string, variant?: BattleVariant) => void;
  retry: () => void;
  home: () => void;
  next?: () => void;
  revive?: () => void;
  pause: () => void;
  toggleSound: () => void;
}

/** Stable DOM: a frame update changes text and permissions, never rebuilds controls. */
export class Shell {
  private readonly element: HTMLDivElement;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly events = new AbortController();
  private view: GameView | null = null;
  private campaign: CampaignView | undefined;
  private loading: string | null = null;
  private externalError: string | null = null;
  private notice: string | null = null;
  private dismissedNotice: string | null = null;
  private modalState = '';
  private previousFocus: HTMLElement | null = null;
  private announced = '';
  private menuState: 'home' | 'battle' = 'home';

  constructor(private readonly root: HTMLElement, private readonly levels: LevelConfig[], private readonly callbacks: Callbacks) {
    this.element = document.createElement('div');
    this.element.className = 'flick-shell';
    this.element.dataset.screen = 'home';
    this.element.innerHTML = `
      <div class="table-scene" data-el="canvas-host"></div>
      <header class="topbar">
        <div class="brand"><span class="brand-mark">${COIN_ICON}</span><div><span class="brand-name">FlickChain</span></div></div>
        <nav class="corner-controls" aria-label="Game controls">
        <button class="quiet-button sound-button" type="button" data-action="sound" data-el="sound" aria-pressed="true" aria-label="Sound on"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 10h5l6-5v18l-6-5H5V10Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path class="sound-waves" d="M20 9a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="sound-muted" d="m20 11 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="status-label" data-el="sound-label">Sound on</span></button>
        <button type="button" class="quiet-button settings-button" data-action="pause" data-el="pause" aria-label="Pause game" hidden><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="m11.5 3-.7 3-2 .9-2.7-.8-2.5 4.3 2 2.2v2.8l-2 2.2 2.5 4.3 2.7-.8 2 .9.7 3h5l.7-3 2-.9 2.7.8 2.5-4.3-2-2.2v-2.8l2-2.2-2.5-4.3-2.7.8-2-.9-.7-3h-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="14" cy="14" r="4" stroke="currentColor" stroke-width="1.7"/></svg></button>
        </nav>
      </header>
      <div class="game-brand" data-el="game-brand" aria-hidden="true" hidden>${TITLE_LOGO}</div>
      <main class="home-menu" data-el="home">
        <div class="menu-intro"><h1 class="title-logo" aria-label="FlickChain">${TITLE_LOGO}</h1></div>
        <div class="menu-actions" data-el="main-actions"><button type="button" class="primary-button menu-button" data-action="challenge"><span class="button-icon">${COIN_ICON}</span><span class="button-label">Solo Play</span>${CHEVRON_ICON}</button><button type="button" class="secondary-button menu-button" data-action="battle"><span class="button-icon">${PEOPLE_ICON}</span><span class="button-label">Local Battle</span>${CHEVRON_ICON}</button><p class="menu-progress" data-el="progress">Best: 0</p></div>
        <div class="menu-actions battle-menu" data-el="battle-actions" hidden><div class="battle-menu-heading"><button type="button" class="quiet-button menu-back" data-action="battle-back" aria-label="Back to Main Menu" title="Back to Main Menu">${BACK_ICON}</button><h2>Local Battle</h2></div><button type="button" class="primary-button menu-button battle-choice" data-action="pvp" aria-label="2 Players on this device"><span class="button-icon">${PEOPLE_ICON}</span><span class="button-label">2 Players</span>${CHEVRON_ICON}</button><button type="button" class="secondary-button menu-button battle-choice" data-action="pve" aria-label="Play against the computer"><span class="button-icon">${COMPUTER_ICON}</span><span class="button-label">Vs. Computer</span>${CHEVRON_ICON}</button><p class="menu-progress">First to 10 points</p></div>
        <p class="table-caption">All coins are shared.</p>
      </main>
      <section class="game-hud" data-el="hud" hidden aria-label="Game status"><div class="score-panel"><div class="scoreboard" data-el="scoreboard"><div class="score-cell" data-el="player-one"><strong data-el="score-one">0</strong><span data-el="score-one-label">Score</span></div><div class="score-cell" data-el="player-two" hidden><span data-el="score-two-label">Player 2</span><strong data-el="score-two">0</strong></div><div class="remaining-cell" data-el="remaining-cell"><strong data-el="remaining">3</strong><span data-el="remaining-label">Continues</span></div></div><div class="level-info"><span class="eyebrow" data-el="mode" hidden></span><h1 data-el="level-name"></h1><p data-el="objective" hidden>Keep the last coin for the next round</p></div></div></section>
      <footer class="play-footer" data-el="footer" hidden><div class="shot-prompt" data-el="shot-prompt"><div class="turn-label" data-el="turn-label" hidden></div><h2 data-el="prompt-title">Line up your shot</h2><p data-el="prompt-description">Drag empty space to aim · Pick a coin to start</p><p class="tutorial-tip" data-el="tutorial-tip" hidden></p></div><p class="best-score" data-el="best-score" hidden>Best: 0</p></footer>
      <div class="status-live" data-el="live" role="status" aria-live="polite" aria-atomic="true"></div>
      <aside class="notice-toast" data-el="notice" hidden aria-label="Progress notification"><p data-el="notice-message" role="status"></p><button type="button" class="notice-dismiss" data-action="dismiss-notice" aria-label="Close notification">Close</button></aside>
      <div class="loading-layer" data-el="loading" hidden><div class="loading-card" role="status"><span class="loading-dot" aria-hidden="true"></span><p data-el="loading-message">Preparing the table</p></div></div>
      <div class="modal-layer" data-el="modal-layer" hidden><section class="result-card" data-el="modal" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description" tabindex="-1"><div class="bill-seal" data-el="modal-seal" aria-hidden="true">${COIN_ICON}</div><p class="eyebrow" data-el="modal-kicker">This game</p><h2 id="result-title" data-el="modal-title"></h2><p id="result-description" data-el="modal-description"></p><div class="result-score" data-el="modal-score"></div><div class="modal-actions"><button type="button" class="primary-button" data-el="modal-primary" data-action="retry">Try Again</button><button type="button" class="secondary-button" data-el="modal-secondary" data-action="home">Main Menu</button><button type="button" class="text-button" data-el="modal-tertiary" data-action="home" hidden>Main Menu</button></div></section></div>`;
    this.root.append(this.element);
    this.element.querySelectorAll<HTMLElement>('[data-el]').forEach((element) => this.elements.set(element.dataset.el!, element));
    const signal = this.events.signal;
    this.element.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      switch (button.dataset.action) {
        case 'challenge': if (this.levels.length) this.callbacks.start('challenge', this.levels[0].id); break;
        case 'battle': this.menuState = 'battle'; this.updateMenu(); this.element.querySelector<HTMLButtonElement>('[data-action="pvp"]')?.focus(); break;
        case 'battle-back': this.menuState = 'home'; this.updateMenu(); this.element.querySelector<HTMLButtonElement>('[data-action="battle"]')?.focus(); break;
        case 'pvp': case 'pve': if (this.levels.length) this.callbacks.start('battle', this.levels[this.levels.length - 1].id, button.dataset.action); break;
        case 'home': this.menuState = 'home'; this.updateMenu(); this.callbacks.home(); break;
        case 'retry': this.callbacks.retry(); break;
        case 'revive': this.callbacks.revive?.(); break;
        case 'pause': this.callbacks.pause(); break;
        case 'sound': this.callbacks.toggleSound(); break;
        case 'dismiss-notice': this.dismissedNotice = this.notice; this.node('notice').hidden = true; break;
      }
    }, { signal });
    this.element.addEventListener('keydown', (event) => {
      if (!this.modalState || event.key !== 'Tab') return;
      const buttons = Array.from(this.node('modal').querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.hidden && !button.disabled);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, { signal });
    this.render(null, [], true);
  }

  get canvasHost(): HTMLElement { return this.node('canvas-host'); }
  private node<T extends HTMLElement = HTMLElement>(name: string): T { return this.elements.get(name)! as T; }
  private text(name: string, value: string): void { const node = this.node(name); if (node.textContent !== value) node.textContent = value; }

  private updateMenu(): void {
    this.node('main-actions').hidden = this.menuState !== 'home';
    this.node('battle-actions').hidden = this.menuState !== 'battle';
    this.element.dataset.menu = this.menuState;
  }

  render(view: GameView | null, _completed: string[], sound: boolean, introducing = false, campaign?: CampaignView): void {
    if (this.view && !view) this.menuState = 'home';
    this.view = view;
    this.updateMenu();
    this.campaign = campaign;
    const transition = campaign?.transition;
    const challenge = view?.mode === 'challenge';
    this.element.dataset.screen = view ? 'game' : 'home';
    this.element.dataset.mode = view?.mode ?? 'menu';
    this.element.dataset.phase = view?.phase === 'paused' ? 'paused' : transition ?? (introducing ? 'introducing' : view?.phase ?? 'menu');
    this.node('home').hidden = !!view;
    this.node('game-brand').hidden = !view;
    this.node('hud').hidden = !view;
    this.node('footer').hidden = !view;
    this.node('pause').hidden = !view;
    this.text('sound-label', sound ? 'Sound on' : 'Sound off');
    this.node('sound').setAttribute('aria-label', sound ? 'Sound on' : 'Sound off');
    this.node('sound').setAttribute('aria-pressed', String(sound));
    this.element.querySelectorAll<HTMLButtonElement>('.home-menu button').forEach((button) => { button.disabled = !!this.loading; });
    this.text('progress', `Best: ${campaign?.bestScore ?? 0}`);
    if (view) {
      const battle = view.mode === 'battle';
      const opening = battle && view.battle?.stage === 'opening';
      const computer = view.inputOwner === 'computer';
      const winScore = view.battleWinScore ?? 10;
      const playerNames = view.battle?.variant === 'pve' ? ['You', 'Computer'] : ['Player 1', 'Player 2'];
      const currentName = playerNames[view.currentPlayer];
      this.element.dataset.battleStage = view.battle?.stage ?? '';
      const round = campaign?.round ?? 1;
      this.text('mode', battle ? `First to ${winScore}` : '');
      this.node('mode').hidden = !battle;
      this.text('level-name', battle ? opening ? 'Who Goes First?' : '' : `Round ${round}`);
      this.node('level-name').hidden = battle && !opening;
      this.text('objective', 'Clean hit: +1 · Miss or foul: next player');
      this.node('objective').hidden = !battle || opening;
      this.text('best-score', `Best: ${campaign?.bestScore ?? 0}`);
      this.node('best-score').hidden = false;
      this.text('score-one-label', battle ? playerNames[0] : 'Score');
      this.text('score-two-label', playerNames[1]);
      const openingDistance = (player: 0 | 1): string => view.battle!.fallen[player] ? 'Forfeit'
        : view.battle!.distances[player] === null ? 'Ready' : `${Math.round(view.battle!.distances[player]! * 100)} cm`;
      this.text('score-one', opening ? openingDistance(0) : String(battle ? view.scores[0] : campaign?.score ?? view.scores[0]));
      this.text('score-two', opening ? openingDistance(1) : String(view.scores[1]));
      this.text('remaining', String(battle ? view.remaining : campaign?.revivesRemaining ?? 3));
      this.text('remaining-label', battle ? 'Coins left' : (campaign?.revivesRemaining ?? 3) === 1 ? 'Continue' : 'Continues');
      this.node('remaining-cell').hidden = !!opening;
      this.node('player-two').hidden = !battle;
      this.node('player-one').dataset.active = String(battle && view.currentPlayer === 0);
      this.node('player-two').dataset.active = String(battle && view.currentPlayer === 1);
      this.node<HTMLButtonElement>('pause').disabled = ['failed', 'error'].includes(view.phase) || (battle && view.phase === 'complete' && !opening);
      const failedDuringShot = view.phase === 'simulating' && view.foulReasons.length > 0;
      this.node('shot-prompt').dataset.foul = String(failedDuringShot);
      let title = 'Line up your shot';
      let description = 'Drag empty space to aim; pick a coin to start';
      let turn = battle ? currentName === 'You' ? 'Your turn' : `${currentName}'s turn` : '';
      if (view.phase === 'paused') {
        title = 'Game paused'; description = 'Select Resume to keep playing'; turn = 'Paused';
      } else if (opening && view.phase !== 'error') {
        title = view.phase === 'complete' ? view.battle!.fallen[view.currentPlayer] ? 'Shot forfeited' : `${currentName} flicked ${openingDistance(view.currentPlayer)}`
          : computer ? 'Computer is taking its shot' : 'Who Goes First?';
        description = view.phase === 'simulating' ? 'Wait for the coin to stop to measure the shot'
          : view.phase === 'complete' ? view.winner === 0 || view.winner === 1 ? `${view.winner === 0 && view.battle?.variant === 'pve' ? 'You go' : `${playerNames[view.winner]} goes`} first. Setting up nine coins for the match.`
            : 'Next player. If both shots tie or forfeit, try again.'
          : computer ? 'The longest shot goes first. Falling off or timing out forfeits the shot.'
          : 'Hold the finger, then release. Longest shot goes first. A fall or timeout forfeits the shot.';
        turn = `Opening round ${view.battle!.openingAttempt} · ${currentName}`;
      } else if (view.phase === 'refilling') {
        title = view.battle?.variant === 'pve' ? 'Adding 8 new coins' : 'Refilling to 9 coins'; description = 'Scores and remaining coins carry over. Wait for the new coins to stop.'; turn = 'Setting up';
      } else if (transition === 'clearing' || (challenge && view.phase === 'complete')) {
        title = 'On to the next round'; description = 'The last coin carries over. New coins are on the way.'; turn = 'Round complete';
      } else if (transition === 'arriving' || introducing) {
        title = 'New coins are dropping in';
        description = view.activeCoinId ? 'Your last coin carries over. Wait for the new coins to stop.' : 'Once the coins stop, pick one to start.';
        turn = 'Setting up';
      } else if (view.phase === 'selecting') {
        title = computer ? 'Computer is thinking' : 'Pick a coin to start';
        description = computer ? 'The computer is lining up its next shot' : 'Hit one coin directly for +1, then flick from it. Drag empty space to aim.';
      } else if (view.phase === 'ready') {
        title = computer ? 'Computer is thinking' : 'Press and hold to charge';
        description = computer ? 'The computer is lining up its next shot' : view.canSelectCoin
          ? 'Hold the finger for more power; release to flick. Tap a coin to switch.'
          : 'Use the coin you just hit. Hold longer for more power; release to flick.';
      } else if (failedDuringShot) {
        title = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · ');
        description = battle ? 'No points this time. The next player goes when all coins stop.' : 'Wait for all coins to stop.'; turn = 'Foul · Coins in motion';
        if (view.foulReasons.includes('MULTI_HIT')) description = `${SECONDARY_HIT_TIP} ${description}`;
      } else if (view.phase === 'simulating') {
        title = 'Wait for the coins to stop'; description = 'The score is counted and play continues once all coins stop.'; turn = 'Shot in motion';
      } else if (view.phase === 'complete') {
        title = 'Game over'; description = 'Play again to beat your best score'; turn = 'Match complete';
      } else if (view.phase === 'failed') {
        const revives = campaign?.revivesRemaining ?? 3;
        title = revives > 0 ? `${revives} ${revives === 1 ? 'continue' : 'continues'} left` : 'Game over';
        description = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · '); turn = 'Chain broken';
      } else if (view.phase === 'error') {
        title = 'Something went wrong'; description = 'Restart or return to the Main Menu.'; turn = 'Play paused';
      }
      this.text('turn-label', turn);
      this.node('turn-label').hidden = !turn;
      this.text('prompt-title', title);
      this.text('prompt-description', description);
      const chargeTip = challenge && view.phase === 'ready' && !introducing && !transition && round <= 2 && view.shotCount < 3
        ? 'Release within 2 seconds of full charge, or the shot is canceled.'
        : '';
      const tutorial = challenge && !['paused', 'failed', 'error', 'complete'].includes(view.phase)
        ? [campaign?.tutorial, chargeTip].filter(Boolean).join('\n')
        : '';
      this.text('tutorial-tip', tutorial);
      this.node('tutorial-tip').hidden = !tutorial;
      const announcement = `${view.sessionId}:${view.phase}:${transition}:${introducing}:${round}:${view.currentPlayer}:${view.canSelectCoin}:${view.shotCount}:${view.foulReasons.join(',')}:${tutorial}:${computer}:${view.battle?.stage}:${view.battle?.openingAttempt}:${view.battle?.distances.join(',')}:${view.battle?.fallen.join(',')}`;
      if (announcement !== this.announced) {
        this.announced = announcement;
        this.text('live', [turn, title, description, tutorial].filter(Boolean)
          .map((part) => /[.!?]$/.test(part) ? part : `${part}.`).join(' '));
      }
    } else {
      this.announced = '';
      this.text('live', '');
    }
    this.updateLayers();
  }

  setLoading(message: string | null): void {
    this.loading = message;
    this.element.querySelectorAll<HTMLButtonElement>('.home-menu button').forEach((button) => { button.disabled = !!message; });
    this.updateLayers();
  }
  setError(message: string | null): void { this.externalError = message; this.updateLayers(); }
  setNotice(message: string | null): void {
    this.notice = message;
    if (!message) this.dismissedNotice = null;
    this.node('notice').hidden = !message || message === this.dismissedNotice;
    if (message) this.text('notice-message', message);
  }

  private button(name: string, label: string, action: string, hidden = false, icon?: string): void {
    const button = this.node<HTMLButtonElement>(name);
    if (icon) {
      if (button.dataset.icon !== action) button.innerHTML = icon;
      button.dataset.icon = action;
      button.setAttribute('aria-label', label);
      button.title = label;
    } else {
      this.text(name, label);
      delete button.dataset.icon;
      button.removeAttribute('aria-label');
      button.removeAttribute('title');
    }
    button.classList.toggle('modal-icon-button', !!icon);
    button.dataset.action = action;
    button.hidden = hidden;
    button.disabled = false;
  }

  private updateLayers(): void {
    const view = this.view;
    const error = this.externalError ?? (view?.phase === 'error' ? view.error : null);
    const state = error ? 'error' : view && (['failed', 'paused', 'error'].includes(view.phase) || (view.mode === 'battle' && view.phase === 'complete' && view.battle?.stage !== 'opening')) ? view.phase : '';
    this.node('modal').dataset.variant = state === 'paused' ? 'settings' : 'result';
    this.node('modal-seal').hidden = state === 'paused';
    this.node('modal-kicker').hidden = state === 'paused';
    this.node('modal-description').hidden = state === 'paused';
    if (state === 'paused') this.node('modal').removeAttribute('aria-describedby');
    else this.node('modal').setAttribute('aria-describedby', 'result-description');
    this.node('loading').hidden = !this.loading || !!state;
    if (this.loading) this.text('loading-message', this.loading);
    this.node('modal-layer').hidden = !state;
    if (state) {
      let title = '';
      let description = '';
      let score = '';
      this.text('modal-kicker', state === 'paused' ? 'Pause Menu' : state === 'error' ? 'Game Error' : view?.mode === 'battle' ? 'Match Results' : 'Run Results');
      if (state !== 'paused') this.button('modal-tertiary', 'Main Menu', 'home', true);
      if (state === 'paused') {
        title = 'Paused';
        this.button('modal-primary', 'Resume', 'pause', false, PLAY_ICON);
        this.button('modal-secondary', 'Restart', 'retry', false, RESTART_ICON);
        this.button('modal-tertiary', 'Main Menu', 'home', false, HOME_ICON);
      } else if (state === 'error') {
        title = 'Something went wrong';
        description = error ?? 'Restart the game or return to the Main Menu.';
        this.button('modal-primary', 'Restart', 'retry');
        this.button('modal-secondary', 'Main Menu', 'home');
      } else if (state === 'failed') {
        const revives = this.campaign?.revivesRemaining ?? 3;
        const revive = view?.mode === 'challenge' && revives > 0 && !!this.callbacks.revive;
        title = revive ? 'Chain broken' : 'Game over';
        const reasons = view!.foulReasons.map((reason) => FOUL_TEXT[reason]).join('; ');
        description = (reasons ? `${reasons}. ` : '')
          + (view!.foulReasons.includes('MULTI_HIT') ? `${SECONDARY_HIT_TIP} ` : '')
          + (revive ? (view!.foulReasons.includes('FALL') ? 'Fallen coins will return. Keep your score and pick a coin to continue. ' : 'Keep your score and coins. Pick a coin to continue. ') + `${revives} ${revives === 1 ? 'continue' : 'continues'} left.` : 'Play again to beat your best score.');
        score = `Score: ${this.campaign?.score ?? view!.scores[0]} · Best: ${this.campaign?.bestScore ?? 0}\nReached Round ${this.campaign?.round ?? 1}`;
        this.button('modal-primary', revive ? 'Continue' : 'Play Again', revive ? 'revive' : 'retry');
        this.button('modal-secondary', revive ? 'Restart' : 'Main Menu', revive ? 'retry' : 'home');
        this.button('modal-tertiary', 'Main Menu', 'home', !revive);
      } else if (view?.mode === 'battle') {
        const names = view.battle?.variant === 'pve' ? ['You', 'Computer'] : ['Player 1', 'Player 2'];
        const winScore = view.battleWinScore ?? 10;
        title = view.winner === 'draw' ? 'Draw' : view.winner === 0 && view.battle?.variant === 'pve' ? 'You win' : `${names[view.winner === 0 ? 0 : 1]} wins`;
        description = `First to ${winScore} points wins.`;
        score = `${names[0]} ${view.scores[0]}  :  ${view.scores[1]} ${names[1]}`;
        this.button('modal-primary', 'Play Again', 'retry');
        this.button('modal-secondary', 'Main Menu', 'home');
      }
      this.text('modal-title', title);
      this.text('modal-description', description);
      this.text('modal-score', score);
      this.node('modal-score').hidden = !score;
    }
    if (state !== this.modalState) {
      const previous = this.modalState;
      this.modalState = state;
      if (state) {
        if (!previous) this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.node('modal-primary').focus({ preventScroll: true });
      } else if (previous && this.previousFocus?.isConnected && !this.previousFocus.closest('[hidden]')) this.previousFocus.focus({ preventScroll: true });
    }
  }

  dispose(): void { this.events.abort(); this.element.remove(); }
}
