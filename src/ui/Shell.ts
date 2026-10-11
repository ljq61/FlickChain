import type { BattleVariant, CampaignView, FoulReason, GameMode, GameView, LevelConfig } from '../types/contracts';
import { TITLE_LOGO } from './TitleLogo';
import './styles.css';

const FOUL_TEXT: Record<FoulReason, string> = {
  MISS: '没有碰到目标币',
  MULTI_HIT: '当前币直接碰到了多枚目标币',
  FALL: '有硬币掉下了桌面',
  TIMEOUT: '硬币未能在时限内停稳',
};

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
        <div class="brand"><span class="brand-mark">${COIN_ICON}</span><div><span class="brand-name">一弹到底</span><span class="brand-english">FLICKCHAIN</span></div></div>
        <nav class="corner-controls" aria-label="声音与设置">
        <button class="quiet-button sound-button" type="button" data-action="sound" data-el="sound" aria-pressed="true" aria-label="声音 开"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 10h5l6-5v18l-6-5H5V10Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path class="sound-waves" d="M20 9a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="sound-muted" d="m20 11 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="status-label" data-el="sound-label">声音 开</span></button>
        <button type="button" class="quiet-button settings-button" data-action="pause" data-el="pause" aria-label="设置" hidden><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="m11.5 3-.7 3-2 .9-2.7-.8-2.5 4.3 2 2.2v2.8l-2 2.2 2.5 4.3 2.7-.8 2 .9.7 3h5l.7-3 2-.9 2.7.8 2.5-4.3-2-2.2v-2.8l2-2.2-2.5-4.3-2.7.8-2-.9-.7-3h-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="14" cy="14" r="4" stroke="currentColor" stroke-width="1.7"/></svg></button>
        </nav>
      </header>
      <main class="home-menu" data-el="home">
        <div class="menu-intro"><h1 class="title-logo" aria-label="一弹到底">${TITLE_LOGO}</h1></div>
        <div class="menu-actions" data-el="main-actions"><button type="button" class="primary-button menu-button" data-action="challenge"><span class="button-icon">${COIN_ICON}</span><span class="button-label">单人游戏</span>${CHEVRON_ICON}</button><button type="button" class="secondary-button menu-button" data-action="battle"><span class="button-icon">${PEOPLE_ICON}</span><span class="button-label">本地对战</span>${CHEVRON_ICON}</button><p class="menu-progress" data-el="progress">本地最高 0 分</p></div>
        <div class="menu-actions battle-menu" data-el="battle-actions" hidden><div class="battle-menu-heading"><button type="button" class="quiet-button menu-back" data-action="battle-back" aria-label="返回主界面" title="返回主界面">${BACK_ICON}</button><h2>本地对战</h2></div><button type="button" class="primary-button menu-button battle-choice" data-action="pvp" aria-label="PVP 玩家对战"><span class="button-icon">${PEOPLE_ICON}</span><span class="button-label">PVP<small>玩家对战</small></span>${CHEVRON_ICON}</button><button type="button" class="secondary-button menu-button battle-choice" data-action="pve" aria-label="PVE 人机对战"><span class="button-icon">${COMPUTER_ICON}</span><span class="button-label">PVE<small>人机对战</small></span>${CHEVRON_ICON}</button><p class="menu-progress">比远争先 · 先得 10 分获胜</p></div>
        <p class="table-caption">同一张桌，所有硬币都公共</p>
      </main>
      <section class="game-hud" data-el="hud" hidden aria-label="对局信息"><div class="score-panel"><div class="scoreboard" data-el="scoreboard"><div class="score-cell" data-el="player-one"><strong data-el="score-one">0</strong><span data-el="score-one-label">分</span></div><div class="score-cell" data-el="player-two" hidden><span data-el="score-two-label">玩家二</span><strong data-el="score-two">0</strong></div><div class="remaining-cell" data-el="remaining-cell"><strong data-el="remaining">3</strong><span data-el="remaining-label">次机会</span></div></div><div class="level-info"><span class="eyebrow" data-el="mode" hidden></span><h1 data-el="level-name"></h1><p data-el="objective" hidden>留住最后一枚，继续下一轮</p></div></div></section>
      <footer class="play-footer" data-el="footer" hidden><div class="shot-prompt" data-el="shot-prompt"><div class="turn-label" data-el="turn-label" hidden></div><h2 data-el="prompt-title">旋转视角，准备弹射</h2><p data-el="prompt-description">空白处拖动旋转 · 点选硬币开始</p><p class="tutorial-tip" data-el="tutorial-tip" hidden></p></div><p class="best-score" data-el="best-score" hidden>本地最高 0 分</p></footer>
      <div class="status-live" data-el="live" role="status" aria-live="polite" aria-atomic="true"></div>
      <aside class="notice-toast" data-el="notice" hidden aria-label="保存提示"><p data-el="notice-message" role="status"></p><button type="button" class="notice-dismiss" data-action="dismiss-notice" aria-label="关闭保存提示">关闭</button></aside>
      <div class="loading-layer" data-el="loading" hidden><div class="loading-card" role="status"><span class="loading-dot" aria-hidden="true"></span><p data-el="loading-message">正在准备棋盘</p></div></div>
      <div class="modal-layer" data-el="modal-layer" hidden><section class="result-card" data-el="modal" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description" tabindex="-1"><div class="bill-seal" data-el="modal-seal" aria-hidden="true">${COIN_ICON}</div><p class="eyebrow" data-el="modal-kicker">这一局</p><h2 id="result-title" data-el="modal-title"></h2><p id="result-description" data-el="modal-description"></p><div class="result-score" data-el="modal-score"></div><div class="modal-actions"><button type="button" class="primary-button" data-el="modal-primary" data-action="retry">再试一次</button><button type="button" class="secondary-button" data-el="modal-secondary" data-action="home">返回菜单</button><button type="button" class="text-button" data-el="modal-tertiary" data-action="home" hidden>返回菜单</button></div></section></div>`;
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
    this.node('hud').hidden = !view;
    this.node('footer').hidden = !view;
    this.node('pause').hidden = !view;
    this.text('sound-label', sound ? '声音 开' : '已静音');
    this.node('sound').setAttribute('aria-label', sound ? '声音 开' : '已静音');
    this.node('sound').setAttribute('aria-pressed', String(sound));
    this.element.querySelectorAll<HTMLButtonElement>('.home-menu button').forEach((button) => { button.disabled = !!this.loading; });
    this.text('progress', `本地最高 ${campaign?.bestScore ?? 0} 分`);
    if (view) {
      const battle = view.mode === 'battle';
      const opening = battle && view.battle?.stage === 'opening';
      const computer = view.inputOwner === 'computer';
      const winScore = view.battleWinScore ?? 10;
      const playerNames = view.battle?.variant === 'pve' ? ['你', '电脑'] : ['玩家一', '玩家二'];
      const currentName = playerNames[view.currentPlayer];
      this.element.dataset.battleStage = view.battle?.stage ?? '';
      const round = campaign?.round ?? 1;
      this.text('mode', battle ? `${view.battle?.variant === 'pve' ? '人机' : '双人'}抢 ${winScore} 分` : '');
      this.node('mode').hidden = !battle;
      this.text('level-name', battle ? opening ? '比远争先' : '' : `第 ${round} 轮`);
      this.node('level-name').hidden = battle && !opening;
      this.text('objective', '合法接力 +1 · 失误换手');
      this.node('objective').hidden = !battle || opening;
      this.text('best-score', `本地最高 ${campaign?.bestScore ?? 0} 分`);
      this.node('best-score').hidden = false;
      this.text('score-one-label', battle ? playerNames[0] : '分');
      this.text('score-two-label', playerNames[1]);
      const openingDistance = (player: 0 | 1): string => view.battle!.fallen[player] ? '掉落弃权'
        : view.battle!.distances[player] === null ? '未弹' : `${Math.round(view.battle!.distances[player]! * 100)} cm`;
      this.text('score-one', opening ? openingDistance(0) : String(battle ? view.scores[0] : campaign?.score ?? view.scores[0]));
      this.text('score-two', opening ? openingDistance(1) : String(view.scores[1]));
      this.text('remaining', String(battle ? view.remaining : campaign?.revivesRemaining ?? 3));
      this.text('remaining-label', battle ? '枚剩余' : '次机会');
      this.node('remaining-cell').hidden = !!opening;
      this.node('player-two').hidden = !battle;
      this.node('player-one').dataset.active = String(battle && view.currentPlayer === 0);
      this.node('player-two').dataset.active = String(battle && view.currentPlayer === 1);
      this.node<HTMLButtonElement>('pause').disabled = ['failed', 'error'].includes(view.phase) || (battle && view.phase === 'complete' && !opening);
      const failedDuringShot = view.phase === 'simulating' && view.foulReasons.length > 0;
      this.node('shot-prompt').dataset.foul = String(failedDuringShot);
      let title = '旋转视角，准备弹射';
      let description = '空白处拖动旋转视角；点选硬币开始';
      let turn = battle ? `${currentName}的回合` : '';
      if (view.phase === 'paused') {
        title = '棋盘已暂停'; description = '继续后从当前棋盘接着玩'; turn = '稍作休息';
      } else if (opening && view.phase !== 'error') {
        title = view.phase === 'complete' ? view.battle!.fallen[view.currentPlayer] ? `${currentName}掉落，放弃先手` : `${currentName}弹出 ${openingDistance(view.currentPlayer)}`
          : computer ? '电脑正在比远' : '比远争先';
        description = view.phase === 'simulating' ? '等这枚金币停稳，记录弹出的距离'
          : view.phase === 'complete' ? view.winner === 0 || view.winner === 1 ? `${playerNames[view.winner]}获得先手，准备九枚硬币`
            : '准备下一位；同距或双方掉落会重新比远'
          : computer ? '各弹一枚，停稳更远者先手，掉落放弃先手'
          : '按住手指蓄力，松手直弹；停稳更远者先手，掉落放弃先手';
        turn = `第 ${view.battle!.openingAttempt} 次比远 · ${currentName}`;
      } else if (view.phase === 'refilling') {
        title = view.battle?.variant === 'pve' ? '随机新增八枚硬币' : '重新摆满九枚硬币'; description = '残局和双方分数保留，硬币落稳后继续'; turn = '正在摆桌';
      } else if (transition === 'clearing' || (challenge && view.phase === 'complete')) {
        title = '留住这一枚，下一轮接着来'; description = '整理桌面，准备新的硬币'; turn = '本轮接力完成';
      } else if (transition === 'arriving' || introducing) {
        title = '硬币轻落桌面';
        description = view.activeCoinId ? '新硬币落稳后，从留下的这枚继续' : '稍等片刻，落稳后点选一枚开始';
        turn = '正在摆桌';
      } else if (view.phase === 'selecting') {
        title = computer ? '电脑思考中' : '点选一枚硬币直接开始';
        description = computer ? '稍等片刻，电脑会选择并弹射一枚硬币' : '点中的硬币立即成为当前币；旋转空白区域可改变视角';
      } else if (view.phase === 'ready') {
        title = computer ? '电脑思考中' : '按住硬币后的手指蓄力';
        description = computer ? '让这一杆停稳后，再继续对战' : view.canSelectCoin
          ? '发射前可点其他硬币换起手；按得越久力度越大，松手弹射'
          : '接着刚击中的硬币继续；按得越久力度越大，松手弹射';
      } else if (failedDuringShot) {
        title = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · ');
        description = battle ? '本杆不得分，停稳后交给下一位玩家' : '停稳后查看本次结果'; turn = '失误 · 正在收尾';
      } else if (view.phase === 'simulating') {
        title = '让硬币停一停'; description = '整杆停稳后，才能计分并接力'; turn = '弹射中';
      } else if (view.phase === 'complete') {
        title = '这一局结束了'; description = '再来一局，接得更远'; turn = '接力完成';
      } else if (view.phase === 'failed') {
        const revives = campaign?.revivesRemaining ?? 3;
        title = revives > 0 ? `还剩 ${revives} 次复活机会` : '本次闯关结束';
        description = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · '); turn = '这一杆没接住';
      } else if (view.phase === 'error') {
        title = '棋盘需要重新准备'; description = '重新开始，或返回菜单'; turn = '已暂停操作';
      }
      this.text('turn-label', turn);
      this.node('turn-label').hidden = !turn;
      this.text('prompt-title', title);
      this.text('prompt-description', description);
      const chargeTip = challenge && view.phase === 'ready' && !introducing && !transition && round <= 2 && view.shotCount < 3
        ? '满力后持续按住2秒会蓄力失败，请松手重新蓄力'
        : '';
      const tutorial = challenge && !['paused', 'failed', 'error', 'complete'].includes(view.phase)
        ? [campaign?.tutorial, chargeTip].filter(Boolean).join('\n')
        : '';
      this.text('tutorial-tip', tutorial);
      this.node('tutorial-tip').hidden = !tutorial;
      const announcement = `${view.sessionId}:${view.phase}:${transition}:${introducing}:${round}:${view.currentPlayer}:${view.canSelectCoin}:${view.shotCount}:${view.foulReasons.join(',')}:${tutorial}:${computer}:${view.battle?.stage}:${view.battle?.openingAttempt}:${view.battle?.distances.join(',')}:${view.battle?.fallen.join(',')}`;
      if (announcement !== this.announced) { this.announced = announcement; this.text('live', [turn, title, description, tutorial].filter(Boolean).join('。')); }
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
      this.text('modal-kicker', state === 'paused' ? '设置' : state === 'error' ? '恢复棋盘' : view?.mode === 'battle' ? '本地对战 · 对局结果' : '单人闯关 · 本次结果');
      if (state !== 'paused') this.button('modal-tertiary', '返回菜单', 'home', true);
      if (state === 'paused') {
        title = '游戏设置';
        this.button('modal-primary', '继续游戏', 'pause', false, PLAY_ICON);
        this.button('modal-secondary', '重新开始', 'retry', false, RESTART_ICON);
        this.button('modal-tertiary', '返回菜单', 'home', false, HOME_ICON);
      } else if (state === 'error') {
        title = '重新准备一下棋盘';
        description = error ?? '本局出现异常，请重建棋盘后继续。';
        this.button('modal-primary', '重建本局', 'retry');
        this.button('modal-secondary', '返回菜单', 'home');
      } else if (state === 'failed') {
        const revives = this.campaign?.revivesRemaining ?? 3;
        const revive = view?.mode === 'challenge' && revives > 0 && !!this.callbacks.revive;
        title = revive ? '这一杆没接住' : '本次闯关结束';
        description = view!.foulReasons.map((reason) => FOUL_TEXT[reason]).join('；') + '。'
          + (revive ? (view!.foulReasons.includes('FALL') ? '补回掉落的硬币，重新选择一枚继续。' : '桌面和累计分保留，重新选择一枚继续。') + `剩余 ${revives} 次复活机会。` : '再来一局，接得更远。');
        score = `累计 ${this.campaign?.score ?? view!.scores[0]} 分 · 最高 ${this.campaign?.bestScore ?? 0} 分\n到达第 ${this.campaign?.round ?? 1} 轮`;
        this.button('modal-primary', revive ? '复活继续' : '再来一局', revive ? 'revive' : 'retry');
        this.button('modal-secondary', revive ? '重新开始' : '返回菜单', revive ? 'retry' : 'home');
        this.button('modal-tertiary', '返回菜单', 'home', !revive);
      } else if (view?.mode === 'battle') {
        const names = view.battle?.variant === 'pve' ? ['你', '电脑'] : ['玩家一', '玩家二'];
        const winScore = view.battleWinScore ?? 10;
        title = view.winner === 'draw' ? '势均力敌，平局' : `${names[view.winner === 0 ? 0 : 1]}获胜`;
        description = `先得 ${winScore} 分者胜利，每一次合法接力都算数。`;
        score = `${names[0]} ${view.scores[0]}  :  ${view.scores[1]} ${names[1]}`;
        this.button('modal-primary', '再来一局', 'retry');
        this.button('modal-secondary', '返回菜单', 'home');
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
