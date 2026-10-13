import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/ui/SoundManager';
import { jazzLoop } from '../../src/ui/JazzScore';

class Param {
  value = 0;
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class Node {
  disconnect = vi.fn();
  connect = vi.fn((node: Node) => node);
}
class Source extends Node {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  finish(): void { this.onended?.(); }
}
class Oscillator extends Source { frequency = new Param(); type = 'sine'; }
class Gain extends Node { gain = new Param(); }
class Filter extends Node { frequency = new Param(); Q = new Param(); type = 'lowpass'; }
class Context {
  static instances: Context[] = [];
  currentTime = 3;
  state = 'running';
  sampleRate = 44100;
  destination = new Node();
  sources: Source[] = [];
  oscillators: Oscillator[] = [];
  gains: Gain[] = [];
  filters: Filter[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async () => ({ duration: 0.23 } as AudioBuffer));
  constructor() { Context.instances.push(this); }
  createBufferSource(): Source { const source = new Source(); this.sources.push(source); return source; }
  createOscillator(): Oscillator { const node = new Oscillator(); this.oscillators.push(node); return node; }
  createGain(): Gain { const node = new Gain(); this.gains.push(node); return node; }
  createBiquadFilter(): Filter { const node = new Filter(); this.filters.push(node); return node; }
  createBuffer(_channels: number, length: number): AudioBuffer {
    const data = new Float32Array(length);
    return { getChannelData: () => data } as unknown as AudioBuffer;
  }
}

describe('SoundManager optional audio and voice lifecycle', () => {
  let sound: SoundManager;
  let fetchMock: ReturnType<typeof vi.fn>;
  const context = () => Context.instances.at(-1)!;
  const loaded = async () => { await vi.waitFor(() => expect(context().decodeAudioData).toHaveBeenCalledTimes(4)); };

  beforeEach(() => {
    Context.instances = [];
    vi.stubGlobal('AudioContext', Context);
    fetchMock = vi.fn(async () => new Response(new ArrayBuffer(8)));
    vi.stubGlobal('fetch', fetchMock);
    sound = new SoundManager();
  });
  afterEach(() => { sound.dispose(); vi.unstubAllGlobals(); });

  it('does not allocate audio or fetch samples before a permitted user unlock', () => {
    sound.resumeIfUnlocked();
    sound.slide(1);
    sound.play('land');
    sound.enabled = false;
    sound.unlock();
    expect(Context.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumes an already-unlocked context after platform mute without replaying old sounds', async () => {
    sound.unlock(); await loaded();
    sound.enabled = false; sound.suspend();
    expect(context().state).toBe('suspended');
    sound.enabled = true; sound.resumeIfUnlocked();
    expect(context().state).toBe('running');
    expect(context().resume).toHaveBeenCalledTimes(2);
    expect(context().sources).toHaveLength(0);
    sound.play('land');
    expect(context().sources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('loads and decodes once per context, reuses recorded land sounds after resume', async () => {
    sound.unlock();
    await loaded();
    sound.play('land', 0.4);
    expect(context().sources).toHaveLength(1);
    expect(context().sources[0].buffer).not.toBeNull();
    expect(context().gains[0].gain.value).toBeGreaterThan(0);
    expect(context().gains[0].gain.value).toBeLessThan(0.42);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(`${import.meta.env.BASE_URL}audio/`))).toBe(true);
    sound.suspend();
    sound.unlock();
    sound.play('land');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(context().decodeAudioData).toHaveBeenCalledTimes(4);
    expect(context().sources).toHaveLength(2);
  });

  it('uses a quiet immediate fallback on failed downloads without replaying earlier hits', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    sound.unlock();
    sound.play('coin');
    expect(context().oscillators).toHaveLength(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(context().sources).toHaveLength(0);
    expect(context().oscillators).toHaveLength(1);
    expect(() => sound.play('wall')).not.toThrow();
  });

  it('handles rejected decode without retrying or delaying an impact', async () => {
    sound.unlock();
    context().decodeAudioData.mockRejectedValue(new Error('unsupported sample'));
    await loaded();
    sound.play('land');
    expect(context().sources).toHaveLength(0);
    expect(context().oscillators).toHaveLength(1);
    sound.unlock();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('cleans completed recorded voices and bounds a burst of simultaneous impacts', async () => {
    sound.unlock();
    await loaded();
    sound.play('coin');
    context().sources[0].finish();
    expect(context().sources[0].disconnect).toHaveBeenCalled();
    expect(context().gains[0].disconnect).toHaveBeenCalled();
    for (let index = 0; index < 24; index++) sound.play('land');
    const live = context().sources.filter((source) => !source.disconnect.mock.calls.length);
    expect(live).toHaveLength(12);
  });

  it('reuses one friction voice while moving and stops it once motion ends', () => {
    sound.unlock();
    sound.slide(0.5);
    sound.slide(1);
    expect(context().sources).toHaveLength(1);
    expect(context().sources[0].loop).toBe(true);
    expect(context().filters[1].frequency.value).toBe(1300);
    sound.slide(0);
    sound.slide(0);
    expect(context().sources[0].stop).toHaveBeenCalledTimes(1);
    expect(context().sources[0].stop).toHaveBeenCalledWith(3.12);
    context().sources[0].finish();
    expect(context().filters.every((filter) => filter.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('muting stops every voice, including a fading friction tail; unmute does not revive it', async () => {
    sound.unlock();
    await loaded();
    sound.slide(0.8);
    sound.slide(0);
    sound.play('land');
    sound.enabled = false;
    expect(context().sources.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true);
    const count = context().sources.length;
    sound.enabled = true;
    sound.unlock();
    expect(context().sources).toHaveLength(count);
    sound.slide(0);
    expect(context().sources).toHaveLength(count);
  });

  it('suspend stops friction and delayed cues; unlock only permits fresh motion', () => {
    sound.unlock();
    sound.slide(1);
    sound.play('complete');
    sound.suspend();
    expect(context().sources[0].stop).toHaveBeenCalled();
    expect(context().oscillators.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true);
    sound.slide(1);
    sound.play('land');
    expect(context().sources).toHaveLength(1);
    sound.unlock();
    expect(context().sources).toHaveLength(1);
    sound.slide(0.5);
    expect(context().sources).toHaveLength(2);
  });

  it('scene cancellation stops impacts, fading friction and scheduled cues while retaining unlocked samples', async () => {
    sound.stopCurrentSounds();
    expect(Context.instances).toHaveLength(0);
    sound.unlock();
    await loaded();
    const current = context();
    sound.slide(0.8);
    sound.slide(0);
    sound.play('land');
    sound.play('coin');
    sound.play('complete');
    expect(current.oscillators[2].start).toHaveBeenCalledWith(3.18);
    const oldSources = [...current.sources, ...current.oscillators];
    sound.stopCurrentSounds();
    for (const source of oldSources) {
      // Replace a previously scheduled stop with an immediate one, including future notes.
      expect(source.stop).toHaveBeenLastCalledWith();
      expect(source.disconnect).toHaveBeenCalled();
    }
    expect(current.suspend).not.toHaveBeenCalled();
    expect(current.close).not.toHaveBeenCalled();
    sound.stopCurrentSounds();
    sound.play('land');
    sound.slide(0.5);
    expect(current.sources).toHaveLength(5);
    expect(current.sources[3].buffer).not.toBeNull();
    expect(current.sources[4].loop).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(current.decodeAudioData).toHaveBeenCalledTimes(4);
    expect(Context.instances).toHaveLength(1);
  });

  it('aborts outstanding sample loads on dispose and does not play their completion', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    fetchMock.mockImplementation(async () => { await pending; return new Response(new ArrayBuffer(8)); });
    sound.unlock();
    const old = context();
    sound.dispose();
    expect(fetchMock.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    finish();
    await pending;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(old.decodeAudioData).not.toHaveBeenCalled();
    expect(old.sources).toHaveLength(0);
    expect(old.close).toHaveBeenCalledTimes(1);
    sound.play('land');
    expect(old.sources).toHaveLength(0);
  });

  it('rejects invalid intensity instead of creating nonfinite automation', () => {
    sound.unlock();
    sound.slide(NaN);
    sound.play('land', Infinity);
    sound.play('coin', -1);
    expect(context().sources).toHaveLength(0);
    expect(context().oscillators).toHaveLength(0);
  });

  it('plays one reusable jazz loop after interaction and keeps it independent of impact cancellation', async () => {
    sound.dispose();
    sound = new SoundManager(true);
    expect(Context.instances).toHaveLength(0);
    sound.unlock();
    await vi.waitFor(() => expect(context().sources.filter(source => source.loop)).toHaveLength(1));
    const music = context().sources[0];
    const buffer = music.buffer;
    expect(context().gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.16, context().currentTime + 1.4);
    sound.unlock(); sound.unlock();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(context().sources).toHaveLength(1);
    sound.stopCurrentSounds();
    expect(music.stop).not.toHaveBeenCalled();
    sound.enabled = false;
    expect(music.stop).toHaveBeenCalledTimes(1);
    expect(music.disconnect).toHaveBeenCalledTimes(1);
    sound.enabled = true; sound.unlock();
    await vi.waitFor(() => expect(context().sources).toHaveLength(2));
    expect(context().sources[1].buffer).toBe(buffer);
    sound.suspend();
    expect(context().sources[1].stop).toHaveBeenCalledTimes(1);
    expect(context().sources[1].disconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels queued music before playback if mute or disposal precedes audio permission', async () => {
    sound.dispose(); sound = new SoundManager(true);
    sound.unlock(); sound.enabled = false;
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(context().sources).toHaveLength(0);
    sound.enabled = true; sound.unlock(); sound.dispose();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(context().sources).toHaveLength(0);
  });

  it('renders quiet tavern accompaniment with a seamless loop and finite samples', () => {
    const pcm = jazzLoop(8000);
    let peak = 0, energy = 0, finite = true;
    for (const sample of pcm) {
      finite &&= Number.isFinite(sample);
      peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
    }
    expect(finite).toBe(true);
    expect(pcm.length).toBe(Math.round(64 * 60 / 66 * 8000));
    expect(peak).toBeGreaterThan(0.08);
    expect(peak).toBeLessThan(0.25);
    expect(energy / pcm.length).toBeGreaterThan(0.0002);
    expect(energy / pcm.length).toBeLessThan(0.001);
    expect(Math.abs(pcm[0] - pcm[pcm.length - 1])).toBeLessThan(0.001);
  });
});
