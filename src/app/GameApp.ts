import { LEVELS } from '../content/levels';
import { generateRound, generateRevival } from '../content/CampaignGenerator';
import { GameSession } from '../core/GameSession';
import { PointerInput, chargePower } from '../input/PointerInput';
import { SaveAdapter, type SaveData } from '../platform/SaveAdapter';
import { SceneManager } from '../rendering/SceneManager';
import { Shell } from '../ui/Shell';
import { SoundManager } from '../ui/SoundManager';
import { COIN_THICKNESS } from '../physics/MaterialRegistry';
import { tableContainsPoint } from '../physics/TableGeometry';
import type { AimPreview, CampaignView, Direction, GameMode, GameView, LevelConfig, WorldFrame } from '../types/contracts';

interface CampaignRun {
  round: number;
  revivesRemaining: number;
  transition: CampaignView['transition'];
  error: boolean;
  seenIron: boolean;
  seenMarble: boolean;
  tutorial?: string;
}

export class GameApp {
  private readonly save = new SaveAdapter(LEVELS.map(level => level.id));
  private progress: SaveData = this.save.read();
  private readonly sound = new SoundManager(true);
  private readonly shell: Shell;
  private readonly scene: SceneManager;
  private readonly pointer: PointerInput;
  private session: GameSession | null = null;
  private aim: AimPreview | null = null;
  private charging = false;
  private impactIntensity = 0.5;
  private lastFrame: WorldFrame | null = null;
  private menu = true;
  private loading = false;
  private generation = 0;
  private animation = 0;
  private previousTime = 0;
  private previousView: GameView | null = null;
  private battleFirst: 0 | 1 = 0;
  private disposed = false;
  private currentLevel: LevelConfig | null = null;
  private run: CampaignRun | null = null;
  private lastLoad: { mode: GameMode; level: LevelConfig; menu: boolean } | null = null;

