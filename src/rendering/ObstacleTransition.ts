/** Glass presentation offsets only. Core footprints remain authoritative and static. */
export class ObstacleTransition {
  private arrivalIds: string[] = [];
  private removalIds: string[] = [];
  private arrivalTime = 0;
  private removalTime = 0;
  private entering = false;
  private leaving = false;
  private removed = false;

  reset(): void {
    this.arrivalIds = [];
    this.removalIds = [];
    this.arrivalTime = this.removalTime = 0;
    this.entering = this.leaving = this.removed = false;
  }

  beginArrival(ids: string[], reducedMotion = false): void {
    this.arrivalIds = [...ids];
    this.arrivalTime = 0;
    this.entering = ids.length > 0 && !reducedMotion;
  }

  beginRemoval(ids: string[], reducedMotion = false): void {
    this.entering = false;
    this.removalIds = [...ids];
    this.removalTime = 0;
    this.leaving = !reducedMotion;
    this.removed = reducedMotion;
  }

  get arriving(): boolean { return this.entering; }
  get removing(): boolean { return this.leaving; }

  advanceArrival(seconds: number): void {
    if (!this.entering || !Number.isFinite(seconds) || seconds <= 0) return;
    this.arrivalTime += Math.min(seconds, 0.1);
    if (this.arrivalTime >= 0.62 + (this.arrivalIds.length - 1) * 0.07) this.entering = false;
  }

  advanceRemoval(seconds: number): void {
    if (!this.leaving || !Number.isFinite(seconds) || seconds <= 0) return;
    this.removalTime += Math.min(seconds, 0.1);
    const duration = this.removalIds.length ? 0.62 + (this.removalIds.length - 1) * 0.07 : 0.25;
    if (this.removalTime >= duration) { this.leaving = false; this.removed = true; }
  }

  pose(id: string): { height: number; x: number; tilt: number; visible: boolean } {
    const removalIndex = this.removalIds.indexOf(id);
    if (removalIndex >= 0 && (this.leaving || this.removed)) {
      const progress = Math.min(1, Math.max(0, (this.removalTime - removalIndex * 0.07) / 0.62));
      const lift = Math.min(1, progress / 0.55);
      const carry = Math.max(0, (progress - 0.35) / 0.65);
      const sign = removalIndex % 2 ? -1 : 1;
      return { height: 0.32 * (1 - (1 - lift) ** 2), x: sign * carry ** 2 * 1.1, tilt: sign * carry * 0.12, visible: !this.removed && progress < 1 };
    }
    const arrivalIndex = this.arrivalIds.indexOf(id);
    if (arrivalIndex >= 0 && this.entering) {
      const age = Math.max(0, this.arrivalTime - arrivalIndex * 0.07);
      const progress = Math.min(1, age / 0.42);
      const height = age < 0.42 ? 0.26 * (1 - progress * progress) : 0.008 * Math.exp(-(age - 0.42) * 18) * Math.abs(Math.sin((age - 0.42) * 28));
      return { height, x: 0, tilt: (arrivalIndex % 2 ? -1 : 1) * 0.06 * (1 - progress), visible: true };
    }
    return { height: 0, x: 0, tilt: 0, visible: true };
  }
}
