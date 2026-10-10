import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { LEVELS } from '../../src/content/levels';
import { discoverSolution } from './replay';

// Explicit opt-in; acceptance replays never regenerate their own expected inputs.
it.skipIf(process.env.FLICKCHAIN_GENERATE_SOLUTIONS !== '1')('regenerates complete production-physics solutions', async () => {
  const solutions = [];
  for (const level of LEVELS) {
    const started = performance.now();
    const { solution, candidates } = await discoverSolution(level);
    solutions.push(solution);
    console.log(`${level.id}: ${solution.shots.length} shots, ${candidates} candidates, ${Math.round(performance.now() - started)}ms`);
  }
  writeFileSync(new URL('./solutions.json', import.meta.url), `${JSON.stringify(solutions, null, 2)}\n`);
}, 120_000);
