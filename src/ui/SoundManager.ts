export class SoundManager {
  private context: AudioContext | null = null;
  private slideGain: GainNode | null = null;
  enabled = true;

  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // Audio is optional: browser audio restrictions cannot block a shot.
    }
  }

  play(kind: 'aim' | 'flick' | 'coin' | 'wall' | 'success' | 'failure' | 'complete'): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (kind === 'coin') {
      // A struck coin rings with inharmonic partials, like a small metallic disc.
      this.ring(2300 * (0.94 + Math.random() * 0.12), 0.06);
      return;
    }
    if (kind === 'wall') {
      // Wood obstacle with a metallic edge overtone from the coin itself.
      this.ring(1250, 0.03);
      this.blip(220, 'triangle', 0.07, 0.09);
      return;
    }
    const notes = kind === 'complete' ? [523, 659, 784] : kind === 'success' ? [660, 880] : kind === 'failure' ? [196, 147] : kind === 'aim' ? [440] : [330];
    notes.forEach((frequency, index) => this.blip(frequency, kind === 'failure' ? 'triangle' : 'sine', kind === 'aim' ? 0.025 : 0.065, kind === 'aim' ? 0.065 : 0.18, index * 0.09));
  }

  /** Metallic scrape while coins slide across the table; intensity 0..1 follows the fastest mover. */
  slide(intensity: number): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const context = this.context;
    if (!this.slideGain) {
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 3200;
      band.Q.value = 1.6;
      this.slideGain = context.createGain();
      this.slideGain.gain.value = 0;
      source.connect(band).connect(this.slideGain).connect(context.destination);
      source.start();
    }
    const now = context.currentTime;
    this.slideGain.gain.cancelScheduledValues(now);
    this.slideGain.gain.setTargetAtTime(Math.min(1, Math.max(0, intensity)) * 0.06, now, 0.06);
  }

  private blip(frequency: number, type: OscillatorType, peak: number, duration: number, delay = 0): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const time = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  private ring(base: number, peak: number): void {
    const context = this.context!;
    const partials: Array<[ratio: number, weight: number]> = [[1, 1], [1.51, 0.55], [2.32, 0.32], [3.76, 0.18]];
    partials.forEach(([ratio, weight], index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const time = context.currentTime + 0.001;
      oscillator.type = 'sine';
      oscillator.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.01);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(peak * weight, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24 - index * 0.04);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.26);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  suspend(): void {
    if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
  }

  dispose(): void {
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.slideGain = null;
  }
}
