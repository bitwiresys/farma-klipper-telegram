import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

const GCODE_REF_PREFIX = 'mr:';

function encodeGcodeRef(input: {
  sourcePrinterId: string;
  filename: string;
}): string {
  return `${GCODE_REF_PREFIX}${input.sourcePrinterId}::${input.filename}`;
}

function decodeGcodeRef(
  x: string,
): { sourcePrinterId: string; filename: string } | null {
  if (!x.startsWith(GCODE_REF_PREFIX)) return null;
  const rest = x.slice(GCODE_REF_PREFIX.length);
  const idx = rest.indexOf('::');
  if (idx <= 0) return null;
  const sourcePrinterId = rest.slice(0, idx);
  const filename = rest.slice(idx + 2);
  if (!sourcePrinterId || !filename) return null;
  return { sourcePrinterId, filename };
}

function presetToDto(p: any) {
  return {
    id: p.id,
    title: p.title,
    plasticType: p.plasticType,
    colorHex: p.colorHex,
    description: p.description ?? null,
    thumbnailUrl: p.thumbnailPath
      ? `/api/presets/${p.id}/thumbnail?t=${new Date(p.updatedAt).getTime()}`
      : null,
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

    reply.header('Cache-Control', 'no-store');
    // best-effort: default to png
    reply.type('image/png');
    return reply.send(stream);
  });

  app.post('/api/presets', async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const parsed = CreatePresetSchema.safeParse(body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', details: parsed.error.flatten() });
    }

    const sourcePrinterId = String(body?.sourcePrinterId ?? '').trim();
    const sourceFilename = String(body?.sourceFilename ?? '').trim();
    if (!sourcePrinterId || !sourceFilename) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'sourcePrinterId and sourceFilename required',
      });
    }
    if (!isSafeFilename(sourceFilename)) {
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'invalid sourceFilename' });
    }

    const presetId = crypto.randomUUID();
    const sourcePrinter = await prisma.printer.findUnique({
      where: { id: sourcePrinterId },
    });
    if (!sourcePrinter) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: 'sourcePrinterId not found',
      });
    }

    const sourceApiKey = decryptApiKey(
      sourcePrinter.apiKeyEncrypted,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const sourceHttp = new MoonrakerHttp({
      baseUrl: sourcePrinter.baseUrl,
      apiKey: sourceApiKey,
    });

    const allowedModelIds = Array.isArray(
      parsed.data.compatibilityRules?.allowedModelIds,
    )
      ? parsed.data.compatibilityRules.allowedModelIds
      : [];

    const printersForModels =
      allowedModelIds.length > 0
        ? await prisma.printer.findMany({
            where: { modelId: { in: allowedModelIds } },
            select: { bedX: true, bedY: true },
          })
        : [];

    const computedMinBed = printersForModels.reduce(
      (acc, p) => {
        return {
          minBedX: Math.min(acc.minBedX, p.bedX),
          minBedY: Math.min(acc.minBedY, p.bedY),
        };
      },
      {
        minBedX: Number.isFinite(sourcePrinter.bedX) ? sourcePrinter.bedX : 10,
        minBedY: Number.isFinite(sourcePrinter.bedY) ? sourcePrinter.bedY : 10,
      },
    );

    // Download gcode immediately and store locally (project-owned)
    const gcodeBytes = await sourceHttp.downloadFile({
      root: 'gcodes',
      filename: sourceFilename,
    });
    const checksum = sha256Hex(gcodeBytes);
    const gcodeRel = path.posix.join('presets', presetId, `${checksum}.gcode`);
    const gcodeAbs = resolveFilesDirSafe(gcodeRel);
    ensureDir(path.dirname(gcodeAbs));
    fs.writeFileSync(gcodeAbs, gcodeBytes);

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
          create: allowedModelIds.map((modelId: string) => ({ modelId })),
        },
        compatibilityRules: {
          create: {
            minBedX: computedMinBed.minBedX,
            minBedY: computedMinBed.minBedY,
            allowedNozzleDiameters: [sourcePrinter.nozzleDiameter],
          },
        },
      },
      include: {
        allowedModels: true,
        compatibilityRules: true,
      },
    });

    // Fetch metadata + thumbnail immediately (slicer preview already exists)
    try {
      await presetMetaService.ensureMetaAndThumbnail({
        presetId: created.id,
        printerId: sourcePrinterId,
        remoteFilename: sourceFilename,
        http: sourceHttp,
      });
    } catch {
      // best-effort
    }

    // After meta is fetched, align required nozzle to gcode metadata (if available).
    try {
      const updatedMeta = await prisma.preset.findUnique({
        where: { id: created.id },
      });
      const nozzleFromMeta = Number(
        (updatedMeta as any)?.gcodeMeta?.gcode_nozzle_diameter,
      );
      const requiredNozzle =
        Number.isFinite(nozzleFromMeta) && nozzleFromMeta > 0
          ? nozzleFromMeta
          : sourcePrinter.nozzleDiameter;

      await prisma.presetCompatibilityRules.update({
        where: { presetId: created.id },
        data: { allowedNozzleDiameters: [requiredNozzle] },
      });
    } catch {
      // best-effort
    }

    const createdWithMeta = await prisma.preset.findUnique({
      where: { id: created.id },
      include: { allowedModels: true, compatibilityRules: true },
    });

    wsHub.broadcast({
      type: 'PRESET_UPDATED',
      payload: { presetId: created.id },
    });

    return reply
      .code(201)
      .send({ preset: presetToDto(createdWithMeta ?? created) });
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

    const ref = decodeGcodeRef(preset.gcodePath);

    const gcodeBuf = ref
      ? await (async () => {
          const sourcePrinter = await prisma.printer.findUnique({
            where: { id: ref.sourcePrinterId },
          });
          if (!sourcePrinter) {
            throw new Error('SOURCE_PRINTER_NOT_FOUND');
          }

          const sourceApiKey = decryptApiKey(
            sourcePrinter.apiKeyEncrypted,
            env.PRINTER_API_KEY_ENC_KEY,
          );

          const sourceHttp = new MoonrakerHttp({
            baseUrl: sourcePrinter.baseUrl,
            apiKey: sourceApiKey,
          });

          // Download gcode from Moonraker file manager
          return sourceHttp.downloadFile({
            root: 'gcodes',
            filename: ref.filename,
          });
        })()
      : (() => {
          // legacy upload-based preset
          const abs = resolveFilesDirSafe(preset.gcodePath);
          return fs.readFileSync(abs);
        })();

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

      await prisma.presetDeployment.upsert({
        where: {
          presetId_printerId: {
            presetId,
            printerId: printer.id,
          },
        },
        create: {
          presetId,
          printerId: printer.id,
          remoteFilename,
          checksumSha256: checksum,
        },
        update: {
          remoteFilename,
          checksumSha256: checksum,
        },
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

    const nextAllowedModelIds =
      rules && Array.isArray(rules.allowedModelIds)
        ? rules.allowedModelIds
        : null;

    const printersForModels =
      nextAllowedModelIds && nextAllowedModelIds.length > 0
        ? await prisma.printer.findMany({
            where: { modelId: { in: nextAllowedModelIds } },
            select: { bedX: true, bedY: true },
          })
        : [];

    const currentNozzleFromMeta = Number(
      (existing as any)?.gcodeMeta?.gcode_nozzle_diameter,
    );
    const requiredNozzle =
      Number.isFinite(currentNozzleFromMeta) && currentNozzleFromMeta > 0
        ? currentNozzleFromMeta
        : null;

    const computedMinBed = printersForModels.reduce(
      (acc, p) => {
        return {
          minBedX: Math.min(acc.minBedX, p.bedX),
          minBedY: Math.min(acc.minBedY, p.bedY),
        };
      },
      {
        minBedX:
          typeof (existing as any)?.compatibilityRules?.minBedX === 'number'
            ? (existing as any).compatibilityRules.minBedX
            : 10,
        minBedY:
          typeof (existing as any)?.compatibilityRules?.minBedY === 'number'
            ? (existing as any).compatibilityRules.minBedY
            : 10,
      },
    );

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
                  minBedX: computedMinBed.minBedX,
                  minBedY: computedMinBed.minBedY,
                  ...(requiredNozzle !== null
                    ? { allowedNozzleDiameters: [requiredNozzle] }
                    : {}),
                },
              }
            : {
                create: {
                  minBedX: computedMinBed.minBedX,
                  minBedY: computedMinBed.minBedY,
                  allowedNozzleDiameters:
                    requiredNozzle !== null ? [requiredNozzle] : [],
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

    // best-effort: remove local files for locally stored presets (and legacy ones)
    try {
      if (!preset.gcodePath.startsWith(GCODE_REF_PREFIX)) {
        const abs = resolveFilesDirSafe(preset.gcodePath);
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });

        const dir = path.dirname(abs);
        if (fs.existsSync(dir))
          fs.rmSync(dir, { recursive: true, force: true });
      }

      if (preset.thumbnailPath) {
        const absThumb = resolveFilesDirSafe(preset.thumbnailPath);
        if (fs.existsSync(absThumb)) fs.rmSync(absThumb, { force: true });
      }
    } catch {
      // ignore
    }

    wsHub.broadcast({ type: 'PRESET_UPDATED', payload: { presetId: id } });

    return reply.send({ ok: true });
  });
}
