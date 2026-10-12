import { coinRadius } from '../physics/MaterialRegistry';
import { tableContainsPoint } from '../physics/TableGeometry';
import type { SceneManager } from '../rendering/SceneManager';
import type { Direction, GameView, Vec3, WorldFrame } from '../types/contracts';

const SELECT_CANCEL_DISTANCE = 12;
const MIN_HIT_RADIUS = 22;
const FINGER_HIT_RADIUS = 40;
const FINGER_MIN_FIRE_MS = 160;
const FULL_CHARGE_MS = 1250;
const MAX_CHARGE_HOLD_MS = FULL_CHARGE_MS + 2000;

/** Power ramps with hold duration; the finger curl and tremble behind the coin visualize it. */
export function chargePower(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / FULL_CHARGE_MS);
}

interface CommonGesture {
  pointerId: number;
  sessionId: string;
  revision: number;
  phase: 'ready' | 'selecting';
  player: number;
}

interface ShotGesture extends CommonGesture {
  kind: 'shot';
  coinId: string;
  source: Vec3;
  startedAt: number;
}

interface SelectGesture extends CommonGesture {
  kind: 'select';
  coinId: string;
  clientStart: { x: number; y: number };
}

interface OrbitGesture extends CommonGesture {
  kind: 'orbit';
  last: { x: number; y: number };
}

type Gesture = ShotGesture | SelectGesture | OrbitGesture;

/** Pointer ownership: holding the finger/coin charges a shot, blank-table drag rotates the camera. */
export class PointerInput {
  private readonly events = new AbortController();
  private readonly pointers = new Set<number>();
  private gesture: Gesture | null = null;

