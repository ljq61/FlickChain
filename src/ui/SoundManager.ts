type SoundKind = 'aim' | 'flick' | 'coin' | 'wall' | 'land' | 'success' | 'failure' | 'complete' | 'charge-failed';
type SampleName = 'coin-hit-a' | 'coin-hit-b' | 'coin-land' | 'coin-wood';
interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[] }
interface SlideVoice extends Voice { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }

const SAMPLE_NAMES: SampleName[] = ['coin-hit-a', 'coin-hit-b', 'coin-land', 'coin-wood'];

export class SoundManager {
  private context: AudioContext | null = null;
  private slideVoice: SlideVoice | null = null;
  private slideBuffer: AudioBuffer | null = null;
  private readonly voices = new Set<Voice>();
  private readonly samples = new Map<SampleName, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private loadController: AbortController | null = null;
  private active = false;
  private soundEnabled = true;
  private musicBuffer: AudioBuffer | null = null;
  private musicVoice: Voice | null = null;
  private musicLoading: Promise<void> | null = null;

  constructor(private readonly backgroundMusic = false) {}

  get enabled(): boolean { return this.soundEnabled; }
  set enabled(value: boolean) {
    this.soundEnabled = value;
    if (!value) { this.stopAll(); this.stopMusic(); }
  }

  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      this.active = true;
      // Always enqueue resume: suspend() may still be pending at this interaction.
      const context = this.context;
      void context.resume().then(() => {
        if (this.active && this.enabled && this.context === context) this.startMusic();
      }).catch(() => {});
      this.loadSamples(this.context);
      this.loadMusic(this.context);
    } catch {
      // Audio is optional: browser audio restrictions cannot block a shot.
    }
  }

  /** Platform unmute may resume a context already unlocked by a user gesture. */
  resumeIfUnlocked(): void {
    if (this.context) this.unlock();
  }

  play(kind: SoundKind, intensity = 1): void {
    if (!this.ready()) return;
    const strength = this.clamp(intensity);
    if (strength === 0) return;
    if (kind === 'coin' || kind === 'wall' || kind === 'land') {
      const name: SampleName = kind === 'land' ? 'coin-land' : kind === 'wall' ? 'coin-wood' : Math.random() < 0.5 ? 'coin-hit-a' : 'coin-hit-b';
      const buffer = this.samples.get(name);
      if (buffer) {
        const context = this.context!;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = (kind === 'land' ? 0.92 : 0.96) + Math.random() * 0.08;
        gain.gain.value = (kind === 'wall' ? 0.30 : kind === 'land' ? 0.42 : 0.50) * Math.pow(strength, 0.65);
        source.connect(gain).connect(context.destination);
        this.track({ source, nodes: [source, gain] });
        source.start();
      } else {
        // A quiet tap while recordings load or if fetch/decode fails. Never replay late hits.
        this.blip(kind === 'wall' ? 160 : 720, 'triangle', 0.022 * strength, 0.075);
      }
      return;
    }
    const notes = kind === 'charge-failed' ? [392, 247, 165] : kind === 'complete' ? [523, 659, 784] : kind === 'success' ? [660, 880] : kind === 'failure' ? [196, 147] : kind === 'aim' ? [440] : [330];
    notes.forEach((frequency, index) => this.blip(frequency, kind === 'failure' ? 'triangle' : 'sine', (kind === 'aim' ? 0.018 : 0.045) * strength, kind === 'aim' ? 0.065 : 0.18, index * 0.09));
  }

  /** Soft continuous friction, not repeated impacts. Callers supply actual on-table motion. */
  slide(intensity: number): void {
    const strength = this.clamp(intensity);
    if (!this.ready() || strength < 0.015) {
      this.stopSlide();
      return;
    }
    const context = this.context!;
    if (!this.slideVoice) {
      if (!this.slideBuffer) {
        const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
        const data = buffer.getChannelData(0);
        let brown = 0;
        for (let index = 0; index < data.length; index++) {
          const white = Math.random() * 2 - 1;
          brown = (brown + white * 0.018) / 1.02;
          const edge = Math.min(1, index / 256, (data.length - index - 1) / 256);
          const grain = 0.8 + Math.sin(index / context.sampleRate * 8.1) * 0.1;
          data[index] = (brown * 2.8 + white * 0.035) * edge * grain;
        }
        this.slideBuffer = buffer;
      }
      const source = context.createBufferSource();
      source.buffer = this.slideBuffer;
      source.loop = true;
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 95;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(highpass).connect(filter).connect(gain).connect(context.destination);
      this.slideVoice = { source, filter, gain, nodes: [source, highpass, filter, gain] };
      this.track(this.slideVoice);
      source.start();
    }
    const { source, filter, gain } = this.slideVoice;
    const now = context.currentTime;
    source.playbackRate.setTargetAtTime(0.85 + strength * 0.3, now, 0.08);
    filter.frequency.setTargetAtTime(700 + strength * 600, now, 0.08);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(Math.pow(strength, 1.2) * 0.085, now, 0.04);
  }

  private loadSamples(context: AudioContext): void {
    if (this.loading) return;
    const controller = new AbortController();
    this.loadController = controller;
    this.loading = Promise.all(SAMPLE_NAMES.map(async (name) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${name}.wav`, { signal: controller.signal });
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted || this.context !== context) return;
        const buffer = await context.decodeAudioData(bytes);
        if (this.context === context && !controller.signal.aborted) this.samples.set(name, buffer);
      } catch {
        // Network/decode failure uses the quiet fallback; optional audio never blocks gameplay.
      }
    })).then(() => {});
  }

  private ready(): boolean {
    return this.enabled && this.active && this.context?.state === 'running';
  }

  private startMusic(): void {
    if (!this.backgroundMusic || !this.ready() || this.musicVoice || !this.musicBuffer) return;
    const context = this.context!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.musicBuffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.16, context.currentTime + 1.4);
    source.connect(gain).connect(context.destination);
    const voice = { source, nodes: [source, gain] };
    this.musicVoice = voice;
    source.onended = () => {
      if (this.musicVoice === voice) this.musicVoice = null;
      voice.nodes.forEach(node => node.disconnect());
    };
    source.start();
  }

  private loadMusic(context: AudioContext): void {
    if (!this.backgroundMusic || this.musicLoading) return;
    const signal = this.loadController!.signal;
    this.musicLoading = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/midnight-jazz.mp3`, { signal });
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        if (signal.aborted || this.context !== context) return;
        const buffer = await context.decodeAudioData(bytes);
        if (signal.aborted || this.context !== context) return;
        this.musicBuffer = buffer;
        this.startMusic();
      } catch { /* Music is optional and cannot delay input or a shot. */ }
    })();
  }

  private stopMusic(): void {
    const voice = this.musicVoice;
    this.musicVoice = null;
    if (!voice) return;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* Already stopped. */ }
    voice.nodes.forEach(node => node.disconnect());
  }

  private clamp(value: number): number { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; }

  private track(voice: Voice): void {
    // Bound simultaneous jingles even on a crowded board; every source disconnects on completion.
    if (this.voices.size >= 12) this.stopVoice(this.voices.values().next().value!);
    this.voices.add(voice);
    voice.source.onended = () => this.release(voice);
  }

  private release(voice: Voice): void {
    this.voices.delete(voice);
    voice.nodes.forEach((node) => node.disconnect());
    if (this.slideVoice === voice) this.slideVoice = null;
  }

  private stopVoice(voice: Voice): void {
    try { voice.source.stop(); } catch { /* A source may already have ended. */ }
    this.release(voice);
  }

  private stopSlide(): void {
    const voice = this.slideVoice;
    if (!voice) return;
    this.slideVoice = null;
    const now = this.context!.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.025);
    voice.source.stop(now + 0.12);
  }

  private stopAll(): void {
    for (const voice of [...this.voices]) this.stopVoice(voice);
    this.slideVoice = null;
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
    this.track({ source: oscillator, nodes: [oscillator, gain] });
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  /** Cancel the previous scene's playing and scheduled sounds without unloading recordings. */
  stopCurrentSounds(): void {
    this.stopAll();
  }

  suspend(): void {
    this.active = false;
    this.stopAll();
    this.stopMusic();
    if (this.context) void this.context.suspend().catch(() => {});
  }

  dispose(): void {
    this.active = false;
    this.stopAll();
    this.stopMusic();
    this.loadController?.abort();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.musicBuffer = null;
    this.musicLoading = null;
    this.slideBuffer = null;
    this.samples.clear();
    this.loading = null;
    this.loadController = null;
  }
}
