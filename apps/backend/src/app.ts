import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import { env } from './env.js';
import { loggerOptions } from './logger.js';

export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_RPM,
    timeWindow: '1 minute',
  });

  await app.register(websocket);

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
