import type { FastifyInstance } from 'fastify';

import { prisma } from './prisma.js';

export async function registerNotificationSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/notifications', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) return reply.code(401).send({ error: 'UNAUTHORIZED' });

    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND' });

    return reply.send({
      notifications: {
        notificationsEnabled: user.notificationsEnabled,
        notifyFirstLayer: user.notifyFirstLayer,
        notifyComplete: user.notifyComplete,
        notifyError: user.notifyError,
      },
    });
  });

  app.patch('/api/settings/notifications', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) return reply.code(401).send({ error: 'UNAUTHORIZED' });

    const body = (req.body ?? {}) as any;

    const data: any = {};
    if (typeof body.notificationsEnabled === 'boolean')
      data.notificationsEnabled = body.notificationsEnabled;
    if (typeof body.notifyFirstLayer === 'boolean')
      data.notifyFirstLayer = body.notifyFirstLayer;
    if (typeof body.notifyComplete === 'boolean')
      data.notifyComplete = body.notifyComplete;
    if (typeof body.notifyError === 'boolean')
      data.notifyError = body.notifyError;

    const user = await prisma.user.update({
      where: { telegramId },
      data,
    });

    return reply.send({
      notifications: {
        notificationsEnabled: user.notificationsEnabled,
        notifyFirstLayer: user.notifyFirstLayer,
        notifyComplete: user.notifyComplete,
        notifyError: user.notifyError,
      },
    });
  });
}
