import type { FastifyInstance } from 'fastify';
import { prisma, withTimeout } from '../lib/prisma';
import { buildInfo } from '../lib/build-info';

const startedAt = Date.now();

/**
 * Health endpoints — never behind auth or rate limiting.
 *  GET /health          liveness:  no DB, always 200
 *  GET /health/ready    readiness: SELECT 1 with a 2 s timeout, 503 when the DB is unreachable
 *  GET /health/version  which commit is live
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'the-biggys-api',
    version: buildInfo.version,
    commit: buildInfo.commit,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (req, reply) => {
    const t0 = Date.now();
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2000, 'db ping');
      const latencyMs = Date.now() - t0;
      req.log.info({ check: 'ready', db: 'ok', latencyMs }, 'health.ready');
      return { status: 'ok', checks: { db: 'ok', latencyMs } };
    } catch (err) {
      const error = (err as Error).message.split('\n')[0].slice(0, 160);
      req.log.error({ check: 'ready', db: 'error', error }, 'health.ready');
      reply.code(503);
      return { status: 'degraded', checks: { db: 'error' }, error };
    }
  });

  app.get('/health/version', async () => ({
    commit: buildInfo.commit,
    builtAt: buildInfo.builtAt,
  }));
}
