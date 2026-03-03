import type { FastifyInstance } from 'fastify';

import type { PrintHistoryDto } from '@farma/shared';

import { prisma } from './prisma.js';

export async function registerHistoryRoutes(app: FastifyInstance) {
  app.get('/api/history', async (req, reply) => {
    const q = (req.query ?? {}) as { status?: string };
    const status = typeof q.status === 'string' ? q.status.trim() : '';

    const where = status
      ? {
          status,
        }
      : undefined;

    const items = await prisma.printHistory.findMany({
      where,
      orderBy: {
        startedAt: 'desc',
      },
      take: 200,
    });

    const result: PrintHistoryDto[] = items.map((x) => {
      return {
        id: x.id,
        printerId: x.printerId,
        filename: x.filename,
        status: x.status as PrintHistoryDto['status'],
        startedAt: x.startedAt.toISOString(),
        endedAt: x.endedAt ? x.endedAt.toISOString() : null,
        printDurationSec: x.printDurationSec,
        totalDurationSec: x.totalDurationSec,
        filamentUsedMm: x.filamentUsedMm,
        errorMessage: x.errorMessage,
      };
    });

    return reply.send({ history: result });
  });
}
