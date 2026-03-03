import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

import { Prisma } from '@prisma/client';

import { PrinterState } from '@farma/shared';

import {
  startMockMoonraker,
  type MockMoonrakerSharedState,
} from './mock-moonraker/mock_moonraker.js';
import { assertMoonrakerTestBaseUrlSafe } from './test_safety_switch.js';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFileSafe(abs: string, buf: Buffer) {
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, buf);
}

// env.ts parses at import time, so set env BEFORE importing app/prisma modules
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_jwt_secret_1234567890';
process.env.TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ?? '123456:TESTTOKEN';
process.env.TELEGRAM_WEBAPP_URL =
  process.env.TELEGRAM_WEBAPP_URL ?? 'https://example.com';
process.env.PRINTER_API_KEY_ENC_KEY =
  process.env.PRINTER_API_KEY_ENC_KEY ?? 'test_printer_api_key_enc_key_123456';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '..');
const DEV_DB_ABS = path.join(BACKEND_DIR, 'prisma', 'dev.db');
const DEV_DB_URL = `file:${DEV_DB_ABS.replace(/\\/g, '/')}`;

process.env.DATABASE_URL = process.env.DATABASE_URL ?? DEV_DB_URL;
process.env.FILES_DIR = process.env.FILES_DIR ?? './test-data';

const TEST_FILES_DIR_ABS = path.resolve('test-data');

const { buildApp } = await import('../src/app.js');
const { prisma } = await import('../src/prisma.js');
const { env } = await import('../src/env.js');
const { encryptApiKey } = await import('../src/crypto_api_key.js');
const { printerRuntime } = await import('../src/printer_runtime.js');

