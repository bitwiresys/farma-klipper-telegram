import type { FastifyInstance } from 'fastify';

import { z } from 'zod';

import { prisma } from './prisma.js';

const CreatePrinterModelSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function registerPrinterModelsRoutes(app: FastifyInstance) {
  app.get('/api/printer-models', async (_req, reply) => {
    const models = await prisma.printerModel.findMany({ orderBy: { name: 'asc' } });
    return reply.send({ models });
  });

  app.post('/api/printer-models', async (req, reply) => {
    const parsed = CreatePrinterModelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const created = await prisma.printerModel.create({
      data: {
        name: parsed.data.name,
      },
    });

    return reply.code(201).send({ model: created });
  });
}
