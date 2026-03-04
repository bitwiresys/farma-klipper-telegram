import type { FastifyInstance } from 'fastify';

import { HistoryStatus, type PrintHistoryDto } from '@farma/shared';

import { prisma } from './prisma.js';
import { env } from './env.js';
import { decryptApiKey } from './crypto_api_key.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { logger } from './logger.js';

function isSafeRelPath(p: string): boolean {
  const s = String(p ?? '').trim();
  if (!s) return false;
  if (s.includes('..')) return false;
  if (s.includes('\\')) return false;
  if (s.startsWith('/')) return false;
  return true;
}

function pickBestHistoryThumbRelativePath(job: any): string | null {
  const thumbs = Array.isArray(job?.metadata?.thumbnails)
    ? (job.metadata.thumbnails as any[])
    : [];

  const pool = thumbs
    .map((t) => {
      const rel =
        typeof t?.relative_path === 'string'
          ? t.relative_path
          : typeof t?.thumbnail_path === 'string'
            ? t.thumbnail_path
            : null;
      if (!rel) return null;
      const width = typeof t?.width === 'number' ? t.width : null;
      const height = typeof t?.height === 'number' ? t.height : null;
      const area =
        width !== null && height !== null ? Math.max(1, width * height) : 1;
      return { rel, area };
    })
    .filter((x): x is { rel: string; area: number } => x !== null)
    .filter((x) => isSafeRelPath(x.rel));

  if (pool.length === 0) return null;
  pool.sort((a, b) => b.area - a.area);
  return pool[0].rel;
}

function normalizeMoonrakerHistoryStatus(raw: string): HistoryStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'completed') return HistoryStatus.completed;
  if (s === 'cancelled') return HistoryStatus.cancelled;
  if (s === 'in_progress') return HistoryStatus.in_progress;
  if (
    s === 'error' ||
    s === 'klippy_shutdown' ||
    s === 'klippy_disconnect' ||
    s === 'interrupted'
  ) {
    return HistoryStatus.error;
  }
  if (s.includes('error') || s.includes('fail')) return HistoryStatus.error;
  if (s.includes('cancel')) return HistoryStatus.cancelled;
  if (s.includes('complete') || s.includes('finished'))
    return HistoryStatus.completed;
  return HistoryStatus.in_progress;
}

