import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import { env } from './env.js';
import { loggerOptions } from './logger.js';
import { registerAuthMiddleware } from './auth.js';
import { registerErrorHandling } from './errors.js';
import { registerReadOnlyGuard } from './read_only.js';
import { registerAuthRoutes } from './routes_auth.js';
import { registerMeRoutes } from './routes_me.js';
import { registerPrinterModelsRoutes } from './routes_printer_models.js';
import { registerPrintersRoutes } from './routes_printers.js';
import { registerSnapshotRoutes } from './routes_snapshot.js';
import { registerHistoryRoutes } from './routes_history.js';
import { registerWsHub } from './ws_hub.js';

export async function buildApp() {
  const app = Fastify({ logger: loggerOptions, ignoreTrailingSlash: true });

  registerErrorHandling(app);
  registerReadOnlyGuard(app);

  const corsOrigin = (() => {
    const raw = (env.CORS_ORIGIN ?? '').trim();
    if (!raw) return '*';
    if (raw === '*') return '*';
    const parts = raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.length <= 1 ? (parts[0] ?? '*') : parts;
  })();

  await app.register(cors, {
    origin: corsOrigin,
    credentials: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_RPM,
    timeWindow: '1 minute',
  });

  await app.register(websocket);

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);

  registerAuthMiddleware(app);
  await registerMeRoutes(app);

  await registerPrinterModelsRoutes(app);
  await registerPrintersRoutes(app);
  await registerSnapshotRoutes(app);
  await registerHistoryRoutes(app);
  await registerWsHub(app);

  return app;
}
