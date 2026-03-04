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

    const activePairs = printers
      .map((p) => {
        const snap = printerRuntime.getSnapshot(p.id);
        const fn = String(snap.filename ?? '').trim();
        return fn ? { printerId: p.id, filename: fn } : null;
      })
      .filter((x): x is { printerId: string; filename: string } => x !== null);

    const deployments =
      activePairs.length > 0
        ? await prisma.presetDeployment.findMany({
            where: {
              OR: activePairs.map((x) => ({
                printerId: x.printerId,
                remoteFilename: x.filename,
              })),
            },
            include: { preset: { select: { title: true } } },
          })
        : [];

    const presetTitleByKey = new Map<string, string>();
    for (const d of deployments) {
      const key = `${d.printerId}::${d.remoteFilename}`;
      presetTitleByKey.set(key, d.preset.title);
    }

    const result: PrinterDto[] = printers.map((p) => {
      const snap = printerRuntime.getSnapshot(p.id);
      const fn = String(snap.filename ?? '').trim();
      const key = fn ? `${p.id}::${fn}` : '';
      const presetTitle = key ? (presetTitleByKey.get(key) ?? null) : null;
      const jobLabel = presetTitle ? `preset: ${presetTitle}` : null;
      return {
        id: p.id,
        displayName: p.displayName,
        modelId: p.modelId,
        modelName: p.model.name,
        bedX: p.bedX,
        bedY: p.bedY,
        bedZ: p.bedZ,
        nozzleDiameter: p.nozzleDiameter,
        needsRekey: p.needsRekey,
        snapshot: {
          ...snap,
          jobLabel,
        },
      };
    });

    return reply.send({ printers: result });
  });
}
