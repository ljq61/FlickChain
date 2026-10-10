import type { FoulReason, GameMode, GameView, LevelConfig } from '../types/contracts';
import './styles.css';

const FOUL_TEXT: Record<FoulReason, string> = {
  MISS: '没有碰到目标币',
  MULTI_HIT: '当前币直接碰到了多枚目标币',
  FALL: '有硬币掉下了桌面',
  TIMEOUT: '硬币未能在时限内停稳',
};

interface Callbacks {
  start: (mode: GameMode, levelId: string) => void;
  retry: () => void;
  home: () => void;
  next: () => void;
  pause: () => void;
  toggleSound: () => void;
}

/** Stable DOM: a frame update changes text and permissions, never rebuilds controls. */
export class Shell {
  private readonly element: HTMLDivElement;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly levelButtons = new Map<string, HTMLButtonElement>();
  private readonly events = new AbortController();
  private menuPage: 'home' | 'levels' = 'home';
  private view: GameView | null = null;
  private completed: string[] = [];
  private loading: string | null = null;
  private externalError: string | null = null;
  private notice: string | null = null;
  private dismissedNotice: string | null = null;
  private modalState = '';
  private previousFocus: HTMLElement | null = null;
  private announced = '';

  constructor(private readonly root: HTMLElement, private readonly levels: LevelConfig[], private readonly callbacks: Callbacks) {
    this.element = document.createElement('div');
    this.element.className = 'flick-shell';
    this.element.dataset.screen = 'home';
    this.element.innerHTML = `
      <div class="table-scene" data-el="canvas-host"></div>
      <header class="topbar">
        <div class="brand"><span class="brand-mark" aria-hidden="true">一</span><div><span class="brand-name">一弹到底</span><span class="brand-english">FLICKCHAIN</span></div></div>
        <button class="quiet-button sound-button" type="button" data-action="sound" data-el="sound" aria-pressed="true">声音 开</button>
      </header>
      <main class="home-menu" data-el="home">
        <div class="menu-intro"><p class="eyebrow">木桌 · 硬币 · 接力</p><h1>轻轻一弹，<br>接力到底。</h1><p class="menu-description">每杆只让当前币直接命中一枚目标币。<br>从它停下的位置，接着弹。</p></div>
        <div class="menu-actions"><button type="button" class="primary-button menu-button" data-action="levels">单人闯关 <span aria-hidden="true">↗</span></button><button type="button" class="secondary-button menu-button" data-action="battle">本地双人 <span aria-hidden="true">↗</span></button><p class="menu-progress" data-el="progress">从第一枚硬币开始</p></div>
        <p class="table-caption">同一张桌，所有硬币都公共</p>
      </main>
      <section class="levels-panel" data-el="levels" hidden aria-labelledby="level-heading"><div class="level-heading"><div><p class="eyebrow">一步步接得更远</p><h1 id="level-heading">选择关卡</h1></div><button type="button" class="quiet-button" data-action="menu">返回</button></div><p class="level-explanation">连续合法接力，只留最后一枚。任何失误都要重新开始。</p><div class="level-list" data-el="level-list"></div></section>
      <section class="game-hud" data-el="hud" hidden aria-label="对局信息"><div class="level-info"><span class="eyebrow" data-el="mode">单人闯关</span><h1 data-el="level-name"></h1><p data-el="objective">连续接力，直到只剩一枚</p></div><div class="scoreboard" data-el="scoreboard"><div class="score-cell" data-el="player-one"><span data-el="score-one-label">接力得分</span><strong data-el="score-one">0</strong></div><div class="score-cell" data-el="player-two" hidden><span>玩家二</span><strong data-el="score-two">0</strong></div><div class="remaining-cell"><strong data-el="remaining">2</strong><span>枚剩余</span></div></div></section>
      <footer class="play-footer" data-el="footer" hidden><div class="shot-prompt" data-el="shot-prompt"><div class="turn-label" data-el="turn-label">轮到你了</div><h2 data-el="prompt-title">旋转视角，准备弹射</h2><p data-el="prompt-description">空白处拖动旋转 · 点选硬币开始</p></div><div class="play-actions"><nav class="play-controls" aria-label="对局操作"><button type="button" class="quiet-button" data-action="pause" data-el="pause">暂停</button><button type="button" class="quiet-button" data-action="retry" data-el="retry">重试</button><button type="button" class="quiet-button" data-action="home">菜单</button></nav></div></footer>
      <div class="status-live" data-el="live" role="status" aria-live="polite" aria-atomic="true"></div>
      <aside class="notice-toast" data-el="notice" hidden aria-label="保存提示"><p data-el="notice-message" role="status"></p><button type="button" class="notice-dismiss" data-action="dismiss-notice" aria-label="关闭保存提示">关闭</button></aside>
      <div class="loading-layer" data-el="loading" hidden><div class="loading-card" role="status"><span class="loading-dot" aria-hidden="true"></span><p data-el="loading-message">正在准备棋盘</p></div></div>
      <div class="modal-layer" data-el="modal-layer" hidden><section class="result-card" data-el="modal" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description" tabindex="-1"><p class="eyebrow" data-el="modal-kicker">这一局</p><h2 id="result-title" data-el="modal-title"></h2><p id="result-description" data-el="modal-description"></p><div class="result-score" data-el="modal-score"></div><div class="modal-actions"><button type="button" class="primary-button" data-el="modal-primary" data-action="retry">再试一次</button><button type="button" class="secondary-button" data-el="modal-secondary" data-action="home">返回菜单</button><button type="button" class="text-button" data-el="modal-tertiary" data-action="levels-from-game" hidden>关卡列表</button></div></section></div>`;
    this.root.append(this.element);
    this.element.querySelectorAll<HTMLElement>('[data-el]').forEach((element) => this.elements.set(element.dataset.el!, element));
    const list = this.node('level-list');
    levels.forEach((level, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'level-card';
      button.dataset.levelId = level.id;
      const number = document.createElement('span');
      number.className = 'level-number';
      number.textContent = `${index + 1}`.padStart(2, '0');
      const detail = document.createElement('span');
      detail.className = 'level-card-detail';
      const name = document.createElement('strong');
      name.textContent = level.name;
      const lesson = document.createElement('span');
      lesson.textContent = level.lesson;
      detail.append(name, lesson);
      const state = document.createElement('span');
      state.className = 'level-state';
      button.append(number, detail, state);
      list.append(button);
      this.levelButtons.set(level.id, button);
    });
    const signal = this.events.signal;
    this.element.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.levelId) { this.callbacks.start('challenge', button.dataset.levelId); return; }
      switch (button.dataset.action) {
        case 'levels': this.menuPage = 'levels'; this.render(this.view, this.completed, this.node<HTMLButtonElement>('sound').getAttribute('aria-pressed') === 'true'); break;
        case 'menu': this.menuPage = 'home'; this.render(this.view, this.completed, this.node<HTMLButtonElement>('sound').getAttribute('aria-pressed') === 'true'); break;
        case 'battle': if (this.levels.length) this.callbacks.start('battle', this.levels[this.levels.length - 1].id); break;
        case 'home': this.menuPage = 'home'; this.callbacks.home(); break;
        case 'levels-from-game': this.menuPage = 'levels'; this.callbacks.home(); break;
        case 'retry': this.callbacks.retry(); break;
        case 'next': this.callbacks.next(); break;
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

  render(view: GameView | null, completed: string[], sound: boolean): void {
    this.view = view;
    this.completed = completed;
    const screen = view ? 'game' : this.menuPage;
    this.element.dataset.screen = screen;
    this.element.dataset.phase = view?.phase ?? 'menu';
    this.node('home').hidden = screen !== 'home';
    this.node('levels').hidden = screen !== 'levels';
    this.node('hud').hidden = !view;
    this.node('footer').hidden = !view;
    this.text('sound', sound ? '声音 开' : '已静音');
    this.node('sound').setAttribute('aria-pressed', String(sound));
    this.element.querySelectorAll<HTMLButtonElement>('.home-menu button').forEach((button) => { button.disabled = !!this.loading; });
    this.text('progress', completed.length ? `已完成 ${completed.length} / ${this.levels.length} 关` : '从第一枚硬币开始');
    this.levels.forEach((level, index) => {
      const button = this.levelButtons.get(level.id)!;
      const done = completed.includes(level.id);
      const unlocked = index === 0 || done || completed.includes(this.levels[index - 1].id);
      button.disabled = !unlocked || !!this.loading;
      button.dataset.status = done ? 'complete' : unlocked ? 'open' : 'locked';
      const state = button.querySelector<HTMLElement>('.level-state')!;
      const text = done ? '已完成' : unlocked ? '开始 ↗' : '待解锁';
      if (state.textContent !== text) state.textContent = text;
      button.setAttribute('aria-label', `第${index + 1}关，${level.name}，${done ? '已完成，可重玩' : unlocked ? '已解锁' : '待解锁'}`);
    });
    if (view) {
      const level = this.levels.find((candidate) => candidate.id === view.levelId);
      const levelIndex = this.levels.findIndex((candidate) => candidate.id === view.levelId);
      const battle = view.mode === 'battle';
      this.text('mode', battle ? '本地双人 · 公共棋盘' : `单人闯关 · ${String(levelIndex + 1).padStart(2, '0')}`);
      this.text('level-name', battle ? '最后一枚' : level?.name ?? '接力练习');
      this.text('objective', battle ? '合法接力 +1，失误换人；累计分高者获胜' : '连续合法接力，直到只剩一枚');
      this.text('score-one-label', battle ? '玩家一' : '接力得分');
      this.text('score-one', String(view.scores[0]));
      this.text('score-two', String(view.scores[1]));
      this.text('remaining', String(view.remaining));
      this.node('player-two').hidden = !battle;
      this.node('player-one').dataset.active = String(battle && view.currentPlayer === 0);
      this.node('player-two').dataset.active = String(battle && view.currentPlayer === 1);
      this.node<HTMLButtonElement>('retry').disabled = !['failed', 'complete', 'error'].includes(view.phase);
      this.node<HTMLButtonElement>('pause').disabled = ['failed', 'complete', 'error'].includes(view.phase);
      this.text('pause', view.phase === 'paused' ? '继续' : '暂停');
      const failedDuringShot = view.phase === 'simulating' && view.foulReasons.length > 0;
      this.node('shot-prompt').dataset.foul = String(failedDuringShot);
      let title = '旋转视角，准备弹射';
      let description = '空白处拖动旋转视角；点选硬币开始';
      let turn = battle ? `玩家${view.currentPlayer === 0 ? '一' : '二'}的回合` : '轮到你了';
      if (view.phase === 'selecting') {
        title = '点选一枚硬币直接开始';
        description = '点中的硬币立即成为当前币；旋转空白区域可改变视角';
      } else if (view.phase === 'ready') { title = '按住硬币后的手指蓄力'; description = '按得越久力度越大，松手沿视角前方弹射；点其他硬币可切换'; }
      else if (failedDuringShot) { title = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · '); description = battle ? '本杆不得分，停稳后交给下一位玩家' : '本次闯关失败，停稳后即可重试'; turn = '失误 · 正在收尾'; }
      else if (view.phase === 'simulating') { title = '让硬币停一停'; description = '整杆停稳后，才能计分并接力'; turn = '弹射中'; }
      else if (view.phase === 'paused') { title = '棋盘已暂停'; description = '继续后从当前棋盘接着玩'; turn = '稍作休息'; }
      else if (view.phase === 'complete') { title = '这一局结束了'; description = '再来一局，接得更远'; turn = '接力完成'; }
      else if (view.phase === 'failed') { title = '再试一次，找好方向'; description = view.foulReasons.map((reason) => FOUL_TEXT[reason]).join(' · '); turn = '本次未完成'; }
      else if (view.phase === 'error') { title = '棋盘需要重新准备'; description = '重建本局，或返回菜单'; turn = '已暂停操作'; }
      this.text('turn-label', turn);
      this.text('prompt-title', title);
      this.text('prompt-description', description);
      const announcement = `${view.sessionId}:${view.phase}:${view.currentPlayer}:${view.foulReasons.join(',')}`;
      if (announcement !== this.announced) { this.announced = announcement; this.text('live', `${turn}。${title}。${description}`); }
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

  private button(name: string, label: string, action: string, hidden = false): void {
    const button = this.node<HTMLButtonElement>(name);
    this.text(name, label);
    button.dataset.action = action;
    button.hidden = hidden;
    button.disabled = false;
  }

  private updateLayers(): void {
    const view = this.view;
    const error = this.externalError ?? (view?.phase === 'error' ? view.error : null);
    const state = error ? 'error' : view && ['failed', 'complete', 'paused', 'error'].includes(view.phase) ? view.phase : '';
    this.node('loading').hidden = !this.loading || !!state;
    if (this.loading) this.text('loading-message', this.loading);
    this.node('modal-layer').hidden = !state;
    if (state) {
      let title = '';
      let description = '';
      let score = '';
      this.text('modal-kicker', state === 'paused' ? '稍作休息' : state === 'error' ? '恢复棋盘' : view?.mode === 'battle' ? '本地双人 · 对局结果' : '单人闯关 · 本次结果');
      this.button('modal-tertiary', '关卡列表', 'levels-from-game', true);
      if (state === 'paused') {
        title = '歇一会儿，再接着弹';
        description = '棋盘和分数都为你保留着。';
        this.button('modal-primary', '继续游戏', 'pause');
        this.button('modal-secondary', '返回菜单', 'home');
      } else if (state === 'error') {
        title = '重新准备一下棋盘';
        description = error ?? '本局出现异常，请重建棋盘后继续。';
        this.button('modal-primary', '重建本局', 'retry');
        this.button('modal-secondary', '返回菜单', 'home');
      } else if (state === 'failed') {
        title = '这一杆没接住';
        description = view!.foulReasons.map((reason) => FOUL_TEXT[reason]).join('；') + '。调整方向和力度，再试一次。';
        score = `本次完成 ${view!.scores[0]} 次接力`;
        this.button('modal-primary', '再试一次', 'retry');
        this.button('modal-secondary', '关卡列表', 'levels-from-game');
      } else if (view?.mode === 'battle') {
        title = view.winner === 'draw' ? '势均力敌，平局' : `玩家${view.winner === 0 ? '一' : '二'}获胜`;
        description = '每一枚硬币都公共，每一次接力都算数。';
        score = `玩家一 ${view.scores[0]}  :  ${view.scores[1]} 玩家二`;
        this.button('modal-primary', '再来一局', 'retry');
        this.button('modal-secondary', '返回菜单', 'home');
      } else if (view) {
        const lastLevel = this.levels[this.levels.length - 1]?.id === view.levelId;
        title = lastLevel ? '所有练习，接力完成' : '接力完成！';
        description = '从第一枚到最后一枚，每一杆都刚刚好。';
        score = `${view.scores[0]} 次成功接力`;
        this.button('modal-primary', lastLevel ? '再玩一次' : '下一关', lastLevel ? 'retry' : 'next');
        this.button('modal-secondary', lastLevel ? '关卡列表' : '再玩一次', lastLevel ? 'levels-from-game' : 'retry');
        this.button('modal-tertiary', '关卡列表', 'levels-from-game', lastLevel);
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
