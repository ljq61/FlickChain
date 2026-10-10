/** Presentation-only arrival. Authoritative coin positions stay at the level layout. */
export class CoinArrival {
  private elapsed = 0;
  private ids: string[] = [];
  private landed = new Set<string>();
  private active = false;

  begin(ids: string[], reducedMotion = false): void {
    this.ids = [...ids];
    this.elapsed = 0;
    this.landed.clear();
    this.active = ids.length > 0 && !reducedMotion;
  }

  get playing(): boolean { return this.active; }

  advance(seconds: number): string[] {
    if (!this.active || !Number.isFinite(seconds) || seconds <= 0) return [];
    this.elapsed += Math.min(seconds, 0.1);
    const impacts: string[] = [];
    for (const [index, id] of this.ids.entries()) {
      if (this.elapsed >= index * 0.085 + 0.32 && !this.landed.has(id)) {
        this.landed.add(id);
        impacts.push(id);
      }
    }
    if (this.elapsed >= 0.72 + (this.ids.length - 1) * 0.085) this.active = false;
    return impacts;
  }

  pose(id: string): { height: number; tilt: number; yaw: number } {
    const index = this.ids.indexOf(id);
    if (!this.active || index < 0) return { height: 0, tilt: 0, yaw: 0 };
    const age = Math.max(0, this.elapsed - index * 0.085);
    const progress = Math.min(1, age / 0.32);
    const bounceAge = age - 0.32;
    const height = age < 0.32 ? 0.18 * (1 - progress * progress)
      : 0.022 * Math.exp(-12 * bounceAge) * Math.abs(Math.sin(bounceAge * 24));
    return { height, tilt: (index % 2 ? -1 : 1) * 0.2 * (1 - progress), yaw: 0.45 * (1 - progress) };
  }
}
