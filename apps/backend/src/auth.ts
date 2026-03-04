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

function isProtectedApiRoute(method: string, pathname: string): boolean {
  const m = method.toUpperCase();

  if (m === 'GET' && pathname === '/api/me') return true;
  if (m === 'GET' && pathname === '/api/snapshot') return true;
  if (m === 'GET' && pathname === '/api/printers') return true;
  if (m === 'POST' && pathname === '/api/printers') return true;
  if (m === 'GET' && pathname === '/api/printer-models') return true;
  if (m === 'POST' && pathname === '/api/printer-models') return true;
  if (m === 'GET' && pathname === '/api/history') return true;
  if (m === 'GET' && pathname === '/api/status') return true;
  if (m === 'GET' && pathname === '/api/security') return true;

  if (m === 'GET' && pathname === '/api/notifications/diagnostics') return true;

  if (m === 'GET' && pathname === '/api/presets') return true;
  if (m === 'POST' && pathname === '/api/presets') return true;
  if (m === 'GET' && /^\/api\/presets\/[^/]+$/.test(pathname)) return true;
  if (m === 'PATCH' && /^\/api\/presets\/[^/]+$/.test(pathname)) return true;
  if (m === 'DELETE' && /^\/api\/presets\/[^/]+$/.test(pathname)) return true;
  if (m === 'GET' && /^\/api\/presets\/[^/]+\/thumbnail$/.test(pathname))
    return true;
  if (m === 'POST' && /^\/api\/presets\/[^/]+\/print$/.test(pathname))
    return true;

  if (m === 'PATCH' && /^\/api\/printers\/[^/]+$/.test(pathname)) return true;
  if (m === 'DELETE' && /^\/api\/printers\/[^/]+$/.test(pathname)) return true;
  if (m === 'POST' && /^\/api\/printers\/[^/]+\/(test|rescan)$/.test(pathname))
    return true;

  if (m === 'POST' && /^\/api\/printers\/[^/]+\/emergency_stop$/.test(pathname))
    return true;

  if (
    m === 'POST' &&
    /^\/api\/printers\/[^/]+\/firmware_restart$/.test(pathname)
  )
    return true;

  if (m === 'PATCH' && /^\/api\/printer-models\/[^/]+$/.test(pathname))
    return true;
  if (m === 'DELETE' && /^\/api\/printer-models\/[^/]+$/.test(pathname))
    return true;

  if (m === 'GET' && pathname === '/api/settings/notifications') return true;
  if (m === 'PATCH' && pathname === '/api/settings/notifications') return true;

  return false;
}

export function registerAuthMiddleware(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const pathname = req.url.split('?')[0] ?? '';

    if (!pathname.startsWith('/api/')) return;

    if (pathname === '/api/health') return;
    if (pathname === '/api/auth/telegram') return;
    if (pathname.startsWith('/api/ws')) return;

    if (!isProtectedApiRoute(req.method, pathname)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader) return unauthorized(reply, 'Missing Authorization header');

    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return unauthorized(reply, 'Invalid Authorization header');

    const token = m[1];

    try {
      const payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
      if (!payload || typeof payload !== 'object')
        return unauthorized(reply, 'Invalid token');

      const sub = (payload as { sub?: unknown }).sub;
      if (typeof sub !== 'string' || !sub)
        return unauthorized(reply, 'Invalid token subject');

      const user = await prisma.user.findUnique({ where: { telegramId: sub } });
      if (!user || !user.isAllowed)
        return unauthorized(reply, 'User is not allowed');

      req.auth = { telegramId: sub };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return unauthorized(reply, msg);
    }
  });
}
