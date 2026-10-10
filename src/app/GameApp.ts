import { LEVELS } from '../content/levels';
import { GameSession } from '../core/GameSession';
import { PointerInput, chargePower } from '../input/PointerInput';
import { SaveAdapter, type SaveData } from '../platform/SaveAdapter';
import { SceneManager } from '../rendering/SceneManager';
import { Shell } from '../ui/Shell';
import { SoundManager } from '../ui/SoundManager';
import type { AimPreview, Direction, GameMode, GameView, WorldFrame } from '../types/contracts';

export class GameApp {
  private readonly save = new SaveAdapter(LEVELS.map(level => level.id));
  private progress: SaveData = this.save.read();
  private readonly sound = new SoundManager();
  private readonly shell: Shell;
  private readonly scene: SceneManager;
  private readonly pointer: PointerInput;
  private session: GameSession | null = null;
  private aim: AimPreview | null = null;
  private charging = false;
  private lastFrame: WorldFrame | null = null;
  private menu = true;
  private loading = false;
  private generation = 0;
  private animation = 0;
  private previousTime = 0;
  private previousView: GameView | null = null;
  private battleFirst: 0 | 1 = 0;
  private disposed = false;
  private lastLoad: { mode: GameMode; levelId: string; menu: boolean } | null = null;

