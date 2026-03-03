import type { FastifyInstance } from 'fastify';

import type { PrintHistoryDto } from '@farma/shared';

import { prisma } from './prisma.js';

export async function registerHistoryRoutes(app: FastifyInstance) {
  app.get('/api/history', async (req, reply) => {
    const q = (req.query ?? {}) as { status?: string; limit?: string; offset?: string };
    const statusRaw = typeof q.status === 'string' ? q.status.trim().toLowerCase() : 'all';

    const limitReq = Number(q.limit ?? '50');
    const offsetReq = Number(q.offset ?? '0');
    const take = Number.isFinite(limitReq) ? Math.min(200, Math.max(1, Math.floor(limitReq))) : 50;
    const skip = Number.isFinite(offsetReq) ? Math.max(0, Math.floor(offsetReq)) : 0;

    const where =
      statusRaw === 'all'
        ? undefined
        : statusRaw === 'completed'
          ? { status: 'completed' }
          : statusRaw === 'error'
            ? { status: 'error' }
            : statusRaw === 'cancelled'
              ? { status: 'cancelled' }
              : undefined;

    const items = await prisma.printHistory.findMany({
      where,
      orderBy: {
        startedAt: 'desc',
      },
      take,
      skip,
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
