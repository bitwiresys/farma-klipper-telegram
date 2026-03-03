import type { FastifyInstance } from 'fastify';

import type { PrinterDto } from '@farma/shared';

import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';

export async function registerSnapshotRoutes(app: FastifyInstance) {
  app.get('/api/snapshot', async (_req, reply) => {
    const printers = await prisma.printer.findMany({
      include: {
        model: true,
      },
    });

    const result: PrinterDto[] = printers.map((p) => {
      const snap = printerRuntime.getSnapshot(p.id);
      return {
        id: p.id,
        displayName: p.displayName,
        modelId: p.modelId,
        modelName: p.model.name,
        bedX: p.bedX,
        bedY: p.bedY,
        bedZ: p.bedZ,
        nozzleDiameter: p.nozzleDiameter,
        snapshot: snap,
      };
    });

    return reply.send({ printers: result });
  });
}
