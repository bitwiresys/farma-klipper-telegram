import type { FastifyInstance } from 'fastify';

import { CreatePrinterSchema, UpdatePrinterSchema } from '@farma/shared';

import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';

export async function registerPrintersRoutes(app: FastifyInstance) {
  app.get('/api/printers', async (_req, reply) => {
    const printers = (await prisma.printer.findMany({
      include: { model: true },
    })) as Array<{
      id: string;
      displayName: string;
      modelId: string;
      model: { name: string };
      bedX: number;
      bedY: number;
      bedZ: number;
      nozzleDiameter: number;
    }>;

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
      presetTitleByKey.set(
        `${d.printerId}::${d.remoteFilename}`,
        d.preset.title,
      );
    }

    return reply.send({
      printers: printers.map((p) => ({
        ...((): any => {
          const snap = printerRuntime.getSnapshot(p.id);
          const fn = String(snap.filename ?? '').trim();
          const key = fn ? `${p.id}::${fn}` : '';
          const presetTitle = key ? (presetTitleByKey.get(key) ?? null) : null;
          const jobLabel = presetTitle ? `preset: ${presetTitle}` : null;
          return {
            snapshot: {
              ...snap,
              jobLabel,
            },
          };
        })(),
        id: p.id,
        displayName: p.displayName,
        modelId: p.modelId,
        modelName: p.model.name,
        bedX: p.bedX,
        bedY: p.bedY,
        bedZ: p.bedZ,
        nozzleDiameter: p.nozzleDiameter,
        needsRekey: (p as any).needsRekey ?? false,
      })),
    });
  });

  app.post('/api/printers', async (req, reply) => {
    const parsed = CreatePrinterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const created = await printerRuntime.createPrinter({
      displayName: parsed.data.displayName,
      modelId: parsed.data.modelId,
      moonrakerBaseUrl: parsed.data.moonrakerBaseUrl,
      moonrakerApiKey: parsed.data.moonrakerApiKey,
    });

    const p = await prisma.printer.findUnique({
      where: { id: created.id },
      include: { model: true },
    });
    if (!p) return reply.code(500).send({ error: 'INTERNAL_ERROR' });

    return reply.code(201).send({
      printer: {
        id: p.id,
        displayName: p.displayName,
        modelId: p.modelId,
        modelName: p.model.name,
        bedX: p.bedX,
        bedY: p.bedY,
        bedZ: p.bedZ,
        nozzleDiameter: p.nozzleDiameter,
        needsRekey: (p as any).needsRekey ?? false,
        snapshot: printerRuntime.getSnapshot(p.id),
      },
    });
  });

  app.patch('/api/printers/:id', async (req, reply) => {
    const parsed = UpdatePrinterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const id = (req.params as any).id as string;
    const updated = await printerRuntime.updatePrinter(id, {
      displayName: parsed.data.displayName,
      modelId: parsed.data.modelId,
      moonrakerBaseUrl: parsed.data.moonrakerBaseUrl,
      moonrakerApiKey: parsed.data.moonrakerApiKey,
    });

    const p = await prisma.printer.findUnique({
      where: { id: updated.id },
      include: { model: true },
    });
    if (!p) return reply.code(500).send({ error: 'INTERNAL_ERROR' });

    return reply.send({
      printer: {
        id: p.id,
        displayName: p.displayName,
        modelId: p.modelId,
        modelName: p.model.name,
        bedX: p.bedX,
        bedY: p.bedY,
        bedZ: p.bedZ,
        nozzleDiameter: p.nozzleDiameter,
        needsRekey: (p as any).needsRekey ?? false,
        snapshot: printerRuntime.getSnapshot(p.id),
      },
    });
  });

  app.delete('/api/printers/:id', async (req, reply) => {
    const id = (req.params as any).id as string;
    await printerRuntime.deletePrinter(id);
    return reply.send({ ok: true });
  });

  app.post('/api/printers/:id/pause', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.action(id, 'pause');
    return reply.send({ ok: true, res });
  });

  app.post('/api/printers/:id/resume', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.action(id, 'resume');
    return reply.send({ ok: true, res });
  });

  app.post('/api/printers/:id/cancel', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.action(id, 'cancel');
    return reply.send({ ok: true, res });
  });

  app.post('/api/printers/:id/emergency_stop', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.emergencyStop(id);
    return reply.send({ ok: true, res });
  });
}