  constructor(
    private readonly scene: SceneManager,
    private readonly getState: () => { view: GameView | null; frame: WorldFrame | null },
    private readonly callbacks: {
      shoot: (direction: Direction, power: number) => void;
      pickCoin: (id: string) => void;
      chargeFailed?: () => void;
    },
  ) {
    const signal = this.events.signal;
    const canvas = scene.canvas;
    canvas.style.touchAction = 'none';
    window.addEventListener('pointerdown', (event) => {
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1) this.cancel();
    }, { capture: true, signal });
    canvas.addEventListener('pointerdown', (event) => this.begin(event), { signal });
    canvas.addEventListener('pointermove', (event) => this.move(event), { signal });
    window.addEventListener('pointerup', (event) => {
      this.finish(event);
      this.pointers.delete(event.pointerId);
    }, { capture: true, signal });
    window.addEventListener('pointercancel', (event) => {
      if (event.pointerId === this.gesture?.pointerId) this.cancel();
      this.pointers.delete(event.pointerId);
    }, { capture: true, signal });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === this.gesture?.pointerId) this.cancel();
    }, { signal });
    // Some mobile browsers dispatch this during an ordinary charge hold.
    // Suppress the menu without treating it as a cancelled game gesture.
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    window.addEventListener('blur', () => { this.cancel(); this.pointers.clear(); }, { signal });
    window.addEventListener('resize', () => this.cancel(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.cancel(); this.pointers.clear(); }
    }, { signal });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.cancel(); }, { signal });
  }

  /** Live charge state for per-frame presentation; null outside an active hold. */
  charge(): { source: Vec3; elapsedMs: number } | null {
    const gesture = this.gesture;
    if (!gesture || gesture.kind !== 'shot') return null;
    const { view, frame } = this.getState();
    if (!view || !frame || !this.valid(gesture)) { this.cancel(); return null; }
    const elapsedMs = performance.now() - gesture.startedAt;
    if (this.expireCharge(gesture, elapsedMs)) return null;
    return { source: gesture.source, elapsedMs };
  }

  private begin(event: PointerEvent): void {
    if (this.gesture || this.pointers.size > 1 || event.button !== 0 || !event.isPrimary) return;
    const { view, frame } = this.getState();
    if (!view || !frame || view.inputOwner === 'computer' || (view.phase !== 'ready' && view.phase !== 'selecting')) return;
    const coin = this.findCoin(view, frame, event.clientX, event.clientY);
    event.preventDefault();
    if (coin && view.canSelectCoin && (view.phase === 'selecting' || coin.id !== view.activeCoinId)) {
      // Before this turn's first shot, another public coin can replace the launch choice.
      this.gesture = {
        kind: 'select', pointerId: event.pointerId, sessionId: view.sessionId, revision: view.revision,
        phase: view.phase, player: view.currentPlayer, coinId: coin.id,
        clientStart: { x: event.clientX, y: event.clientY },
      };
    } else if (coin) {
      this.gesture = {
        kind: 'shot', pointerId: event.pointerId, sessionId: view.sessionId, revision: view.revision,
        phase: view.phase, player: view.currentPlayer, coinId: coin.id, source: { ...coin.position },
        startedAt: performance.now(),
      };
    } else {
      if (view.battle?.stage === 'opening') return;
      this.gesture = {
        kind: 'orbit', pointerId: event.pointerId, sessionId: view.sessionId, revision: view.revision,
        phase: view.phase, player: view.currentPlayer, last: { x: event.clientX, y: event.clientY },
      };
    }
    try { this.scene.canvas.setPointerCapture(event.pointerId); }
    catch { this.cancel(); }
  }

  private findCoin(view: GameView, frame: WorldFrame, clientX: number, clientY: number) {
    const candidates = frame.coins.filter((coin) => {
      const position = coin.position;
      return position.y >= -0.004 && tableContainsPoint(frame.table, position.x, position.z);
    });
    let nearest: typeof candidates[number] | undefined;
    let nearestDistance = Infinity;
    for (const coin of candidates) {
      const center = this.scene.projectToScreen(coin.position);
      const radius = coinRadius(coin.materialId);
      const edgeX = this.scene.projectToScreen({ ...coin.position, x: coin.position.x + radius });
      const edgeZ = this.scene.projectToScreen({ ...coin.position, z: coin.position.z + radius });
      const hitRadius = Math.max(MIN_HIT_RADIUS, Math.hypot(edgeX.x - center.x, edgeX.y - center.y) * 1.4, Math.hypot(edgeZ.x - center.x, edgeZ.y - center.y) * 1.4);
      const distance = Math.hypot(center.x - clientX, center.y - clientY);
      if (distance <= hitRadius && distance < nearestDistance) { nearest = coin; nearestDistance = distance; }
    }
    // Every visible coin blocks the finger hit area, even when relay rules make it unselectable.
    if (nearest) return view.phase === 'ready' && !view.canSelectCoin && nearest.id !== view.activeCoinId ? undefined : nearest;
    if (view.phase !== 'ready') return undefined;
    const active = candidates.find((coin) => coin.id === view.activeCoinId);
    if (active && this.scene.getFingerHitPoints().some((anchor) => {
      const point = this.scene.projectToScreen(anchor);
      return Math.hypot(point.x - clientX, point.y - clientY) <= FINGER_HIT_RADIUS;
    })) return active;
    return nearest;
  }

  private valid(gesture: Gesture): boolean {
    const { view, frame } = this.getState();
    if (!view || !frame || view.inputOwner === 'computer' || view.sessionId !== gesture.sessionId || view.revision !== gesture.revision || view.phase !== gesture.phase || view.currentPlayer !== gesture.player) return false;
    if (gesture.kind === 'orbit') return view.battle?.stage !== 'opening';
    return frame.coins.some((coin) => coin.id === gesture.coinId) && (gesture.kind === 'select' || view.activeCoinId === gesture.coinId);
  }

  private move(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!this.valid(gesture)) { this.cancel(); return; }
    const rect = this.scene.canvas.getBoundingClientRect();
    if (event.clientX < rect.left - 44 || event.clientX > rect.right + 44 || event.clientY < rect.top - 44 || event.clientY > rect.bottom + 44) { this.cancel(); return; }
    event.preventDefault();
    if (gesture.kind === 'orbit') {
      this.scene.orbitBy(event.clientX - gesture.last.x, event.clientY - gesture.last.y);
      gesture.last = { x: event.clientX, y: event.clientY };
      return;
    }
    if (gesture.kind === 'select') {
      if (Math.hypot(event.clientX - gesture.clientStart.x, event.clientY - gesture.clientStart.y) > SELECT_CANCEL_DISTANCE) this.cancel();
      return;
    }
    // Shot: power comes from hold duration (chargePower), not pointer travel.
  }

  private finish(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!this.valid(gesture)) { this.cancel(); return; }
    this.move(event);
    if (!this.gesture) return;
    const finished = this.gesture;
    // Release also checks the deadline: a stalled animation frame must not fire an expired hold.
    if (finished.kind === 'shot' && this.expireCharge(finished, performance.now() - finished.startedAt)) return;
    this.cancel();
    if (finished.kind === 'select') this.callbacks.pickCoin(finished.coinId);
    else if (finished.kind === 'shot') {
      const elapsed = performance.now() - finished.startedAt;
      if (elapsed >= FINGER_MIN_FIRE_MS) {
        const direction = this.getState().view?.battle?.stage === 'opening' ? { x: 0, z: -1 } : this.scene.getAimDirection();
        this.callbacks.shoot(direction, chargePower(elapsed));
      }
    }
  }

  private expireCharge(gesture: ShotGesture, elapsedMs: number): boolean {
    if (elapsedMs < MAX_CHARGE_HOLD_MS) return false;
    // Keep the physical pointer registered until release, but give up its gesture
    // and capture. Movement cannot turn this failed hold into orbit or selection.
    if (this.gesture === gesture) {
      this.cancel();
      this.callbacks.chargeFailed?.();
    }
    return true;
  }

  cancel(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture && this.scene.canvas.hasPointerCapture(gesture.pointerId)) this.scene.canvas.releasePointerCapture(gesture.pointerId);
  }

  dispose(): void {
    this.cancel();
    this.events.abort();
    this.pointers.clear();
  }
}