  constructor(root: HTMLElement, private readonly random: () => number = Math.random) {
    this.sound.enabled = this.progress.sound;
    this.shell = new Shell(root, LEVELS, {
      start: (mode, levelId) => { void this.start(mode, levelId); },
      retry: () => { void this.retry(); },
      home: () => { void this.home(); },
      next: () => {},
      revive: () => this.revive(),
      pause: () => this.togglePause(),
      toggleSound: () => this.toggleSound(),
    });
    this.scene = new SceneManager(this.shell.canvasHost);
    this.pointer = new PointerInput(this.scene, () => ({
      view: this.menu || this.loading || this.scene.isIntroducing || this.run?.transition ? null : this.session?.view ?? null,
      frame: this.session?.frame ?? null,
    }), {
      shoot: (direction, power) => this.shoot(direction, power),
      pickCoin: id => this.pickCoin(id),
      chargeFailed: () => this.sound.play('charge-failed'),
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.renderShell();
    this.animation = requestAnimationFrame(this.frame);
  }

  async initialize(): Promise<void> {
    await this.load('challenge', LEVELS[0], true);
  }

  private async load(mode: GameMode, level: LevelConfig, menu: boolean): Promise<void> {
    if (this.disposed) return;
    this.lastLoad = { mode, level: structuredClone(level), menu };
    const generation = ++this.generation;
    this.loading = true;
    this.pointer.cancel();
    this.aim = null;
    this.lastFrame = null;
    this.previousView = null;
    this.sound.stopCurrentSounds();
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
      this.currentLevel = level;
      this.menu = menu;
      this.scene.setLevel(level);
      this.scene.clearFocus();
      this.scene.beginCoinArrival(menu ? [] : candidate.frame.coins.map(coin => coin.id));
      if (this.run) { this.run.transition = 'arriving'; this.run.error = false; }
      this.previousTime = 0;
      this.loading = false;
      this.shell.setLoading(null);
      this.renderShell();
      this.shell.setNotice(this.save.lastError);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.loading = false;
      this.menu = true;
      this.shell.setLoading(null);
      if (this.run) this.run.error = true;
      this.renderShell();
      this.shell.setError(`桌面加载失败，请重新开始。${error instanceof Error ? error.message : ''}`);
    }
  }

  private async start(mode: GameMode, levelId: string): Promise<void> {
    if (this.loading) return;
    this.sound.unlock();
    if (mode === 'challenge') {
      this.run = { round: 1, revivesRemaining: 3, transition: 'arriving', error: false, seenIron: false, seenMarble: false };
      try {
        const level = generateRound(1, [], this.random);
        this.updateTutorial(level);
        await this.load(mode, level, false);
      }
      catch (error) { this.failCampaign(error); }
    } else {
      const level = LEVELS.find(item => item.id === levelId);
      if (!level) return;
      this.run = null;
      this.battleFirst = 0;
      await this.load(mode, level, false);
    }
  }

  private shoot(direction: Direction, power: number): void {
    this.sound.unlock();
    if (!this.menu && !this.loading && !this.scene.isIntroducing && !this.run?.transition && this.session?.shoot(direction, power)) {
      this.impactIntensity = 0.3 + power * 0.7;
      this.sound.play('flick', power);
    }
  }

  /** Entry/turn launch choices stay editable until firing; relay targets stay fixed. */
  private pickCoin(id: string): void {
    if (this.menu || this.loading || this.scene.isIntroducing || this.run?.transition || !this.session) return;
    const view = this.session.view;
    if (!view.canSelectCoin || !['selecting', 'ready'].includes(view.phase) || !this.session.frame.coins.some((coin) => coin.id === id)) return;
    if (!this.session.selectCoin(id)) return;
    this.scene.focusCoin(id);
    this.renderShell();
  }

  private async retry(): Promise<void> {
    if (this.loading) return;
    if (this.run) {
      if (this.session?.view.phase === 'simulating' || (this.run.transition && !this.run.error && this.session?.view.phase !== 'paused')) return;
      await this.start('challenge', LEVELS[0].id);
      return;
    }
    if (!this.session) {
      if (this.lastLoad) {
        this.sound.unlock();
        await this.load(this.lastLoad.mode, this.lastLoad.level, this.lastLoad.menu);
      }
      return;
    }
    const view = this.session.view;
    if (view.phase === 'simulating') return;
    if (view.mode === 'battle' && view.phase === 'complete') this.battleFirst = this.battleFirst === 0 ? 1 : 0;
    this.sound.unlock();
    const level = LEVELS.find(item => item.id === view.levelId);
    if (level) await this.load(view.mode, level, false);
  }

  private async home(): Promise<void> {
    if (this.loading) return;
    this.sound.unlock();
    this.run = null;
    await this.load('challenge', LEVELS[0], true);
  }

  private renderShell(): void {
    const view = this.menu ? null : this.session?.view ?? null;
    const campaign: CampaignView = {
      round: this.run?.round ?? 0, score: this.run ? this.session?.view.scores[0] ?? 0 : 0,
      bestScore: this.progress.bestScore, revivesRemaining: this.run?.revivesRemaining ?? 3,
      transition: this.run?.transition ?? null,
      tutorial: this.run?.tutorial,
    };
    this.shell.render(view, this.progress.completed, this.progress.sound, this.scene.isIntroducing, campaign);
  }

  private failCampaign(error: unknown): void {
    if (this.run) { this.run.error = true; this.run.transition = null; }
    this.pointer.cancel();
    this.sound.stopCurrentSounds();
    this.shell.setError(`桌面暂时无法继续，请重新开始。${error instanceof Error ? error.message : String(error)}`);
  }

  private beginRoundTransition(): void {
    if (!this.run || this.run.transition || this.run.error) return;
    this.run.transition = 'clearing';
    this.pointer.cancel();
    this.aim = null;
    this.lastFrame = null;
    this.sound.slide(0);
    this.scene.beginObstacleRemoval();
  }

  private updateTutorial(level: LevelConfig): void {
    if (!this.run) return;
    const tips: string[] = [];
    if (!this.run.seenIron && level.coins.some(coin => coin.materialId === 'iron')) {
      this.run.seenIron = true;
      tips.push('青色铁币重量和摩擦力更大');
    }
    if (!this.run.seenMarble && level.table.materialId === 'marble') {
      this.run.seenMarble = true;
      tips.push('大理石桌面比木头桌面更容易滑行，摩擦力更低');
    }
    this.run.tutorial = tips.join('；') || undefined;
  }

  private advanceCampaign(): void {
    if (!this.run || !this.session || this.run.error || this.session.view.phase === 'paused') return;
    if (this.run.transition === 'arriving') {
      if (!this.scene.isIntroducing) this.run.transition = null;
    } else if (this.run.transition === 'clearing' && !this.scene.isRemovingObstacles) {
      try {
        const retained = this.session.frame.coins;
        const level = generateRound(this.run.round + 1, retained, this.random);
        if (!this.session.advanceRound(level)) throw new Error('下一轮接力状态无效');
        const oldIds = new Set(retained.map(coin => coin.id));
        this.run.round++;
        this.currentLevel = level;
        this.updateTutorial(level);
        this.scene.setLevel(level, true);
        this.scene.beginCoinArrival(level.coins.filter(coin => !oldIds.has(coin.id)).map(coin => coin.id));
        this.run.transition = 'arriving';
        this.lastFrame = null;
        this.previousView = null;
      } catch (error) { this.failCampaign(error); }
    }
  }

  private revive(): void {
    if (this.loading || this.menu || !this.run || this.run.revivesRemaining === 0 || this.run.transition
      || this.run.error || !this.session || !this.currentLevel || this.session.view.phase !== 'failed') return;
    try {
      const retained = this.session.frame.coins;
      const level = generateRevival(this.currentLevel, retained, this.session.lastFallenCoinIds.length, this.random);
      if (!this.session.revive(level)) throw new Error('复活状态无效');
      this.run.revivesRemaining--;
      this.run.transition = 'arriving';
      this.currentLevel = level;
      this.pointer.cancel();
      this.aim = null;
      this.lastFrame = null;
      this.previousView = null;
      this.sound.stopCurrentSounds();
      this.sound.unlock();
      this.scene.setLevel(level, true);
      this.scene.clearFocus();
      const oldIds = new Set(retained.map(coin => coin.id));
      this.scene.beginCoinArrival(level.coins.filter(coin => !oldIds.has(coin.id)).map(coin => coin.id));
      this.renderShell();
    } catch (error) { this.failCampaign(error); }
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
    this.renderShell();
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.sound.suspend();
    if (document.hidden && !this.menu && this.session) {
      this.pointer.cancel();
      this.aim = null;
      this.lastFrame = null;
      this.session.pause();
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
      if (!this.menu && this.session.view.phase !== 'paused') {
        if (this.run?.transition === 'clearing') this.scene.advanceObstacleRemoval(elapsed);
        else for (const _id of this.scene.advanceCoinArrival(elapsed)) this.sound.play('land', 0.6);
        this.advanceCampaign();
      }
      this.session.tick(elapsed);
      for (const feedback of new Set(this.session.drainFeedback())) {
        if (!this.menu) this.sound.play(feedback, this.impactIntensity);
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
        if (this.run && view.scores[0] > this.progress.bestScore) {
          this.progress.bestScore = view.scores[0];
          this.save.write(this.progress);
          this.shell.setNotice(this.save.lastError);
        }
        if (this.run && view.phase === 'complete') this.beginRoundTransition();
        this.previousView = view;
        this.renderShell();
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
          if (!previous || coin.position.y < -0.002 || coin.position.y > COIN_THICKNESS / 2 + 0.008
            || !tableContainsPoint(frame.table, coin.position.x, coin.position.z)) continue;
          const speed = Math.hypot(coin.position.x - previous.position.x, coin.position.z - previous.position.z) / elapsed;
          if (speed > 0.05) slide = Math.max(slide, Math.min(1, speed / 1.5));
        }
      }
      this.lastFrame = frame;
      if (view.phase === 'simulating') this.impactIntensity = Math.max(0.12, slide);
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
