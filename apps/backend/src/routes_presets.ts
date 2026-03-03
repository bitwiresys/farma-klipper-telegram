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
