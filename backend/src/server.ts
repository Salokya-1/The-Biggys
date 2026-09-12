import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config, isProd } from './config';
import { buildApp } from './app';
import { prisma } from './lib/prisma';
import { autoScheduleDueExams } from './services/exams';

/** Belt and braces: apply pending migrations before listening (idempotent). */
function runMigrations(log: (msg: string) => void) {
  if (config.RUN_MIGRATIONS_ON_START !== 'true' || !isProd) return;
  log('applying database migrations');
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
}

/**
 * First-run demo data.
 *
 * A freshly created deployment has the schema but no rows, which makes every screen look broken.
 * Seeding only when the database is genuinely empty means this is safe to leave switched on: it
 * cannot overwrite real data, because the moment there is any, it does nothing.
 */
async function seedIfEmpty(log: (msg: string) => void) {
  if (config.SEED_ON_EMPTY !== 'true') return;
  const users = await prisma.user.count();
  if (users > 0) {
    log(`database already has ${users} users - not seeding`);
    return;
  }
  log('empty database - loading the demo data');
  // tsx ships as an ESM CLI; resolve the file rather than relying on a bin on PATH.
  const tsx = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  execFileSync(process.execPath, [tsx, path.join('prisma', 'seed.ts')], { stdio: 'inherit', env: process.env, cwd: process.cwd() });
}

async function main() {
  const app = await buildApp();
  try {
    runMigrations((m) => app.log.info(m));
  } catch (err) {
    app.log.fatal({ err }, 'migration failed - refusing to start');
    process.exit(1);
  }

  // Warm the pool so the first /health/ready is honest.
  try {
    await prisma.$queryRaw`SELECT 1`;
    app.log.info('database reachable');
  } catch (err) {
    app.log.warn({ err }, 'database not reachable at startup; /health/ready will report degraded');
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });

  // After listening, never before: on a small instance the seed takes minutes, and a deploy that
  // has not bound its port yet is a deploy the platform kills.
  void (async () => {
    try {
      await seedIfEmpty((m) => app.log.info(m));
    } catch (err) {
      app.log.error({ err }, 'first-run seed failed; the API is up, the demo data is just missing');
    }
  })();

  // Exam schedules are generated automatically three weeks before each exam window (checked on start and every 6 h).
  const runScheduler = () =>
    autoScheduleDueExams((msg, data) => app.log.info(data ?? {}, msg)).catch((err) => app.log.error({ err }, 'exam auto-scheduler failed'));
  setTimeout(runScheduler, 5_000).unref();
  setInterval(runScheduler, 6 * 60 * 60 * 1000).unref();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
