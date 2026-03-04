import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

import {
  HistoryStatus,
  type WsClientMessage,
  type WsEvent,
} from '@farma/shared';
import {
  WsClientMessageSchema,
  type PrintHistoryDto,
  type PresetDto,
} from '@farma/shared';
import type WebSocket from 'ws';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { decryptApiKey } from './crypto_api_key.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { printerRuntime } from './printer_runtime.js';

type Client = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

type ClientWithWs = Client & {
  ws: WebSocket;
};

function presetToDto(p: any): PresetDto {
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

function toHistoryDto(row: any): PrintHistoryDto {
  return {
    id: row.id,
    printerId: row.printerId,
    filename: row.filename,
    status: String(row.status ?? 'in_progress') as any satisfies HistoryStatus,
    thumbnailUrl: null,
    startedAt: new Date(row.startedAt).toISOString(),
    endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
    printDurationSec:
      typeof row.printDurationSec === 'number' ? row.printDurationSec : null,
    totalDurationSec:
      typeof row.totalDurationSec === 'number' ? row.totalDurationSec : null,
    filamentUsedMm:
      typeof row.filamentUsedMm === 'number' ? row.filamentUsedMm : null,
    errorMessage: row.errorMessage ?? null,
  };
}

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

async function fetchHistoryFromMoonraker(opts: {
  status: string;
  take: number;
  skip: number;
}): Promise<{ history: PrintHistoryDto[]; total: number }> {
  const printers = await prisma.printer.findMany({
    select: { id: true, baseUrl: true, apiKeyEncrypted: true },
  });

  const statusRaw = String(opts.status ?? 'all')
    .trim()
    .toLowerCase();
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

  const perPrinterLimit = Math.min(200, opts.take + opts.skip);

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
        const errorMessage = typeof j?.message === 'string' ? j.message : null;

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
            const qs = new URLSearchParams({ printerId: p.id, path: rel });
            return `/api/history/thumbnail?${qs.toString()}`;
          })(),
          startedAt: new Date(startedSec * 1000).toISOString(),
          endedAt:
            endedSec === null ? null : new Date(endedSec * 1000).toISOString(),
          printDurationSec,
          totalDurationSec,
          filamentUsedMm,
          errorMessage,
        });
      }
    } catch {
      continue;
    }
  }

  all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const history = all.slice(opts.skip, opts.skip + opts.take);
  return { history, total: all.length };
}

export class WsHub {
  private clients = new Set<Client>();
  private dirty = new Set<string>();

  constructor() {
    setInterval(() => {
      void this.flush();
    }, env.WS_BATCH_INTERVAL_MS);
  }

  markPrinterDirty(printerId: string) {
    this.dirty.add(printerId);
  }

  async addClient(client: Client, token: string) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
      const sub = (payload as any)?.sub;
      if (typeof sub !== 'string' || !sub)
        throw new Error('Invalid token subject');
      const user = await prisma.user.findUnique({ where: { telegramId: sub } });
      if (!user || !user.isAllowed) throw new Error('User not allowed');

      this.clients.add(client);

      const printers = await prisma.printer.findMany({
        include: { model: true },
      });
      const ev: WsEvent = {
        type: 'PRINTERS_SNAPSHOT',
        payload: {
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
        },
      };
      client.send(JSON.stringify(ev));

      const models = await prisma.printerModel.findMany({
        orderBy: { name: 'asc' },
      });
      client.send(
        JSON.stringify({
          type: 'PRINTER_MODELS_SNAPSHOT',
          payload: { requestId: 'init', models },
        }),
      );

      const presets = await prisma.preset.findMany({
        orderBy: { createdAt: 'desc' },
        include: { allowedModels: true, compatibilityRules: true },
      });
      client.send(
        JSON.stringify({
          type: 'PRESETS_SNAPSHOT',
          payload: { requestId: 'init', presets: presets.map(presetToDto) },
        }),
      );

