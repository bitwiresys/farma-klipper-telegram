import type { FastifyInstance } from 'fastify';

import { HistoryStatus, type PrintHistoryDto } from '@farma/shared';

import { prisma } from './prisma.js';
import { env } from './env.js';
import { decryptApiKey } from './crypto_api_key.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { logger } from './logger.js';

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

        const jobs = Array.isArray(resp?.jobs) ? (resp.jobs as any[]) : [];
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
    return reply.send({ history: result });
  });
}
