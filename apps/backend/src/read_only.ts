import type { FastifyInstance } from 'fastify';

import { env } from './env.js';

function isBlockedWrite(url: string): boolean {
  // explicit list + future-proof substrings
  const u = url.split('?')[0] ?? url;

  if (/^\/api\/printers\/[^/]+\/(pause|resume|cancel)$/.test(u)) return true;
  if (/^\/api\/presets\/[^/]+\/print$/.test(u)) return true;
  return false;
}

export function registerReadOnlyGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!env.BACKEND_READ_ONLY) return;

    const method = req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return;

    const url = req.url ?? '';
    if (!isBlockedWrite(url)) return;

    app.log.warn({ method, url }, `READ_ONLY enabled: blocking ${method} ${url.split('?')[0]}`);
    return reply.code(409).send({ error: 'READ_ONLY' });
  });
}
