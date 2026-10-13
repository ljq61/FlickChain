/** Portal APIs stay at the application boundary; the game also works offline. */
export interface GamePlatform {
  initialize(): Promise<void>;
  setGameplay(active: boolean): void;
  setLoading(active: boolean): void;
  readonly muted: boolean;
  onMuteChange(listener: (muted: boolean) => void): () => void;
  dispose(): void;
}

export interface CrazyGamesSettings { muteAudio?: boolean }
export interface CrazyGamesSDK {
  init(): Promise<void>;
  readonly environment: string;
  readonly game: {
    readonly settings: CrazyGamesSettings;
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    addSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void;
    removeSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void;
  };
}

export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
type SDKWindow = Window & { CrazyGames?: { SDK?: CrazyGamesSDK } };
export type PlatformStatus = 'idle' | 'initializing' | 'ready' | 'disabled' | 'offline' | 'disposed';

/** The injected loader is a test seam, never a replacement SDK in production. */
export interface CrazyGamesAdapterOptions {
  loadSDK?: (signal: AbortSignal) => Promise<CrazyGamesSDK>;
  timeoutMs?: number;
}

function loadOfficialSDK(signal: AbortSignal): Promise<CrazyGamesSDK> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('CrazyGames SDK requires a browser'));
      return;
    }
    const sdkWindow = window as SDKWindow;
    if (sdkWindow.CrazyGames?.SDK) { resolve(sdkWindow.CrazyGames.SDK); return; }
    if (signal.aborted) { reject(new Error('CrazyGames SDK loading cancelled')); return; }
    const existing = [...document.scripts].find(script => script.src === CRAZYGAMES_SDK_URL);
    const script = existing ?? document.createElement('script');
    const cleanup = (): void => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onLoad = (): void => {
      cleanup();
      const sdk = sdkWindow.CrazyGames?.SDK;
      if (sdk) resolve(sdk);
      else reject(new Error('CrazyGames SDK did not expose its API'));
    };
    const onError = (): void => {
      cleanup();
      if (!existing) script.remove();
      reject(new Error('CrazyGames SDK could not be loaded'));
    };
    const onAbort = (): void => {
      cleanup();
      if (!existing) script.remove();
      reject(new Error('CrazyGames SDK loading cancelled'));
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (!existing) {
      script.src = CRAZYGAMES_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export class CrazyGamesAdapter implements GamePlatform {
  private sdk: CrazyGamesSDK | null = null;
  private initialization: Promise<void> | null = null;
  private readonly controller = new AbortController();
  private readonly loadSDK: (signal: AbortSignal) => Promise<CrazyGamesSDK>;
  private readonly timeoutMs: number;
  private desiredGameplay = false;
  private desiredLoading = false;
  private sentGameplay = false;
  private sentLoading = false;
  private settingsSubscribed = false;
  private isMuted = false;
  private currentStatus: PlatformStatus = 'idle';
  private currentEnvironment: string | null = null;
  private currentError: string | null = null;
  private readonly muteListeners = new Set<(muted: boolean) => void>();
  private readonly settingsListener = (settings: CrazyGamesSettings): void => {
    if (this.currentStatus === 'disposed') return;
    const muted = settings.muteAudio === true;
    if (muted === this.isMuted) return;
    this.isMuted = muted;
    for (const listener of this.muteListeners) this.safely(() => listener(muted));
  };

  constructor(options: CrazyGamesAdapterOptions = {}) {
    this.loadSDK = options.loadSDK ?? loadOfficialSDK;
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  get muted(): boolean { return this.isMuted; }
  get status(): PlatformStatus { return this.currentStatus; }
  get environment(): string | null { return this.currentEnvironment; }
  get lastError(): string | null { return this.currentError; }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.currentStatus === 'disposed') return Promise.resolve();
    this.currentStatus = 'initializing';
    this.initialization = this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('CrazyGames SDK initialization cancelled'));
        this.controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
          reject(new Error('CrazyGames SDK initialization timed out'));
          this.controller.abort();
        }, this.timeoutMs);
      });
      const sdk = await Promise.race([
        (async () => {
          const loaded = await this.loadSDK(this.controller.signal);
          if (this.controller.signal.aborted) throw new Error('CrazyGames SDK initialization cancelled');
          await loaded.init();
          return loaded;
        })(),
        cancelled,
      ]);
      if (this.currentStatus === 'disposed' || this.controller.signal.aborted) return;
      this.currentEnvironment = sdk.environment;
      // Disabled SDK modules throw even when their properties are accessed.
      if (sdk.environment !== 'local' && sdk.environment !== 'crazygames') {
        this.currentStatus = 'disabled';
        return;
      }
      this.sdk = sdk;
      this.currentStatus = 'ready';
      this.safely(() => {
        sdk.game.addSettingsChangeListener(this.settingsListener);
        this.settingsSubscribed = true;
        this.settingsListener(sdk.game.settings);
      });
      this.flush();
    } catch (error) {
      if (this.currentStatus !== 'disposed') {
        this.currentStatus = 'offline';
        this.currentError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) this.controller.signal.removeEventListener('abort', onAbort);
    }
  }

  setGameplay(active: boolean): void {
    if (this.currentStatus === 'disposed' || this.desiredGameplay === active) return;
    this.desiredGameplay = active;
    this.flush();
  }

  setLoading(active: boolean): void {
    if (this.currentStatus === 'disposed' || this.desiredLoading === active) return;
    this.desiredLoading = active;
    this.flush();
  }

  private flush(): void {
    const sdk = this.sdk;
    if (!sdk || this.currentStatus !== 'ready') return;
    const gameplay = this.desiredGameplay && !this.desiredLoading;
    // Stop play before loading; stop loading before reporting actual play.
    if (this.sentGameplay && !gameplay) {
      this.sentGameplay = false;
      this.safely(() => sdk.game.gameplayStop());
    }
    if (this.sentLoading !== this.desiredLoading) {
      this.sentLoading = this.desiredLoading;
      this.safely(() => this.sentLoading ? sdk.game.loadingStart() : sdk.game.loadingStop());
    }
    if (!this.sentGameplay && gameplay) {
      this.sentGameplay = true;
      this.safely(() => sdk.game.gameplayStart());
    }
  }

  onMuteChange(listener: (muted: boolean) => void): () => void {
    if (this.currentStatus === 'disposed') return () => {};
    this.muteListeners.add(listener);
    this.safely(() => listener(this.isMuted));
    return () => { this.muteListeners.delete(listener); };
  }

  private safely(action: () => void): void {
    try { action(); }
    catch (error) { this.currentError = error instanceof Error ? error.message : String(error); }
  }

  dispose(): void {
    if (this.currentStatus === 'disposed') return;
    // A real exit may close ongoing play/loading, unlike a focus change.
    this.desiredGameplay = false;
    this.desiredLoading = false;
    this.flush();
    this.currentStatus = 'disposed';
    this.controller.abort();
    const sdk = this.sdk;
    if (sdk && this.settingsSubscribed) this.safely(() => sdk.game.removeSettingsChangeListener(this.settingsListener));
    this.settingsSubscribed = false;
    this.muteListeners.clear();
    this.sdk = null;
  }
}
