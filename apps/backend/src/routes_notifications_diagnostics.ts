import type { FastifyInstance } from 'fastify';

import { env, getAllowedTelegramUserIds } from './env.js';
import { prisma } from './prisma.js';

export async function registerNotificationDiagnosticsRoutes(
  app: FastifyInstance,
) {
  app.get('/api/notifications/diagnostics', async (_req, reply) => {
    const allowedEnv = getAllowedTelegramUserIds();

    const users = await prisma.user.findMany({
      orderBy: { telegramId: 'asc' },
      select: {
        telegramId: true,
        chatId: true,
        isAllowed: true,
        notificationsEnabled: true,
        notifyFirstLayer: true,
        notifyComplete: true,
        notifyError: true,
        firstName: true,
        lastName: true,
        username: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const rows = users.map((u) => {
      const eligibleByRepo = u.isAllowed && !!u.chatId;
      const allowedByEnv =
        allowedEnv.size === 0 ? null : allowedEnv.has(Number(u.telegramId));

      return {
        telegramId: u.telegramId,
        chatId: u.chatId,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        isAllowed: u.isAllowed,
        allowedByEnv,
        notificationsEnabled: u.notificationsEnabled,
        notifyFirstLayer: u.notifyFirstLayer,
        notifyComplete: u.notifyComplete,
        notifyError: u.notifyError,
        eligibleByRepo,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
        hints: {
          needsStart:
            u.isAllowed && !u.chatId
              ? 'User must open the bot and press /start to save chatId'
              : null,
          notAllowed: !u.isAllowed
            ? allowedEnv.size > 0
              ? `User is not allowed (TELEGRAM_ALLOWED_USER_IDS is set in env)`
              : 'User is not allowed (allowlist is managed in DB)'
            : null,
          notificationsOff:
            u.isAllowed && !!u.chatId && !u.notificationsEnabled
              ? 'Notifications are disabled for this user'
              : null,
        },
      };
    });

    return reply.send({
      env: {
        nodeEnv: env.NODE_ENV,
        allowedUserIds:
          allowedEnv.size === 0 ? null : Array.from(allowedEnv.values()).sort(),
      },
      totals: {
        users: rows.length,
        eligibleByRepo: rows.filter((r) => r.eligibleByRepo).length,
      },
      users: rows,
    });
  });
}
