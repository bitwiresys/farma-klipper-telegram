import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

import { AuthTelegramSchema } from '@farma/shared';

import { env, getAllowedTelegramUserIds } from './env.js';
import { prisma } from './prisma.js';
import { validateTelegramInitData } from './telegram_init_data.js';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/telegram', async (req, reply) => {
    const parsed = AuthTelegramSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    let tg;
    try {
      tg = validateTelegramInitData({
        initData: parsed.data.initData,
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSec: env.TELEGRAM_AUTH_MAX_AGE_SEC,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: msg });
    }

    const allowed = getAllowedTelegramUserIds();
    const isAllowed = allowed.size === 0 ? true : allowed.has(tg.user.id);
    if (!isAllowed) {
      await prisma.user.upsert({
        where: { telegramId: String(tg.user.id) },
        create: {
          telegramId: String(tg.user.id),
          isAllowed: false,
          firstName: tg.user.first_name ?? null,
          lastName: tg.user.last_name ?? null,
          username: tg.user.username ?? null,
        },
        update: {
          isAllowed: false,
          firstName: tg.user.first_name ?? null,
          lastName: tg.user.last_name ?? null,
          username: tg.user.username ?? null,
        },
      });

      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    const telegramId = String(tg.user.id);

    await prisma.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        isAllowed: true,
        firstName: tg.user.first_name ?? null,
        lastName: tg.user.last_name ?? null,
        username: tg.user.username ?? null,
      },
      update: {
        isAllowed: true,
        firstName: tg.user.first_name ?? null,
        lastName: tg.user.last_name ?? null,
        username: tg.user.username ?? null,
      },
    });

    const token = jwt.sign(
      {
        sub: telegramId,
        t: 'tg',
      },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: '7d',
      },
    );

    return reply.send({ token });
  });
}
