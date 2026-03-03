import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import '@fastify/multipart';

import { CreatePresetSchema, UpdatePresetSchema } from '@farma/shared';

import { Prisma } from '@prisma/client';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { wsHub } from './ws_hub.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { printerRuntime } from './printer_runtime.js';
import { decryptApiKey } from './crypto_api_key.js';
import { presetMetaService } from './preset_meta_service.js';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function isSafeFilename(name: string): boolean {
  if (!name) return false;
  if (name.includes('..')) return false;
  if (name.includes('\\')) return false;
  if (name.startsWith('/')) return false;
  return true;
}

function presetToDto(p: any) {
  return {
    id: p.id,
    title: p.title,
    plasticType: p.plasticType,
    colorHex: p.colorHex,
    description: p.description ?? null,
    thumbnailUrl: p.thumbnailPath ? `/api/presets/${p.id}/thumbnail` : null,
    gcodeMeta:
      p.gcodeMeta && typeof p.gcodeMeta === 'object'
        ? (p.gcodeMeta as any)
        : null,
    compatibilityRules: {
      allowedModelIds: (p.allowedModels ?? []).map((x: any) => x.modelId),
      allowedNozzleDiameters: Array.isArray(
        p.compatibilityRules?.allowedNozzleDiameters,
      )
        ? p.compatibilityRules.allowedNozzleDiameters
        : [],
      minBedX: p.compatibilityRules?.minBedX ?? 0,
      minBedY: p.compatibilityRules?.minBedY ?? 0,
    },
  };
}

function resolveFilesDirSafe(relPath: string): string {
  const abs = path.resolve(env.FILES_DIR, relPath);
  const base = path.resolve(env.FILES_DIR);
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('INVALID_PATH');
  }
  return abs;
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runWithConcurrency<T>(
  limit: number,
  items: T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  return Promise.all(workers).then(() => undefined);
}

