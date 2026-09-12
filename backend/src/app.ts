import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isProd } from './config';
import { healthRoutes } from './routes/health';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token'],
      ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
    },
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health'),
  });

  await app.register(healthRoutes);

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    reply.code(status).send({
      error: status >= 500 && isProd ? 'Internal Server Error' : err.message,
      statusCode: status,
    });
  });

  return app;
}
