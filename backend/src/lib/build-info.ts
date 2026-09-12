import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, isProd } from '../config';

/** Dev-only fallback so the status widget shows the working-tree commit. */
function gitHead(): string | null {
  if (isProd) return null;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export interface BuildInfo {
  commit: string;
  builtAt: string;
  version: string;
}

function load(): BuildInfo {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  // The host usually knows the commit even when nothing set GIT_SHA, and a version endpoint that
  // reports a stale build is worse than one that reports nothing.
  let commit = config.GIT_SHA ?? config.RENDER_GIT_COMMIT ?? 'unknown';
  let builtAt = 'dev';
  const file = join(__dirname, '..', 'build-info.json');
  if (existsSync(file)) {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildInfo>;
    if (info.commit && commit === 'unknown') commit = info.commit;
    if (info.builtAt) builtAt = info.builtAt;
  }
  if (commit === 'unknown') commit = gitHead() ?? 'unknown';
  return { commit, builtAt, version: pkg.version };
}

export const buildInfo = load();