      const take = 50;
      let historyRows: PrintHistoryDto[] = [];
      let total = 0;
      try {
        const resp = await fetchHistoryFromMoonraker({
          status: 'all',
          take,
          skip: 0,
        });
        historyRows = resp.history;
        total = resp.total;
      } catch {
        const rows = await prisma.printHistory.findMany({
          orderBy: { startedAt: 'desc' },
          take,
          skip: 0,
        });
        total = await prisma.printHistory.count();
        historyRows = rows.map(toHistoryDto);
      }
      client.send(
        JSON.stringify({
          type: 'HISTORY_SNAPSHOT',
          payload: {
            requestId: 'init',
            query: { status: 'all', limit: take, offset: 0 },
            history: historyRows,
            total,
          },
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      client.close(1008, msg);
    }
  }

  async handleClientMessage(client: Client, msg: WsClientMessage) {
    if (msg.type === 'REQ_PRINTER_MODELS') {
      const models = await prisma.printerModel.findMany({
        orderBy: { name: 'asc' },
      });
      client.send(
        JSON.stringify({
          type: 'PRINTER_MODELS_SNAPSHOT',
          payload: { requestId: msg.payload.requestId, models },
        }),
      );
      return;
    }

    if (msg.type === 'REQ_PRESETS') {
      const presets = await prisma.preset.findMany({
        orderBy: { createdAt: 'desc' },
        include: { allowedModels: true, compatibilityRules: true },
      });
      client.send(
        JSON.stringify({
          type: 'PRESETS_SNAPSHOT',
          payload: {
            requestId: msg.payload.requestId,
            presets: presets.map(presetToDto),
          },
        }),
      );
      return;
    }

    if (msg.type === 'REQ_HISTORY') {
      const status = msg.payload.status;
      const take = Math.min(200, Math.max(1, Math.floor(msg.payload.limit)));
      const skip = Math.max(0, Math.floor(msg.payload.offset));
      let rows: PrintHistoryDto[] = [];
      let total = 0;
      try {
        const resp = await fetchHistoryFromMoonraker({ status, take, skip });
        rows = resp.history;
        total = resp.total;
      } catch {
        const where =
          status === 'all'
            ? {}
            : {
                status,
              };
        const [dbRows, dbTotal] = await Promise.all([
          prisma.printHistory.findMany({
            where,
            orderBy: { startedAt: 'desc' },
            take,
            skip,
          }),
          prisma.printHistory.count({ where }),
        ]);
        rows = dbRows.map(toHistoryDto);
        total = dbTotal;
      }

      client.send(
        JSON.stringify({
          type: 'HISTORY_SNAPSHOT',
          payload: {
            requestId: msg.payload.requestId,
            query: { status, limit: take, offset: skip },
            history: rows,
            total,
          },
        }),
      );
      return;
    }
  }

  removeClient(client: Client) {
    this.clients.delete(client);
  }

  broadcast(ev: WsEvent) {
    const data = JSON.stringify(ev);
    for (const c of this.clients) {
      try {
        c.send(data);
      } catch {
        // ignore
      }
    }
  }

  private async flush() {
    if (this.clients.size === 0) {
      this.dirty.clear();
      return;
    }

    if (this.dirty.size === 0) return;

    const printerIds = [...this.dirty];
    this.dirty.clear();

    const printers = await prisma.printer.findMany({
      where: { id: { in: printerIds } },
      include: { model: true },
    });

    for (const p of printers) {
      const ev: WsEvent = {
        type: 'PRINTER_STATUS',
        payload: {
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
        },
      };
      this.broadcast(ev);
    }
  }
}

export const wsHub = new WsHub();

export async function registerWsHub(app: FastifyInstance) {
  printerRuntime.setOnPrinterSnapshot((printerId) => {
    wsHub.markPrinterDirty(printerId);
  });

  printerRuntime.setOnHistoryEvent((printerId, history) => {
    wsHub.broadcast({
      type: 'HISTORY_EVENT',
      payload: {
        printerId,
        history,
      },
    });
  });

  const handler = async (socket: WebSocket, req: any) => {
    const qs = (req.url ?? '').includes('?')
      ? (req.url ?? '').slice((req.url ?? '').indexOf('?') + 1)
      : '';
    const token = new URLSearchParams(qs).get('token') ?? '';

    const client: ClientWithWs = {
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
      ws: socket,
    };

    await wsHub.addClient(client, token);

    socket.on('message', (data) => {
      try {
        const parsed = JSON.parse(String(data));
        const v = WsClientMessageSchema.safeParse(parsed);
        if (!v.success) return;
        void wsHub.handleClientMessage(client, v.data as any);
      } catch {
        return;
      }
    });

    socket.on('close', () => {
      wsHub.removeClient(client);
    });
  };

  app.get('/api/ws', { websocket: true }, handler);
  app.get('/ws', { websocket: true }, handler);
}