export async function registerPresetsRoutes(app: FastifyInstance) {
  app.get('/api/presets', async (_req, reply) => {
    const presets = await prisma.preset.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        allowedModels: true,
        compatibilityRules: true,
      },
    });

    return reply.send({ presets: presets.map(presetToDto) });
  });

  app.get('/api/presets/:id', async (req, reply) => {
    const id = (req.params as any).id as string;

    const preset = await prisma.preset.findUnique({
      where: { id },
      include: {
        allowedModels: true,
        compatibilityRules: true,
      },
    });

    if (!preset) return reply.code(404).send({ error: 'NOT_FOUND' });

    return reply.send({ preset: presetToDto(preset) });
  });

  app.get('/api/presets/:id/thumbnail', async (req, reply) => {
    const id = (req.params as any).id as string;

    const preset = await prisma.preset.findUnique({ where: { id } });
    if (!preset) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!preset.thumbnailPath)
      return reply.code(404).send({ error: 'NO_THUMBNAIL' });

    let abs: string;
    try {
      abs = resolveFilesDirSafe(preset.thumbnailPath);
    } catch {
      return reply.code(500).send({ error: 'INVALID_PATH' });
    }

    const stream = fs.createReadStream(abs);
    stream.on('error', () => {
      reply.code(404).send({ error: 'NOT_FOUND' });
    });

    // best-effort: default to png
    reply.type('image/png');
    return reply.send(stream);
  });

  app.post('/api/presets', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'multipart/form-data required',
      });
    }

    const parts = req.parts();

    let fileBuf: Buffer | null = null;
    let fileName: string | null = null;
    let jsonRaw: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.fieldname !== 'gcode' && part.fieldname !== 'file') continue;
        fileName = part.filename;
        fileBuf = await part.toBuffer();
      } else {
        if (part.fieldname !== 'data') continue;
        jsonRaw = String(part.value ?? '');
      }
    }

    if (!fileBuf)
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'gcode file is required (field: gcode or file)',
      });
    if (!fileName)
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'gcode filename missing' });
    if (!isSafeFilename(fileName)) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'invalid gcode filename' });
    }

    if (!jsonRaw)
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'data is required (field: data)',
      });

    let data: unknown;
    try {
      data = JSON.parse(jsonRaw);
    } catch {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'data must be valid JSON' });
    }

    const parsed = CreatePresetSchema.safeParse(data);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const presetId = crypto.randomUUID();
    const gcodeRel = path.posix.join('presets', presetId, fileName);
    const gcodeAbs = resolveFilesDirSafe(gcodeRel);
    ensureDir(path.dirname(gcodeAbs));
    fs.writeFileSync(gcodeAbs, fileBuf);

    const created = await prisma.preset.create({
      data: {
        id: presetId,
        title: parsed.data.title,
        plasticType: parsed.data.plasticType,
        colorHex: parsed.data.colorHex,
        description: parsed.data.description ?? null,
        gcodePath: gcodeRel,
        gcodeMeta: Prisma.DbNull,
        allowedModels: {
          create: parsed.data.compatibilityRules.allowedModelIds.map(
            (modelId: string) => ({ modelId }),
          ),
        },
        compatibilityRules: {
          create: {
            minBedX: parsed.data.compatibilityRules.minBedX,
            minBedY: parsed.data.compatibilityRules.minBedY,
            allowedNozzleDiameters:
              parsed.data.compatibilityRules.allowedNozzleDiameters,
          },
        },
      },
      include: {
        allowedModels: true,
        compatibilityRules: true,
      },
    });

    wsHub.broadcast({
      type: 'PRESET_UPDATED',
      payload: { presetId: created.id },
    });

    return reply.code(201).send({ preset: presetToDto(created) });
  });

  app.post('/api/presets/:id/print', async (req, reply) => {
    const presetId = (req.params as any).id as string;
    const body = (req.body ?? {}) as any;
    const printerIds = Array.isArray(body.printerIds)
      ? (body.printerIds as unknown[]).filter((x) => typeof x === 'string')
      : [];

    if (printerIds.length === 0) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'printerIds required' });
    }

    const preset = await prisma.preset.findUnique({
      where: { id: presetId },
      include: { compatibilityRules: true, allowedModels: true },
    });
    if (!preset) return reply.code(404).send({ error: 'NOT_FOUND' });

    const rules = (preset as any).compatibilityRules as
      | {
          minBedX: number;
          minBedY: number;
          allowedNozzleDiameters: unknown;
        }
      | null
      | undefined;

    const allowedModelIds = new Set(
      ((preset as any).allowedModels ?? []).map((x: any) => x.modelId),
    );
    const allowedNozzles = Array.isArray(rules?.allowedNozzleDiameters)
      ? (rules?.allowedNozzleDiameters as unknown[])
          .map((x) => (typeof x === 'number' ? x : null))
          .filter((x): x is number => x !== null)
      : [];

    const printers = await prisma.printer.findMany({
      where: { id: { in: printerIds } },
      include: { model: true },
    });

    const reasons: Array<{ printerId: string; reasons: string[] }> = [];
    const printable: typeof printers = [];

    for (const p of printers) {
      const r: string[] = [];
      if (allowedModelIds.size > 0 && !allowedModelIds.has(p.modelId)) {
        r.push('MODEL_NOT_ALLOWED');
      }
      if (rules) {
        if (p.bedX < rules.minBedX || p.bedY < rules.minBedY) {
          r.push('BED_TOO_SMALL');
        }
        if (
          allowedNozzles.length > 0 &&
          !allowedNozzles.includes(p.nozzleDiameter)
        ) {
          r.push('NOZZLE_NOT_ALLOWED');
        }
      }

      const snap = (printerRuntime.getSnapshot(p.id) ?? null) as any;
      const state = String(snap?.state ?? '');
      if (state === 'printing' || state === 'paused') {
        r.push('PRINTER_BUSY');
      }

      if (r.length > 0) {
        reasons.push({ printerId: p.id, reasons: r });
      } else {
        printable.push(p);
      }
    }

    if (reasons.length > 0) {
      return reply.code(409).send({ error: 'BLOCKED', reasons });
    }

    const abs = resolveFilesDirSafe(preset.gcodePath);
    const gcodeBuf = fs.readFileSync(abs);
    const checksum = sha256Hex(gcodeBuf);
    const remoteDir = path.posix.join('tg_presets', presetId);
    const remoteFilename = path.posix.join(remoteDir, `${checksum}.gcode`);

    await runWithConcurrency(2, printable, async (p) => {
      const printer = await prisma.printer.findUnique({ where: { id: p.id } });
      if (!printer) throw new Error('Printer not found');

      const apiKey = decryptApiKey(
        printer.apiKeyEncrypted,
        env.PRINTER_API_KEY_ENC_KEY,
      );

      const http = new MoonrakerHttp({
        baseUrl: printer.baseUrl,
        apiKey,
      });

      await http.uploadFile({
        filename: path.posix.basename(remoteFilename),
        data: gcodeBuf,
        path: remoteDir,
        root: 'gcodes',
        checksumSha256: checksum,
      });

      await presetMetaService.ensureMetaAndThumbnail({
        presetId,
        printerId: printer.id,
        remoteFilename,
        http,
      });
      await http.post('/printer/print/start', { filename: remoteFilename });
    });

    return reply.send({ ok: true, remoteFilename });
  });

  app.patch('/api/presets/:id', async (req, reply) => {
    const id = (req.params as any).id as string;

    const parsed = UpdatePresetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const existing = await prisma.preset.findUnique({
      where: { id },
      include: { compatibilityRules: true },
    });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });

    const rules = parsed.data.compatibilityRules;

    const updated = await prisma.preset.update({
      where: { id },
      data: {
        title: parsed.data.title,
        plasticType: parsed.data.plasticType,
        colorHex: parsed.data.colorHex,
        description:
          parsed.data.description === undefined
            ? undefined
            : parsed.data.description,
        allowedModels:
          rules && Array.isArray(rules.allowedModelIds)
            ? {
                deleteMany: {},
                create: rules.allowedModelIds.map((modelId: string) => ({
                  modelId,
                })),
              }
            : undefined,
        compatibilityRules: rules
          ? existing.compatibilityRules
            ? {
                update: {
                  minBedX: rules.minBedX,
                  minBedY: rules.minBedY,
                  allowedNozzleDiameters: rules.allowedNozzleDiameters,
                },
              }
            : {
                create: {
                  minBedX: rules.minBedX,
                  minBedY: rules.minBedY,
                  allowedNozzleDiameters: rules.allowedNozzleDiameters,
                },
              }
          : undefined,
      },
      include: { allowedModels: true, compatibilityRules: true },
    });

    wsHub.broadcast({
      type: 'PRESET_UPDATED',
      payload: { presetId: updated.id },
    });

    return reply.send({ preset: presetToDto(updated) });
  });

  app.delete('/api/presets/:id', async (req, reply) => {
    const id = (req.params as any).id as string;

    const preset = await prisma.preset.findUnique({ where: { id } });
    if (!preset) return reply.code(404).send({ error: 'NOT_FOUND' });

    await prisma.preset.delete({ where: { id } });

    // best-effort: remove files
    try {
      const abs = resolveFilesDirSafe(preset.gcodePath);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      const dir = path.dirname(abs);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    wsHub.broadcast({ type: 'PRESET_UPDATED', payload: { presetId: id } });

    return reply.send({ ok: true });
  });
}
