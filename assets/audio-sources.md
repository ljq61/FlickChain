# Coin audio sources

The four mono 44.1 kHz PCM WAV files in `public/audio/` are edited real coin recordings. Both authors published the source recordings under CC0. No attribution is required; provenance is retained here.

| Game asset | Author and source | Edit |
| --- | --- | --- |
| `coin-hit-a.wav` | syncopika, [coin sounds](https://opengameart.org/content/coin-sounds), `coinsounds011015.wav`, CC0 | 0.386–0.616 s; short isolated coin click |
| `coin-hit-b.wav` | syncopika, [coin sounds](https://opengameart.org/content/coin-sounds), `coinsounds011015.wav`, CC0 | 0.895–1.125 s; alternate short coin click |
| `coin-land.wav` | Vinrax, [Coin Drop](https://opengameart.org/content/coin-drop), `coin_drop.wav`, CC0 | 0.450–1.040 s; landing and brief settling jingle |
| `coin-wood.wav` | Vinrax, [Coin Drop](https://opengameart.org/content/coin-drop), `coin_drop.wav`, CC0 | 0.450–0.560 s; softened first table impact |

All edits remove low rumble, limit high frequencies, use short entry/exit fades and have a peak of 0.60 (-4.44 dBFS). The wood hit has a 2.2 kHz low-pass; other samples have a 6–6.5 kHz low-pass. Playback gain follows impact intensity, with restrained pitch variation. The assets total about 103 kB and decode once per audio context; failed downloads fall back to a quiet synthesized tap without delaying or replaying an event.

Sliding friction is a **synthesized** low-frequency colored-noise layer, filtered at 95–1300 Hz and faded from actual on-table movement. It is not a recorded scrape and does not replay collision samples. Aim, flick and result cues remain quiet synthesized musical cues. No reverb or streaming audio service is used.

## Original tavern accompaniment (2026-10-11)

`public/audio/midnight-jazz.mp3` is an original, procedurally composed 16-bar,
66 BPM accompaniment: rounded keys, soft bass and sparse filtered brush sweeps.
It replaces the prominent synthesized saxophone lead at the user's request.
Touch timing/velocity variations and a dark room tail are rendered offline;
there are no third-party instrument samples or live reverb/synthesis nodes.
This is synthesized accompaniment, not a recorded band or a real saxophone.

Regenerate with `node scripts/render-jazz.mjs` (Node, TypeScript and ffmpeg with
libmp3lame). The file is 58.18 seconds, mono 22.05 kHz, 64 kb/s and 466277 bytes.
Source PCM RMS is about 0.024 and peak about 0.165. Runtime gain is 0.16 with a
1.4-second fade-in; the combination is about 14.2 dB below the previous saxophone
version. These are signal measurements, not a guarantee of speaker loudness.
Existing user-interaction unlocking, mute, pause and disposal own playback.

Licenses verified on the authors' source pages on 2026-10-11.
