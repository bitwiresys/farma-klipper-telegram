import type { FastifyInstance } from 'fastify';

import { prisma } from './prisma.js';

export async function registerMeRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({
      user: {
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
      },
    });
  });
}