export async function registerHistoryRoutes(app: FastifyInstance) {
  app.get('/api/history/thumbnail', async (req, reply) => {
    const q = (req.query ?? {}) as { printerId?: string; path?: string };
    const printerId = String(q.printerId ?? '').trim();
    const rel = String(q.path ?? '').trim();

    if (!printerId || !isSafeRelPath(rel)) {
      return reply.code(400).send({ error: 'BAD_REQUEST' });
    }

    const printer = await prisma.printer.findUnique({
      where: { id: printerId },
      select: { baseUrl: true, apiKeyEncrypted: true },
    });
    if (!printer) return reply.code(404).send({ error: 'NOT_FOUND' });

    const apiKey = decryptApiKey(
      printer.apiKeyEncrypted,
      env.PRINTER_API_KEY_ENC_KEY,
    );
    const http = new MoonrakerHttp({ baseUrl: printer.baseUrl, apiKey });

    const bytes = await http.downloadFile({ root: 'gcodes', filename: rel });

    const lower = rel.toLowerCase();
    const ct =
      lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';

    reply.header('Cache-Control', 'no-store');
    reply.type(ct);
    return reply.send(bytes);
  });

  app.get('/api/history', async (req, reply) => {
    reply.header('X-History-Source', 'moonraker');

    const q = (req.query ?? {}) as {
      status?: string;
      limit?: string;
      offset?: string;
    };
    const statusRaw =
      typeof q.status === 'string' ? q.status.trim().toLowerCase() : 'all';

    const statusFilter: HistoryStatus | null =
      statusRaw === 'completed'
        ? HistoryStatus.completed
        : statusRaw === 'error'
          ? HistoryStatus.error
          : statusRaw === 'cancelled'
            ? HistoryStatus.cancelled
            : statusRaw === 'in_progress'
              ? HistoryStatus.in_progress
              : null;

    const limitReq = Number(q.limit ?? '50');
    const offsetReq = Number(q.offset ?? '0');
    const take = Number.isFinite(limitReq)
      ? Math.min(200, Math.max(1, Math.floor(limitReq)))
      : 50;
    const skip = Number.isFinite(offsetReq)
      ? Math.max(0, Math.floor(offsetReq))
      : 0;

    const printers = await prisma.printer.findMany({
      select: {
        id: true,
        baseUrl: true,
        apiKeyEncrypted: true,
      },
    });

    reply.header('X-History-Printers-Count', String(printers.length));

    if (printers.length === 0) {
      return reply.send({
        history: [],
        warning: 'NO_PRINTERS_CONFIGURED',
      });
    }

    const perPrinterLimit = Math.min(200, take + skip);

    const all: PrintHistoryDto[] = [];
    for (const p of printers) {
      try {
        const apiKey = decryptApiKey(
          p.apiKeyEncrypted,
          env.PRINTER_API_KEY_ENC_KEY,
        );
        const http = new MoonrakerHttp({ baseUrl: p.baseUrl, apiKey });
        const resp = (await http.get<any>(
          `/server/history/list?limit=${perPrinterLimit}&start=0&order=desc`,
          { timeoutMs: 15_000 },
        )) as any;

        const root = resp?.result ?? resp;
        const jobs = Array.isArray(root?.jobs) ? (root.jobs as any[]) : [];
        for (const j of jobs) {
          const startedSec =
            typeof j?.start_time === 'number' ? Math.floor(j.start_time) : null;
          if (startedSec === null) continue;
          const endedSec =
            typeof j?.end_time === 'number' ? Math.floor(j.end_time) : null;

          let status = normalizeMoonrakerHistoryStatus(String(j?.status ?? ''));

          // Moonraker spec: end_time is null when job is in_progress.
          // If end_time is present, it is not in progress.
          if (status === HistoryStatus.in_progress && endedSec !== null) {
            status = HistoryStatus.completed;
          }

          if (statusFilter !== null && status !== statusFilter) continue;

          const filename = String(j?.filename ?? 'unknown');
          const printDurationSec =
            typeof j?.print_duration === 'number'
              ? Math.floor(j.print_duration)
              : null;
          const totalDurationSec =
            typeof j?.total_duration === 'number'
              ? Math.floor(j.total_duration)
              : null;
          const filamentUsedMm =
            typeof j?.filament_used === 'number' ? j.filament_used : null;
          const errorMessage =
            typeof j?.message === 'string' ? j.message : null;

          // Skip bogus placeholder rows.
          if (
            filename === 'unknown' &&
            status === HistoryStatus.in_progress &&
            endedSec === null &&
            printDurationSec === null &&
            totalDurationSec === null &&
            filamentUsedMm === null &&
            errorMessage === null
          ) {
            continue;
          }

          all.push({
            id: `${p.id}:${String(j?.job_id ?? startedSec)}`,
            printerId: p.id,
            filename,
            status,
            thumbnailUrl: (() => {
              const rel = pickBestHistoryThumbRelativePath(j);
              if (!rel) return null;
              const qs = new URLSearchParams({
                printerId: p.id,
                path: rel,
              });
              return `/api/history/thumbnail?${qs.toString()}`;
            })(),
            startedAt: new Date(startedSec * 1000).toISOString(),
            endedAt:
              endedSec === null
                ? null
                : new Date(endedSec * 1000).toISOString(),
            printDurationSec,
            totalDurationSec,
            filamentUsedMm,
            errorMessage,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          { printerId: p.id, err: msg },
          'moonraker history fetch failed',
        );
        continue;
      }
    }

    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const result = all.slice(skip, skip + take);

    reply.header('X-History-Jobs-Total', String(all.length));
    return reply.send({ history: result });
  });
}
