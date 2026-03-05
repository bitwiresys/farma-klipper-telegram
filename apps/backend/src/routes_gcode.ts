import type { FastifyInstance } from 'fastify';

import { prisma } from './prisma.js';
import { env } from './env.js';
import { decryptApiKey } from './crypto_api_key.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { logger } from './logger.js';

function isSafeRelPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  if (p.includes('..')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/i.test(p)) return false;
  return true;
}

export async function registerGcodeRoutes(app: FastifyInstance) {
  // Get gcode file content for 3D viewer
  app.get('/api/gcode/:printerId', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { printerId } = req.params as { printerId: string };
    const query = (req.query ?? {}) as { filename?: string };

    if (!query.filename || !isSafeRelPath(query.filename)) {
      return reply.code(400).send({ error: 'INVALID_FILENAME' });
    }

    const printer = await prisma.printer.findUnique({
      where: { id: printerId },
    });

    if (!printer) {
      return reply.code(404).send({ error: 'PRINTER_NOT_FOUND' });
    }

    const apiKey = decryptApiKey(
      printer.apiKeyEncrypted,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const http = new MoonrakerHttp({ baseUrl: printer.baseUrl, apiKey });

    try {
      const bytes = await http.downloadFile({
        root: 'gcodes',
        filename: query.filename,
      });

      // Return as text for gcode viewer
      const text = bytes.toString('utf-8');
      return reply.type('text/plain').send(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        { printerId, filename: query.filename, err: msg },
        'gcode fetch failed',
      );
      return reply.code(502).send({ error: 'MOONRAKER_ERROR', message: msg });
    }
  });

  // Get gcode metadata (layer info, dimensions, etc.)
  app.get('/api/gcode/:printerId/metadata', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { printerId } = req.params as { printerId: string };
    const query = (req.query ?? {}) as { filename?: string };

    if (!query.filename || !isSafeRelPath(query.filename)) {
      return reply.code(400).send({ error: 'INVALID_FILENAME' });
    }

    const printer = await prisma.printer.findUnique({
      where: { id: printerId },
    });

    if (!printer) {
      return reply.code(404).send({ error: 'PRINTER_NOT_FOUND' });
    }

    const apiKey = decryptApiKey(
      printer.apiKeyEncrypted,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const http = new MoonrakerHttp({ baseUrl: printer.baseUrl, apiKey });

    try {
      const meta = await http.get<any>(
        `/server/files/metadata?filename=${encodeURIComponent(query.filename)}`,
        { timeoutMs: 10_000 },
      );

      return reply.send(meta);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        { printerId, filename: query.filename, err: msg },
        'gcode metadata fetch failed',
      );
      return reply.code(502).send({ error: 'MOONRAKER_ERROR', message: msg });
    }
  });
}
