// Writes dist/build-info.json so /health/version can prove which commit is live.
const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

function sha() {
  const env =
    process.env.GIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  if (env) return env;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const dist = join(__dirname, '..', 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, 'build-info.json'),
  JSON.stringify({ commit: sha(), builtAt: new Date().toISOString() }, null, 2),
);
console.log('build-info written');
