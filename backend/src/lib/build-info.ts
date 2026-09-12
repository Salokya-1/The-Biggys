import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

export interface BuildInfo {
  commit: string;
  builtAt: string;
  version: string;
}

function load(): BuildInfo {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  let commit = config.GIT_SHA ?? 'unknown';
  let builtAt = 'dev';
  const file = join(__dirname, '..', 'build-info.json');
  if (existsSync(file)) {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildInfo>;
    if (info.commit && commit === 'unknown') commit = info.commit;
    if (info.builtAt) builtAt = info.builtAt;
  }
  return { commit, builtAt, version: pkg.version };
}

export const buildInfo = load();
