import type { FastifyInstance } from 'fastify';

import { CreatePrinterSchema, UpdatePrinterSchema } from '@farma/shared';

import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';

export async function registerPrintersRoutes(app: FastifyInstance) {
  app.get('/api/printers', async (_req, reply) => {
    const printers = (await prisma.printer.findMany({ include: { model: true } })) as Array<{
      id: string;
      displayName: string;
      modelId: string;
      model: { name: string };
      bedX: number;
      bedY: number;
      bedZ: number;
      nozzleDiameter: number;
    }>;
    return reply.send({
      printers: printers.map((p) => ({
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
      })),
    });
  });

  app.post('/api/printers', async (req, reply) => {
    const parsed = CreatePrinterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const created = await printerRuntime.createPrinter({
      displayName: parsed.data.displayName,
      modelId: parsed.data.modelId,
      moonrakerBaseUrl: parsed.data.moonrakerBaseUrl,
      moonrakerApiKey: parsed.data.moonrakerApiKey,
    });

    const p = await prisma.printer.findUnique({ where: { id: created.id }, include: { model: true } });
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
      return reply.code(400).send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const id = (req.params as any).id as string;
    const updated = await printerRuntime.updatePrinter(id, {
      displayName: parsed.data.displayName,
      modelId: parsed.data.modelId,
      moonrakerBaseUrl: parsed.data.moonrakerBaseUrl,
      moonrakerApiKey: parsed.data.moonrakerApiKey,
    });

    const p = await prisma.printer.findUnique({ where: { id: updated.id }, include: { model: true } });
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

  app.post('/api/printers/:id/test', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.testPrinter(id);
    return reply.send({ ok: true, res });
  });

  app.post('/api/printers/:id/rescan', async (req, reply) => {
    const id = (req.params as any).id as string;
    await printerRuntime.rescanPrinter(id);
    const p = await prisma.printer.findUnique({ where: { id }, include: { model: true } });
    if (!p) return reply.code(404).send({ error: 'NOT_FOUND' });
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
}
