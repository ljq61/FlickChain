// Regenerate the original score with Node + ffmpeg (libmp3lame).
// Runtime only decodes the finished MP3; synthesis never runs on the player's device.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const score = new URL('../src/ui/JazzScore.ts', import.meta.url);
const output = new URL('../public/audio/midnight-jazz.mp3', import.meta.url);
const code = ts.transpileModule(readFileSync(score, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { jazzLoop } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const samples = jazzLoop(22050);
const pcm = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2));
const temporary = mkdtempSync(join(tmpdir(), 'flickchain-jazz-'));
try {
  const input = join(temporary, 'score.pcm');
  writeFileSync(input, pcm);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 's16le', '-ar', '22050', '-ac', '1', '-i', input,
    '-c:a', 'libmp3lame', '-b:a', '64k', output.pathname], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status}`);
  console.log(`Rendered ${(samples.length / 22050).toFixed(2)} seconds, ${statSync(output).size} bytes.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
