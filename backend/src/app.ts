import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { config, isProd } from './config';
import { HttpError } from './lib/errors';
import { authenticate } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { programmeRoutes } from './routes/programmes';
import { moduleRoutes } from './routes/modules';
import { studentRoutes } from './routes/students';
import { markSheetRoutes } from './routes/marksheets';
import { examRoutes } from './routes/exams';
import { dashboardRoutes } from './routes/dashboard';
import { timetableRoutes } from './routes/timetable';
import { requestRoutes } from './routes/requests';
import { feeRoutes } from './routes/fees';
import { retakeRoutes } from './routes/retakes';
import { assistantRoutes } from './routes/assistant';
import { adminUserRoutes } from './routes/admin-users';
import multipart from '@fastify/multipart';

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
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health'),
  });

  app.get('/', async () => ({
    service: 'the-biggys-api',
    description: 'RTE Integrated Management System API — The Biggys, Islington Hackathon 2026',
    health: '/health',
    ready: '/health/ready',
    version: '/health/version',
  }));

  // Error handler must be set before routes are registered so child contexts inherit it.
  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    let status = (err as FastifyError).statusCode ?? 500;
    let message = err.message;
    let details: unknown = err instanceof HttpError ? err.details : undefined;

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        status = 409;
        message = 'A record with the same unique value already exists';
        details = { fields: (err.meta?.target as string[] | undefined) ?? [] };
      } else if (err.code === 'P2025') {
        status = 404;
        message = 'Record not found';
      } else if (err.code === 'P2003') {
        status = 409;
        message = 'Operation violates a relationship constraint';
        details = { field: err.meta?.field_name };
      }
    }
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    reply.code(status).send({
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message: status >= 500 && isProd ? 'Internal Server Error' : message,
      ...(details !== undefined ? { details } : {}),
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });

  // Everything under /api requires a valid token (deny by default); roles are checked per route.
  await app.register(
    async (api) => {
      api.addHook('preHandler', authenticate);
      await api.register(programmeRoutes);
      await api.register(moduleRoutes);
      await api.register(studentRoutes);
      await api.register(markSheetRoutes);
      await api.register(examRoutes);
      await api.register(dashboardRoutes);
      await api.register(timetableRoutes);
      await api.register(requestRoutes);
      await api.register(feeRoutes);
      await api.register(retakeRoutes);
      await api.register(assistantRoutes);
      await api.register(adminUserRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
