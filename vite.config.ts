import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import packageInfo from './package.json';

function git(args: string[]): string | null {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

/** Record the exact candidate without depending on Git being present in source archives. */
function buildVersion(): Plugin {
  return {
    name: 'flickchain-build-version',
    apply: 'build',
    generateBundle() {
      const sourceStatus = git(['status', '--porcelain', '--untracked-files=all', '--',
        'src', 'public', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html', 'tsconfig.json']);
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({
        schemaVersion: 1,
        name: packageInfo.name,
        version: packageInfo.version,
        branch: git(['branch', '--show-current']) || null,
        sourceRevision: git(['rev-parse', 'HEAD']),
        sourceDirty: sourceStatus === null ? null : sourceStatus !== '',
        builtAt: new Date().toISOString(),
      }, null, 2) + '\n' });
    },
  };
}

export default defineConfig({ base: './', plugins: [buildVersion()] });
