import type { FastifyInstance } from 'fastify';

import { env } from './env.js';
import { getAllowedTelegramUserIds } from './env.js';
import { prisma } from './prisma.js';

let botUsernameCache: { value: string | null; tsMs: number } | null = null;
let botUsernameInflight: Promise<string | null> | null = null;

async function getBotUsernameFromTelegram(): Promise<string | null> {
  // 12h TTL (best-effort, username changes are very rare)
  const TTL_MS = 12 * 60 * 60_000;
  const now = Date.now();
  if (botUsernameCache && now - botUsernameCache.tsMs < TTL_MS) {
    return botUsernameCache.value;
  }

  if (botUsernameInflight) return botUsernameInflight;

  botUsernameInflight = (async () => {
    try {
      const token = env.TELEGRAM_BOT_TOKEN;
      const url = `https://api.telegram.org/bot${token}/getMe`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`getMe failed: ${res.status}`);
      const body = (await res.json()) as any;
      const username = String(body?.result?.username ?? '').trim();
      const value = username ? username : null;
      botUsernameCache = { value, tsMs: now };
      return value;
    } catch {
      botUsernameCache = { value: null, tsMs: now };
      return null;
    } finally {
      botUsernameInflight = null;
    }
  })();

  return botUsernameInflight;
}

export async function registerSecurityRoutes(app: FastifyInstance) {
  app.get('/api/security', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    const allowed = getAllowedTelegramUserIds();

    return reply.send({
      user: {
        telegramId: user.telegramId,
        chatId: user.chatId ?? null,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        isAllowed: user.isAllowed,
      },
      telegram: {
        botUsername: await getBotUsernameFromTelegram(),
      },
      allowedTelegramUserIds:
        allowed.size === 0 ? null : Array.from(allowed.values()).sort(),
    });
  });

  app.get('/api/security/allowed-users', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const allowedEnv = getAllowedTelegramUserIds();
    if (allowedEnv.size > 0) {
      return reply.code(409).send({
        error: 'MANAGED_BY_ENV',
        message: 'Allowlist is managed by env',
      });
    }

    const users = await prisma.user.findMany({
      where: { isAllowed: true },
      orderBy: { telegramId: 'asc' },
      select: {
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });

    return reply.send({
      allowedUsers: users,
    });
  });

  app.post('/api/security/allow', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const allowedEnv = getAllowedTelegramUserIds();
    if (allowedEnv.size > 0) {
      return reply.code(409).send({
        error: 'MANAGED_BY_ENV',
        message: 'Allowlist is managed by env',
      });
    }

    const body = (req.body ?? {}) as any;
    const idRaw = body.telegramId;
    const idNum =
      typeof idRaw === 'number' ? idRaw : Number(String(idRaw ?? ''));
    if (!Number.isSafeInteger(idNum) || idNum <= 0) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'Invalid telegramId' });
    }

    const upserted = await prisma.user.upsert({
      where: { telegramId: String(idNum) },
      create: {
        telegramId: String(idNum),
        isAllowed: true,
        notificationsEnabled: true,
        notifyFirstLayer: true,
        notifyComplete: true,
        notifyError: true,
      },
      update: { isAllowed: true },
    });

    return reply.send({
      ok: true,
      user: {
        telegramId: upserted.telegramId,
        firstName: upserted.firstName,
        lastName: upserted.lastName,
        username: upserted.username,
        isAllowed: upserted.isAllowed,
      },
    });
  });

  app.post('/api/security/disallow', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const allowedEnv = getAllowedTelegramUserIds();
    if (allowedEnv.size > 0) {
      return reply.code(409).send({
        error: 'MANAGED_BY_ENV',
        message: 'Allowlist is managed by env',
      });
    }

    const body = (req.body ?? {}) as any;
    const idRaw = body.telegramId;
    const idNum =
      typeof idRaw === 'number' ? idRaw : Number(String(idRaw ?? ''));
    if (!Number.isSafeInteger(idNum) || idNum <= 0) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'Invalid telegramId' });
    }

    const updated = await prisma.user.upsert({
      where: { telegramId: String(idNum) },
      create: {
        telegramId: String(idNum),
        isAllowed: false,
        notificationsEnabled: false,
        notifyFirstLayer: false,
        notifyComplete: false,
        notifyError: false,
      },
      update: { isAllowed: false },
    });

    return reply.send({
      ok: true,
      user: {
        telegramId: updated.telegramId,
        firstName: updated.firstName,
        lastName: updated.lastName,
        username: updated.username,
        isAllowed: updated.isAllowed,
      },
    });
  });
}
