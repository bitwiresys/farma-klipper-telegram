import type { FastifyInstance } from 'fastify';

import { CreatePrinterSchema, UpdatePrinterSchema } from '@farma/shared';

import { prisma } from './prisma.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { printerRuntime } from './printer_runtime.js';

function normalizeBaseUrl(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.replace(/\/+$/, '');
}

function normalizeApiKey(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  if (!s) return null;
  return s;
}

async function detectSpecs(http: MoonrakerHttp): Promise<{
  bedX: number | null;
  bedY: number | null;
  bedZ: number | null;
  nozzleDiameter: number | null;
}> {
  const toolheadResp = (await http.queryObjects(['toolhead'])) as any;
  const configResp = (await http.queryObjects(['configfile'])) as any;

  const toolhead =
    toolheadResp?.result?.status?.toolhead ?? toolheadResp?.status?.toolhead;
  const axisMin = toolhead?.axis_minimum;
  const axisMax = toolhead?.axis_maximum;

  const bedX =
    Array.isArray(axisMin) && Array.isArray(axisMax)
      ? Number(axisMax[0]) - Number(axisMin[0])
      : null;
  const bedY =
    Array.isArray(axisMin) && Array.isArray(axisMax)
      ? Number(axisMax[1]) - Number(axisMin[1])
      : null;
  const bedZ =
    Array.isArray(axisMin) && Array.isArray(axisMax)
      ? Number(axisMax[2]) - Number(axisMin[2])
      : null;

  const nozzleDiameter =
    Number(
      configResp?.result?.status?.configfile?.settings?.extruder
        ?.nozzle_diameter ??
        configResp?.status?.configfile?.settings?.extruder?.nozzle_diameter,
    ) || null;

  return {
    bedX: bedX !== null && Number.isFinite(bedX) ? bedX : null,
    bedY: bedY !== null && Number.isFinite(bedY) ? bedY : null,
    bedZ: bedZ !== null && Number.isFinite(bedZ) ? bedZ : null,
    nozzleDiameter:
      nozzleDiameter !== null && Number.isFinite(nozzleDiameter)
        ? nozzleDiameter
        : null,
  };
}

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

  app.post('/api/printers/test-draft', async (req, reply) => {
    const baseUrl = normalizeBaseUrl((req.body as any)?.moonrakerBaseUrl);
    const apiKey = normalizeApiKey((req.body as any)?.moonrakerApiKey);

    if (!baseUrl || !apiKey) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        details: {
          baseUrl: baseUrl ? undefined : 'Invalid moonrakerBaseUrl',
          apiKey: apiKey ? undefined : 'Invalid moonrakerApiKey',
        },
      });
    }

    const http = new MoonrakerHttp({ baseUrl, apiKey });
    const info = await http.get('/server/info');
    const specs = await detectSpecs(http);
    return reply.send({ ok: true, info, specs });
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

  app.post('/api/printers/:id/test', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.testPrinter(id);
    return reply.send({ ok: true, res });
  });

  app.post('/api/printers/:id/rescan', async (req, reply) => {
    const id = (req.params as any).id as string;
    await printerRuntime.rescanPrinter(id);
    const p = await prisma.printer.findUnique({
      where: { id },
      include: { model: true },
    });
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

  app.post('/api/printers/:id/emergency_stop', async (req, reply) => {
    const id = (req.params as any).id as string;
    const res = await printerRuntime.emergencyStop(id);
    return reply.send({ ok: true, res });
  });
}