describe('presets print pipeline (integration)', () => {
  const apiKeyPlain = 'mock-api-key';

  let app: any;
  let mock: Awaited<ReturnType<typeof startMockMoonraker>>;

  let token: string;

  async function resetDb() {
    await prisma.notificationLog.deleteMany();
    await prisma.printHistory.deleteMany();
    await prisma.presetDeployment.deleteMany();
    await prisma.presetAllowedModel.deleteMany();
    await prisma.presetCompatibilityRules.deleteMany();
    await prisma.preset.deleteMany();
    await prisma.printer.deleteMany();
    await prisma.printerModel.deleteMany();
    await prisma.user.deleteMany();
  }

  async function seedUserAllowed() {
    const telegramId = '1';
    await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, isAllowed: true },
      update: { isAllowed: true },
    });

    token = jwt.sign({ sub: telegramId, t: 'tg' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
  }

  beforeAll(async () => {
    ensureDir(TEST_FILES_DIR_ABS);

    mock = await startMockMoonraker();
    assertMoonrakerTestBaseUrlSafe(mock.baseUrl);

    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await mock?.close();
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    mock.controls.resetCalls();
    mock.controls.setBusy(false);
    mock.controls.setDelayMs(0);
    mock.controls.setStartBarrier(0);

    // Clean test-data dir best-effort
    try {
      if (fs.existsSync(TEST_FILES_DIR_ABS)) {
        fs.rmSync(TEST_FILES_DIR_ABS, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
    ensureDir(TEST_FILES_DIR_ABS);

    await resetDb();
    await seedUserAllowed();
  });

  it('1) upload→metascan→metadata/thumbnails→start (calls order)', async () => {
    const model = await prisma.printerModel.create({ data: { name: 'K1' } });

    const apiKeyEncrypted = encryptApiKey(
      apiKeyPlain,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const printer = await prisma.printer.create({
      data: {
        displayName: 'P1',
        baseUrl: mock.baseUrl,
        apiKeyEncrypted,
        needsRekey: false,
        bedX: 300,
        bedY: 300,
        bedZ: 300,
        nozzleDiameter: 0.4,
        modelId: model.id,
      },
    });

    const presetId = 'preset-1';
    const gcodeRel = path.posix.join('presets', presetId, 'file.gcode');
    const gcodeAbs = path.resolve(env.FILES_DIR, gcodeRel);
    writeFileSafe(gcodeAbs, Buffer.from('G1 X1 Y1\n', 'utf8'));

    await prisma.preset.create({
      data: {
        id: presetId,
        title: 'T',
        plasticType: 'PLA',
        colorHex: '#ffffff',
        description: null,
        gcodePath: gcodeRel,
        gcodeMeta: Prisma.DbNull,
        allowedModels: { create: [{ modelId: model.id }] },
        compatibilityRules: {
          create: {
            minBedX: 10,
            minBedY: 10,
            allowedNozzleDiameters: [0.4],
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/presets/${presetId}/print`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        printerIds: [printer.id],
      },
    });

    if (res.statusCode !== 200) {
      // Error handler should include { error, message }
      // Print to help diagnose root cause locally/CI.
      // eslint-disable-next-line no-console
      console.log('print endpoint failed', {
        statusCode: res.statusCode,
        body: res.body,
      });
    }
    expect(res.statusCode).toBe(200);

    const kinds = mock.calls.map((c) => c.kind);
    expect(kinds).toEqual([
      'upload',
      'metascan',
      'metadata',
      'thumbnails',
      'print_start',
    ]);

    const startCall = mock.calls.find((c) => c.kind === 'print_start') as any;
    expect(String(startCall.filename)).toContain(`tg_presets/${presetId}/`);
  });

  it('2) compatibility blocks: reasons[] and no upload/start', async () => {
    const modelOk = await prisma.printerModel.create({ data: { name: 'OK' } });
    const modelOther = await prisma.printerModel.create({
      data: { name: 'OTHER' },
    });

    const apiKeyEncrypted = encryptApiKey(
      apiKeyPlain,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const printer = await prisma.printer.create({
      data: {
        displayName: 'P1',
        baseUrl: mock.baseUrl,
        apiKeyEncrypted,
        needsRekey: false,
        bedX: 50,
        bedY: 50,
        bedZ: 50,
        nozzleDiameter: 0.4,
        modelId: modelOk.id,
      },
    });

    const presetId = 'preset-2';
    const gcodeRel = path.posix.join('presets', presetId, 'file.gcode');
    const gcodeAbs = path.resolve(env.FILES_DIR, gcodeRel);
    writeFileSafe(gcodeAbs, Buffer.from('G1 X1 Y1\n', 'utf8'));

    // preset only allows OTHER model
    await prisma.preset.create({
      data: {
        id: presetId,
        title: 'T',
        plasticType: 'PLA',
        colorHex: '#ffffff',
        description: null,
        gcodePath: gcodeRel,
        gcodeMeta: Prisma.DbNull,
        allowedModels: { create: [{ modelId: modelOther.id }] },
        compatibilityRules: {
          create: {
            minBedX: 10,
            minBedY: 10,
            allowedNozzleDiameters: [0.4],
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/presets/${presetId}/print`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        printerIds: [printer.id],
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('BLOCKED');
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(body.reasons[0].printerId).toBe(printer.id);
    expect(body.reasons[0].reasons).toContain('MODEL_NOT_ALLOWED');

    expect(mock.calls.length).toBe(0);
  });

  it('3) busy/not-ready blocks: PRINTER_BUSY and no upload/start', async () => {
    const model = await prisma.printerModel.create({ data: { name: 'K1' } });

    const apiKeyEncrypted = encryptApiKey(
      apiKeyPlain,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const printer = await prisma.printer.create({
      data: {
        displayName: 'P1',
        baseUrl: mock.baseUrl,
        apiKeyEncrypted,
        needsRekey: false,
        bedX: 300,
        bedY: 300,
        bedZ: 300,
        nozzleDiameter: 0.4,
        modelId: model.id,
      },
    });

    // Force runtime snapshot to busy without touching real printer
    (printerRuntime as any).cache.get(printer.id).snapshot = {
      state: PrinterState.printing,
      filename: 'x.gcode',
      progress: 0.1,
      etaSec: 100,
      temps: { extruder: null, bed: null },
      layers: { current: null, total: null },
    };

    const presetId = 'preset-3';
    const gcodeRel = path.posix.join('presets', presetId, 'file.gcode');
    const gcodeAbs = path.resolve(env.FILES_DIR, gcodeRel);
    writeFileSafe(gcodeAbs, Buffer.from('G1 X1 Y1\n', 'utf8'));

    await prisma.preset.create({
      data: {
        id: presetId,
        title: 'T',
        plasticType: 'PLA',
        colorHex: '#ffffff',
        description: null,
        gcodePath: gcodeRel,
        gcodeMeta: Prisma.DbNull,
        allowedModels: { create: [{ modelId: model.id }] },
        compatibilityRules: {
          create: {
            minBedX: 10,
            minBedY: 10,
            allowedNozzleDiameters: [0.4],
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/presets/${presetId}/print`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        printerIds: [printer.id],
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('BLOCKED');
    expect(body.reasons[0].reasons).toContain('PRINTER_BUSY');

    expect(mock.calls.length).toBe(0);
  });

  it('4) concurrency limit=2 for multi-start (mock barrier)', async () => {
    const model = await prisma.printerModel.create({ data: { name: 'K1' } });

    const apiKeyEncrypted = encryptApiKey(
      apiKeyPlain,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const shared: MockMoonrakerSharedState = {
      stats: { activeStarts: 0, maxConcurrentStarts: 0 },
      barrier: { count: 0, released: false, waiters: [] },
    };

    const mocks = await Promise.all(
      Array.from({ length: 4 }).map(() => startMockMoonraker({ shared })),
    );

    try {
      for (const m of mocks) assertMoonrakerTestBaseUrlSafe(m.baseUrl);

      const printers = await Promise.all(
        mocks.map((m, i) =>
          prisma.printer.create({
            data: {
              displayName: `P${i + 1}`,
              baseUrl: m.baseUrl,
              apiKeyEncrypted,
              needsRekey: false,
              bedX: 300,
              bedY: 300,
              bedZ: 300,
              nozzleDiameter: 0.4,
              modelId: model.id,
            },
          }),
        ),
      );

      const presetId = 'preset-4';
      const gcodeRel = path.posix.join('presets', presetId, 'file.gcode');
      const gcodeAbs = path.resolve(env.FILES_DIR, gcodeRel);
      writeFileSafe(gcodeAbs, Buffer.from('G1 X1 Y1\n', 'utf8'));

      await prisma.preset.create({
        data: {
          id: presetId,
          title: 'T',
          plasticType: 'PLA',
          colorHex: '#ffffff',
          description: null,
          gcodePath: gcodeRel,
          gcodeMeta: Prisma.DbNull,
          allowedModels: { create: [{ modelId: model.id }] },
          compatibilityRules: {
            create: {
              minBedX: 10,
              minBedY: 10,
              allowedNozzleDiameters: [0.4],
            },
          },
        },
      });

      // barrier must block /printer/print/start across all mocks
      mocks[0].controls.setStartBarrier(100);

      const reqPromise = app.inject({
        method: 'POST',
        url: `/api/presets/${presetId}/print`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          printerIds: printers.map((p: any) => p.id),
        },
      });

      // Give the pipeline time to reach /printer/print/start and block on barrier
      await new Promise((r) => setTimeout(r, 150));

      // With concurrency limit=2, max concurrent start calls should not exceed 2
      expect(shared.stats.maxConcurrentStarts).toBe(2);

      mocks[0].controls.releaseStartBarrier();

      const res = await reqPromise;
      expect(res.statusCode).toBe(200);
    } finally {
      await Promise.all(mocks.map((m) => m.close()));
    }
  });
});
