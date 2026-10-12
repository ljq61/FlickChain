import type { SessionSnapshot } from '../core/GameSession';
import type { LevelConfig } from '../types/contracts';
import type { AiShot } from './BattleSearch';
import { PHYSICS_CONFIG } from '../physics/MaterialRegistry';
export type { AiShot } from './BattleSearch';

export type AIRequest = { id: number; kind: 'battle'; snapshot: SessionSnapshot }
  | { id: number; kind: 'opening'; level: LevelConfig };
export type AIResponse = { id: number; kind: 'battle'; shot: AiShot }
  | { id: number; kind: 'opening'; power: number } | { id: number; error: string };
type Pending = { id: number; resolve: (value: AiShot | number) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

/** One bounded job per client. Cancellation destroys the worker and rejects late decisions. */
export class AIClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextId = 0;
  private disposed = false;
  constructor(private readonly createWorker: () => Worker = () => new Worker(new URL('./BattleWorker.ts', import.meta.url), { type: 'module' })) {}
  choose(snapshot: SessionSnapshot): Promise<AiShot> {
    return this.request({ id: ++this.nextId, kind: 'battle', snapshot }) as Promise<AiShot>;
  }
  chooseOpening(level: LevelConfig): Promise<number> {
    return this.request({ id: ++this.nextId, kind: 'opening', level }) as Promise<number>;
  }
  private request(request: AIRequest): Promise<AiShot | number> {
    if (this.disposed) return Promise.reject(new Error('The computer shot planner has been disposed'));
    this.cancel();
    return new Promise((resolve, reject) => {
      try {
        const worker = this.worker ??= this.createWorker();
        this.pending = { id: request.id, resolve, reject, timer: setTimeout(() => this.fail(new Error('The computer shot timed out. Please restart the match.')), 10000) };
        worker.onmessage = (event: MessageEvent<AIResponse>) => {
          if (this.worker !== worker || !this.pending || event.data.id !== this.pending.id) return;
          if ('error' in event.data) { this.fail(new Error(event.data.error)); return; }
          const response = event.data;
          const valid = response.kind === request.kind && (response.kind === 'opening'
            ? Number.isFinite(response.power) && response.power >= PHYSICS_CONFIG.minPower && response.power <= 1
            : !!response.shot && typeof response.shot.coinId === 'string' && !!response.shot.coinId
              && !!response.shot.direction && [response.shot.direction.x, response.shot.direction.z, response.shot.power].every(Number.isFinite)
              && Math.hypot(response.shot.direction.x, response.shot.direction.z) >= PHYSICS_CONFIG.minDirectionLength
              && response.shot.power >= PHYSICS_CONFIG.minPower && response.shot.power <= 1);
          if (!valid) { this.fail(new Error('The computer returned an invalid shot. Please restart the match.')); return; }
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
          pending.resolve(event.data.kind === 'battle' ? event.data.shot : event.data.power);
        };
        worker.onerror = () => this.worker === worker && this.fail(new Error('The computer shot planner failed to load or run. Please restart the match.'));
        worker.onmessageerror = () => this.worker === worker && this.fail(new Error('The computer shot could not be read. Please restart the match.'));
        worker.postMessage(request);
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); reject(error); }
    });
  }
  private fail(error: Error): void {
    const pending = this.pending; this.pending = null;
    this.worker?.terminate(); this.worker = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
  }
  cancel(): void { this.fail(new DOMException('The computer shot was cancelled', 'AbortError')); }
  dispose(): void { this.disposed = true; this.cancel(); }
}
