import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

import { env } from './env.js';
import { prisma } from './prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      telegramId: string;
    };
  }
}

function unauthorized(reply: FastifyReply, message = 'UNAUTHORIZED') {
  return reply.code(401).send({ error: 'UNAUTHORIZED', message });
}

export function registerAuthMiddleware(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const pathname = req.url.split('?')[0] ?? '';

    if (!pathname.startsWith('/api/')) return;

    if (pathname === '/api/health') return;
    if (pathname === '/api/auth/telegram') return;
    if (pathname.startsWith('/api/ws')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader) return unauthorized(reply, 'Missing Authorization header');

    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return unauthorized(reply, 'Invalid Authorization header');

    const token = m[1];

    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
      if (!payload || typeof payload !== 'object') return unauthorized(reply, 'Invalid token');

      const sub = (payload as { sub?: unknown }).sub;
      if (typeof sub !== 'string' || !sub) return unauthorized(reply, 'Invalid token subject');

      const user = await prisma.user.findUnique({ where: { telegramId: sub } });
      if (!user || !user.isAllowed) return unauthorized(reply, 'User is not allowed');

      req.auth = { telegramId: sub };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return unauthorized(reply, msg);
    }
  });
}
