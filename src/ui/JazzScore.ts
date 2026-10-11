/** Original sixteen-bar tavern accompaniment, rendered offline into a small mono loop. */
export function jazzLoop(sampleRate = 22050): Float32Array {
  const beat = 60 / 66;
  const pcm = new Float32Array(Math.round(64 * beat * sampleRate));
  let seed = 137;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const add = (index: number, value: number) => {
    pcm[((index % pcm.length) + pcm.length) % pcm.length] += value;
  };
  // Rounded, low-register keys: no reed, vibrato, lead line or bright hammer transient.
  const note = (midi: number, when: number, length: number, volume: number, bass = false) => {
    const start = Math.round(when * sampleRate), count = Math.round(length * sampleRate);
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const touch = 0.88 + random() * 0.22;
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const attack = 1 - Math.exp(-t / (bass ? 0.018 : 0.024));
      const release = Math.min(1, (count - i) / (sampleRate * 0.24));
      const envelope = attack * release * Math.exp(-t * (bass ? 2.5 : 2.9) / length);
      const phase = Math.PI * 2 * frequency * t;
      const tone = Math.sin(phase)
        + (bass ? 0.1 : 0.18) * Math.sin(phase * 2.001) * Math.exp(-t * 2.2)
        + (bass ? 0 : 0.035) * Math.sin(phase * 3.003) * Math.exp(-t * 4);
      add(start + i, tone * envelope * volume * touch);
    }
  };
  const brush = (when: number, volume: number) => {
    const start = Math.round(when * sampleRate), count = Math.round(0.25 * sampleRate);
    let soft = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate);
    for (let i = 0; i < count; i++) {
      soft += alpha * (random() * 2 - 1 - soft);
      const envelope = Math.sin(Math.PI * i / count) ** 2 * Math.exp(-i / count * 2);
      add(start + i, soft * envelope * volume);
    }
  };
  // Compact seventh/ninth voicings keep the harmony behind the tabletop sounds.
  const harmony = [
    [48, 55, 58, 62, 63], [41, 56, 60, 63, 67], [46, 56, 60, 62, 67], [39, 55, 58, 62, 65],
    [44, 55, 60, 63, 67], [38, 53, 56, 60, 65], [43, 53, 56, 59, 62], [43, 53, 57, 59, 63],
  ];
  for (let bar = 0; bar < 16; bar++) {
    const chord = harmony[bar % harmony.length], time = bar * 4 * beat;
    note(chord[0] - 12, time + 0.025, beat * 2.1, 0.072, true);
    if (bar % 2 === 0) note(chord[0] - 5, time + beat * 2.7, beat * 1.3, 0.036, true);
    const offsets = bar % 4 === 3 ? [0.22] : [0.16, bar % 2 ? 2.55 : 2.7];
    offsets.forEach((offset, stroke) => chord.slice(1).forEach((pitch, index) => {
      const humanTime = (random() - 0.5) * 0.026;
      note(pitch, time + offset * beat + index * 0.017 + humanTime,
        beat * (stroke ? 1.7 : 2.6), stroke ? 0.028 : 0.036);
    }));
    // Only two quiet sweeps per bar, with breathing room at phrase endings.
    brush(time + beat * 1.1, 0.007);
    if (bar % 4 !== 3) brush(time + beat * 3.12, 0.005);
  }
  // Dark, diffuse room tail is baked once; no runtime reverb or synthesis graph.
  const dry = pcm.slice();
  const taps = [[0.113, 0.1], [0.197, 0.075], [0.293, 0.05], [0.419, 0.035]];
  let room = 0;
  const alpha = 1 - Math.exp(-2 * Math.PI * 1400 / sampleRate);
  for (let i = 0; i < pcm.length; i++) {
    let tail = 0;
    for (const [delay, gain] of taps) tail += dry[(i - Math.round(delay * sampleRate) + pcm.length) % pcm.length] * gain;
    room += alpha * (tail - room);
    pcm[i] += room;
  }
  // Keep the intentional quiet level; do not normalize it back to a foreground solo.
  return pcm;
}
