import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const han = /\p{Script=Han}/u;

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

describe('English distribution content', () => {
  it('declares English for page metadata and assistive technology', () => {
    const html = readFileSync(join(projectRoot, 'index.html'), 'utf8');
    expect(html).toMatch(/<html\s+lang="en"/);
    expect(html).toContain('<title>FlickChain</title>');
    expect(html).not.toMatch(han);
  });

  it('contains no untranslated Chinese in production code or shipped level data', () => {
    const paths = [...filesIn(join(projectRoot, 'src')), ...filesIn(join(projectRoot, 'public', 'levels'))];
    const untranslated = paths.filter((path) => /\.(ts|css|json)$/.test(path))
      .flatMap((path) => readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
        han.test(line) ? [`${relative(projectRoot, path)}:${index + 1}: ${line.trim()}`] : []));
    expect(untranslated, untranslated.join('\n')).toEqual([]);
  });
});
