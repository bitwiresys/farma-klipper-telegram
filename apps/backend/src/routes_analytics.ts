import type { FastifyInstance } from 'fastify';

import { prisma } from './prisma.js';

type FilamentStats = {
  totalMm: number;
  byPlasticType: Record<string, number>;
  byPrinter: Record<string, { name: string; mm: number }>;
};

type PrintStats = {
  total: number;
  completed: number;
  error: number;
  cancelled: number;
  successRate: number;
  avgDurationSec: number | null;
};

type TimeSeriesPoint = {
  date: string;
  count: number;
  filamentMm: number;
};

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  // Get filament usage statistics
  app.get('/api/analytics/filament', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    // Get all history with filament data
    const history = await prisma.printHistory.findMany({
      where: {
        filamentUsedMm: { not: null },
      },
      include: {
        printer: {
          select: { id: true, displayName: true },
        },
      },
    });

    // Get preset info for plastic types
    const deployments = await prisma.presetDeployment.findMany({
      include: {
        preset: {
          select: { id: true, plasticType: true },
        },
      },
    });

    // Build deployment to preset mapping
    const deploymentPreset = new Map<string, string>();
    const presetPlastic = new Map<string, string>();
    for (const d of deployments) {
      deploymentPreset.set(`${d.presetId}:${d.printerId}`, d.presetId);
      presetPlastic.set(d.presetId, d.preset.plasticType);
    }

    const stats: FilamentStats = {
      totalMm: 0,
      byPlasticType: {},
      byPrinter: {},
    };

    for (const h of history) {
      const mm = h.filamentUsedMm ?? 0;
      stats.totalMm += mm;

      // By printer
      if (!stats.byPrinter[h.printerId]) {
        stats.byPrinter[h.printerId] = {
          name: h.printer?.displayName ?? h.printerId,
          mm: 0,
        };
      }
      stats.byPrinter[h.printerId]!.mm += mm;

      // Try to get plastic type from preset (approximate)
      // This is best-effort since we don't have direct history->preset link
      const plasticKey = 'unknown';
      if (!stats.byPlasticType[plasticKey]) {
        stats.byPlasticType[plasticKey] = 0;
      }
      stats.byPlasticType[plasticKey] += mm;
    }

    return reply.send({
      totalMm: stats.totalMm,
      totalMeters: stats.totalMm / 1000,
      byPlasticType: stats.byPlasticType,
      byPrinter: Object.values(stats.byPrinter).sort((a, b) => b.mm - a.mm),
    });
  });

  // Get print success statistics
  app.get('/api/analytics/prints', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const history = await prisma.printHistory.findMany({
      select: {
        status: true,
        printDurationSec: true,
      },
    });

    const stats: PrintStats = {
      total: history.length,
      completed: 0,
      error: 0,
      cancelled: 0,
      successRate: 0,
      avgDurationSec: null,
    };

    let totalDuration = 0;
    let durationCount = 0;

    for (const h of history) {
      if (h.status === 'complete' || h.status === 'completed') {
        stats.completed++;
      } else if (h.status === 'error') {
        stats.error++;
      } else if (h.status === 'cancelled' || h.status === 'canceled') {
        stats.cancelled++;
      }

      if (h.printDurationSec) {
        totalDuration += h.printDurationSec;
        durationCount++;
      }
    }

    stats.successRate =
      stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    stats.avgDurationSec =
      durationCount > 0 ? Math.round(totalDuration / durationCount) : null;

    return reply.send(stats);
  });

  // Get time series data (prints per day)
  app.get('/api/analytics/timeseries', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const days = parseInt((req.query as any)?.days ?? '30', 10);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const history = await prisma.printHistory.findMany({
      where: {
        startedAt: { gte: since },
      },
      select: {
        startedAt: true,
        filamentUsedMm: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    // Group by date
    const byDate = new Map<string, { count: number; filamentMm: number }>();

    for (const h of history) {
      const date = h.startedAt.toISOString().split('T')[0]!;
      if (!byDate.has(date)) {
        byDate.set(date, { count: 0, filamentMm: 0 });
      }
      const entry = byDate.get(date)!;
      entry.count++;
      entry.filamentMm += h.filamentUsedMm ?? 0;
    }

    // Fill in missing dates
    const result: TimeSeriesPoint[] = [];
    const cursor = new Date(since);
    while (cursor <= new Date()) {
      const dateStr = cursor.toISOString().split('T')[0]!;
      const entry = byDate.get(dateStr) ?? { count: 0, filamentMm: 0 };
      result.push({
        date: dateStr,
        count: entry.count,
        filamentMm: entry.filamentMm,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return reply.send({
      days,
      data: result,
    });
  });

  // Get printer uptime statistics
  app.get('/api/analytics/uptime', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const history = await prisma.printHistory.findMany({
      where: {
        printDurationSec: { not: null },
      },
      include: {
        printer: {
          select: { id: true, displayName: true },
        },
      },
    });

    const byPrinter = new Map<
      string,
      { name: string; totalSec: number; printCount: number }
    >();

    for (const h of history) {
      if (!byPrinter.has(h.printerId)) {
        byPrinter.set(h.printerId, {
          name: h.printer?.displayName ?? h.printerId,
          totalSec: 0,
          printCount: 0,
        });
      }
      const entry = byPrinter.get(h.printerId)!;
      entry.totalSec += h.printDurationSec ?? 0;
      entry.printCount++;
    }

    const result = Array.from(byPrinter.values())
      .map((p) => ({
        name: p.name,
        totalHours: Math.round((p.totalSec / 3600) * 10) / 10,
        printCount: p.printCount,
        avgPrintHours:
          p.printCount > 0
            ? Math.round((p.totalSec / p.printCount / 3600) * 10) / 10
            : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    return reply.send({ printers: result });
  });
}