  constructor(root: HTMLElement) {
    this.sound.enabled = this.progress.sound;
    this.shell = new Shell(root, LEVELS, {
      start: (mode, levelId) => { void this.start(mode, levelId); },
      retry: () => { void this.retry(); },
      home: () => { void this.home(); },
      next: () => { void this.next(); },
      pause: () => this.togglePause(),
      toggleSound: () => this.toggleSound(),
    });
    this.scene = new SceneManager(this.shell.canvasHost);
    this.pointer = new PointerInput(this.scene, () => ({
      view: this.menu || this.loading ? null : this.session?.view ?? null,
      frame: this.session?.frame ?? null,
    }), {
      shoot: (direction, power) => this.shoot(direction, power),
      pickCoin: id => this.pickCoin(id),
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.shell.render(null, this.progress.completed, this.progress.sound);
    this.animation = requestAnimationFrame(this.frame);
  }

  async initialize(): Promise<void> {
    await this.load('challenge', LEVELS[0].id, true);
  }

  private async load(mode: GameMode, levelId: string, menu: boolean): Promise<void> {
    const level = LEVELS.find(item => item.id === levelId);
    if (!level || this.disposed) return;
    this.lastLoad = { mode, levelId, menu };
    const generation = ++this.generation;
    this.loading = true;
    this.pointer.cancel();
    this.aim = null;
    this.lastFrame = null;
    this.previousView = null;
    this.session?.dispose();
    this.session = null;
    this.shell.setError(null);
    this.shell.setLoading('正在准备桌面…');
    try {
      await this.scene.initializeHand();
      if (this.disposed || generation !== this.generation) return;
      const candidate = await GameSession.create(level, mode, mode === 'battle' ? this.battleFirst : 0);
      if (this.disposed || generation !== this.generation) { candidate.dispose(); return; }
      this.session = candidate;
      this.menu = menu;
      this.scene.setLevel(level);
      this.scene.clearFocus();
      this.previousTime = 0;
      this.loading = false;
      this.shell.setLoading(null);
      this.shell.render(menu ? null : candidate.view, this.progress.completed, this.progress.sound);
      this.shell.setNotice(this.save.lastError);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.loading = false;
      this.menu = true;
      this.shell.setLoading(null);
      this.shell.render(null, this.progress.completed, this.progress.sound);
      this.shell.setError(`桌面加载失败，请重新选择关卡。${error instanceof Error ? error.message : ''}`);
    }
  }

  private async start(mode: GameMode, levelId: string): Promise<void> {
    if (this.loading) return;
    if (mode === 'challenge') {
      const index = LEVELS.findIndex(level => level.id === levelId);
      if (index < 0 || (index > 0 && !this.progress.completed.includes(levelId) && !this.progress.completed.includes(LEVELS[index - 1].id))) return;
    }
    this.sound.unlock();
    if (mode === 'battle') this.battleFirst = 0;
    await this.load(mode, levelId, false);
  }

  private shoot(direction: Direction, power: number): void {
    this.sound.unlock();
    if (!this.menu && !this.loading && this.session?.shoot(direction, power)) this.sound.play('flick');
  }

  /** Entry/turn launch choices stay editable until firing; relay targets stay fixed. */
  private pickCoin(id: string): void {
    if (this.menu || this.loading || !this.session) return;
    const view = this.session.view;
    if (!view.canSelectCoin || !['selecting', 'ready'].includes(view.phase) || !this.session.frame.coins.some((coin) => coin.id === id)) return;
    if (!this.session.selectCoin(id)) return;
    this.scene.focusCoin(id);
    this.shell.render(this.session.view, this.progress.completed, this.progress.sound);
  }

  private async retry(): Promise<void> {
    if (this.loading) return;
    if (!this.session) {
      if (this.lastLoad) {
        this.sound.unlock();
        await this.load(this.lastLoad.mode, this.lastLoad.levelId, this.lastLoad.menu);
      }
      return;
    }
    const view = this.session.view;
    if (view.phase === 'simulating') return;
    if (view.mode === 'battle' && view.phase === 'complete') this.battleFirst = this.battleFirst === 0 ? 1 : 0;
    this.sound.unlock();
    await this.load(view.mode, view.levelId, false);
  }

  private async home(): Promise<void> {
    if (this.loading) return;
    this.sound.unlock();
    await this.load('challenge', LEVELS[0].id, true);
  }

  private async next(): Promise<void> {
    if (this.loading || !this.session) return;
    const view = this.session.view;
    if (view.mode !== 'challenge' || view.phase !== 'complete') return;
    const index = LEVELS.findIndex(level => level.id === view.levelId);
    this.sound.unlock();
    if (index + 1 < LEVELS.length) await this.load('challenge', LEVELS[index + 1].id, false);
    else await this.home();
  }

  private togglePause(): void {
    if (this.menu || this.loading || !this.session) return;
    this.pointer.cancel();
    this.aim = null;
    this.lastFrame = null;
    this.sound.slide(0);
    if (this.session.view.phase === 'paused') { this.session.resume(); this.sound.unlock(); }
    else { this.session.pause(); this.sound.suspend(); }
    this.previousTime = 0;
  }

  private toggleSound(): void {
    this.progress.sound = !this.progress.sound;
    this.sound.enabled = this.progress.sound;
    if (this.progress.sound) this.sound.unlock();
    else this.sound.suspend();
    this.save.write(this.progress);
    this.shell.setNotice(this.save.lastError);
    this.shell.render(this.menu ? null : this.session?.view ?? null, this.progress.completed, this.progress.sound);
  }

  private readonly onVisibility = (): void => {
    if (document.hidden && !this.menu && this.session) {
      this.pointer.cancel();
      this.aim = null;
      this.lastFrame = null;
      this.session.pause();
      this.sound.suspend();
    }
    this.previousTime = 0;
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) this.dispose();
    else this.onVisibility();
  };

  private readonly frame = (time: number): void => {
    if (this.disposed) return;
    const elapsed = this.previousTime ? Math.min((time - this.previousTime) / 1000, 0.1) : 0;
    this.previousTime = time;
    if (this.session && !this.loading) {
      this.session.tick(elapsed);
      for (const feedback of new Set(this.session.drainFeedback())) {
        if (!this.menu) this.sound.play(feedback);
      }
      const view = this.session.view;
      if (!this.menu) {
        const previous = this.previousView;
        if (view.phase === 'selecting' && previous?.phase !== 'selecting') this.scene.clearFocus();
        if (view.activeCoinId && previous?.sessionId === view.sessionId && previous.activeCoinId !== view.activeCoinId) this.scene.focusCoin(view.activeCoinId);
        if (previous?.sessionId === view.sessionId) {
          if (view.scores[0] + view.scores[1] > previous.scores[0] + previous.scores[1]) this.sound.play(view.phase === 'complete' ? 'complete' : 'success');
          else if (!previous.foulReasons.length && view.foulReasons.length) this.sound.play('failure');
        }
        if (view.mode === 'challenge' && view.phase === 'complete' && !this.progress.completed.includes(view.levelId)) {
          this.progress.completed.push(view.levelId);
          this.save.write(this.progress);
          this.shell.setNotice(this.save.lastError);
        }
        this.previousView = view;
        this.shell.render(view, this.progress.completed, this.progress.sound);
      }
      // The charge is presentation state: hold duration drives both the finger pose and the shot power.
      const charge = this.menu || this.loading ? null : this.pointer.charge();
      this.aim = charge ? { source: charge.source, direction: this.scene.getAimDirection(), power: chargePower(charge.elapsedMs) } : null;
      if (charge && !this.charging) this.sound.play('aim');
      this.charging = !!charge;
      // Metallic scrape: track the fastest on-table mover while the shot is settling.
      let slide = 0;
      const frame = this.session.frame;
      if (!this.menu && view.phase === 'simulating' && this.lastFrame && elapsed > 0) {
        for (const coin of frame.coins) {
          const previous = this.lastFrame.coins.find((item) => item.id === coin.id);
          if (!previous || coin.position.y > 0.05) continue;
          const speed = Math.hypot(coin.position.x - previous.position.x, coin.position.z - previous.position.z) / elapsed;
          if (speed > 0.05) slide = Math.max(slide, Math.min(1, speed / 1.5));
        }
      }
      this.lastFrame = frame;
      this.sound.slide(this.menu ? 0 : slide);
      this.scene.render(frame, this.menu ? null : view, this.aim);
    }
    this.animation = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    cancelAnimationFrame(this.animation);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.pointer.dispose();
    this.session?.dispose();
    this.scene.dispose();
    this.shell.dispose();
    this.sound.dispose();
  }
}
