import {
  HistoryStatus,
  PrinterState,
  type PrintHistoryDto,
  type PrinterSnapshotDto,
} from '@farma/shared';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { decryptApiKey, encryptApiKey } from './crypto_api_key.js';
import { logger } from './logger.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { MoonrakerWsConnector } from './moonraker_ws_connector.js';
import { SnapshotCache } from './snapshot_cache.js';

type RawStatus = Record<string, unknown>;

type GcodeMeta = {
  estimatedTimeSec: number | null;
  firstLayerHeight: number | null;
  layerHeight: number | null;
  objectHeight: number | null;
};

function deepMerge(target: unknown, patch: unknown): unknown {
  if (patch === null || patch === undefined) return target;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;

  const p = patch as Record<string, unknown>;

  if (
    target === null ||
    target === undefined ||
    typeof target !== 'object' ||
    Array.isArray(target)
  ) {
    const copy: Record<string, unknown> = {};
    for (const k of Object.keys(p)) copy[k] = deepMerge(undefined, p[k]);
    return copy;
  }

  const t = target as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    t[k] = deepMerge(t[k], p[k]);
  }
  return t;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function numOrNull(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x;
}

function strOrNull(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  return x;
}

function arrNumAtOrNull(x: unknown, idx: number): number | null {
  if (!Array.isArray(x)) return null;
  const v = x[idx];
  return numOrNull(v);
}

function parseMeshMaxToBedXY(meshMax: unknown): {
  bedX: number | null;
  bedY: number | null;
} {
  if (Array.isArray(meshMax) && meshMax.length >= 2) {
    const x = numOrNull(meshMax[0]);
    const y = numOrNull(meshMax[1]);
    return {
      bedX: x !== null && Number.isFinite(x) ? x : null,
      bedY: y !== null && Number.isFinite(y) ? y : null,
    };
  }
  if (typeof meshMax === 'string') {
    const parts = meshMax
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      return {
        bedX: Number.isFinite(x) ? x : null,
        bedY: Number.isFinite(y) ? y : null,
      };
    }
  }
  return { bedX: null, bedY: null };
}

function normalizePrinterState(raw: string | null): PrinterState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'printing') return PrinterState.printing;
  if (s === 'paused') return PrinterState.paused;
  if (s === 'error') return PrinterState.error;

  // Klipper/Moonraker often report terminal or transitional states here.
  // Treat completion-like states as READY/standby (not offline).
  if (
    s === 'complete' ||
    s === 'completed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'canceling' ||
    s === 'cancelled' ||
    s === 'standby'
  ) {
    return PrinterState.standby;
  }

  // Klippy shutdown/disconnect should be considered an error state.
  if (s.includes('shutdown') || s.includes('disconnect')) {
    return PrinterState.error;
  }

  if (s === 'standby' || s === 'ready' || s === 'idle')
    return PrinterState.standby;

  // If we have some state string but don't recognize it, do not mark offline.
  // Offline should represent connectivity loss, not an unknown print_stats.state.
  if (s) return PrinterState.standby;
  return PrinterState.offline;
}

function normalizeHistoryStatus(raw: string): HistoryStatus {
  const s = raw.toLowerCase();
  if (s.includes('error') || s.includes('fail')) return HistoryStatus.error;
  if (s.includes('cancel')) return HistoryStatus.cancelled;
  if (s.includes('complete') || s.includes('finished'))
    return HistoryStatus.completed;
  return HistoryStatus.in_progress;
}

function computeSnapshotFromStatus(raw: RawStatus): {
  snapshot: PrinterSnapshotDto;
  printDurationSec: number | null;
} {
  const ps = (raw.print_stats ?? {}) as Record<string, unknown>;
  const vsd = (raw.virtual_sdcard ?? {}) as Record<string, unknown>;
  const ds = (raw.display_status ?? {}) as Record<string, unknown>;
  const webhooks = (raw.webhooks ?? {}) as Record<string, unknown>;
  const ext = (raw.extruder ?? {}) as Record<string, unknown>;
  const bed = (raw.heater_bed ?? {}) as Record<string, unknown>;
  const th = (raw.toolhead ?? {}) as Record<string, unknown>;
  const gm = (raw.gcode_move ?? {}) as Record<string, unknown>;
  const mr = (raw.motion_report ?? {}) as Record<string, unknown>;
  const fan = (raw.fan ?? {}) as Record<string, unknown>;

  let state = normalizePrinterState(strOrNull(ps.state));

  const klippyState = strOrNull((webhooks as any).state);
  const klippyMsg = strOrNull((webhooks as any).state_message);
  if (klippyState) {
    const wh = normalizePrinterState(klippyState);
    if (wh === PrinterState.error || wh === PrinterState.offline) {
      state = PrinterState.error;
    }
  }

  const filename = strOrNull(ps.filename) ?? strOrNull(vsd.filename);

  const p1 = numOrNull(ds.progress);
  const p2 = numOrNull(vsd.progress);
  const progress = p1 !== null ? clamp01(p1) : p2 !== null ? clamp01(p2) : null;

  const printDurationSec = numOrNull(ps.print_duration);

  const temps = {
    extruder: numOrNull(ext.temperature),
    bed: numOrNull(bed.temperature),
    extruderTarget: numOrNull((ext as any).target),
    bedTarget: numOrNull((bed as any).target),
  };

  const layers = {
    current: null as number | null,
    total: null as number | null,
  };

  if (state === PrinterState.printing || state === PrinterState.paused) {
    const c = numOrNull((ps as any)?.info?.current_layer);
    const t = numOrNull((ps as any)?.info?.total_layer);
    if (c !== null && t !== null && t > 1 && c >= 0 && c <= t) {
      layers.current = c;
      layers.total = t;
    }
  }

  const commanded = {
    x: arrNumAtOrNull(th.position, 0),
    y: arrNumAtOrNull(th.position, 1),
    z: arrNumAtOrNull(th.position, 2),
    e: arrNumAtOrNull(th.position, 3),
  };

  const live = {
    x: arrNumAtOrNull(mr.live_position, 0),
    y: arrNumAtOrNull(mr.live_position, 1),
    z: arrNumAtOrNull(mr.live_position, 2),
    e: arrNumAtOrNull(mr.live_position, 3),
  };

  const gcode = {
    x: arrNumAtOrNull(gm.gcode_position, 0),
    y: arrNumAtOrNull(gm.gcode_position, 1),
    z: arrNumAtOrNull(gm.gcode_position, 2),
    e: arrNumAtOrNull(gm.gcode_position, 3),
  };

  const liveVelocityMmS = numOrNull(mr.live_velocity);
  const liveExtruderVelocityMmS = numOrNull((mr as any).live_extruder_velocity);
  const gcodeSpeedMmS = numOrNull(gm.speed);
  const speedFactor = numOrNull(gm.speed_factor);
  const flowFactor = numOrNull(gm.extrude_factor);

  const fanSpeed = numOrNull(fan.speed);
  const fanRpm = numOrNull((fan as any).rpm);

  let chamberTemp: number | null = null;
  try {
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k).toLowerCase();
      if (!key.startsWith('temperature_sensor') && !key.includes('chamber'))
        continue;
      if (!v || typeof v !== 'object') continue;
      const t = numOrNull((v as any).temperature);
      if (t !== null) {
        chamberTemp = t;
        break;
      }
    }
  } catch {
    // ignore
  }

  const limits = {
    maxVelocity: numOrNull((th as any).max_velocity),
    maxAccel: numOrNull((th as any).max_accel),
  };

  const messageFromPs = strOrNull((ps as any).message);
  const message =
    messageFromPs ?? (state === PrinterState.error ? klippyMsg : null) ?? null;

  return {
    snapshot: {
      state,
      filename,
      progress,
      etaSec: null,
      message,
      temps,
      layers,
      position: {
        commanded,
        live,
        gcode,
      },
      speed: {
        liveVelocityMmS,
        liveExtruderVelocityMmS,
        gcodeSpeedMmS,
        speedFactor,
        flowFactor,
      },
      fans: {
        part: {
          speed: fanSpeed,
          rpm: fanRpm,
        },
      },
      chamberTemp,
      limits,
    },
    printDurationSec,
  };
}

export function __computeSnapshotFromStatusForTest(raw: RawStatus) {
  return computeSnapshotFromStatus(raw);
}

export class PrinterRuntimeManager {
  private cache = new SnapshotCache();
  private rawStatus = new Map<string, RawStatus>();
  private connectors = new Map<string, MoonrakerWsConnector>();

  private metaByPrinter = new Map<
    string,
    { filename: string; meta: GcodeMeta }
  >();
  private metaFetchInFlight = new Set<string>();
  private specsFetchInFlight = new Set<string>();

  private sessionCache = new Map<
    string,
    {
      printSessionId: string | null;
      filename: string | null;
      startTimeSec: number | null;
    }
  >();

  // batching to WS hub
  private dirtyPrinters = new Set<string>();
  private onPrinterSnapshot?: (printerId: string) => void;
  private onHistoryEvent?: (
    printerId: string,
    history: PrintHistoryDto,
  ) => void;

  private onRawStatus?: (printerId: string, rawStatus: RawStatus) => void;
  private onGcodeLine?: (printerId: string, line: string) => void;

  setOnPrinterSnapshot(cb: (printerId: string) => void) {
    this.onPrinterSnapshot = cb;
  }

  setOnHistoryEvent(cb: (printerId: string, history: PrintHistoryDto) => void) {
    this.onHistoryEvent = cb;
  }

  setOnRawStatusUpdate(cb: (printerId: string, rawStatus: RawStatus) => void) {
    this.onRawStatus = cb;
  }

  setOnGcodeResponse(cb: (printerId: string, line: string) => void) {
    this.onGcodeLine = cb;
  }

  async getOrCreatePrintSessionId(
    printerId: string,
    input: { filename: string | null; state: PrinterState },
  ): Promise<string | null> {
    const cached = this.sessionCache.get(printerId);
    if (cached?.printSessionId) return cached.printSessionId;

    const p = await prisma.printer.findUnique({ where: { id: printerId } });
    const existing = p?.currentPrintSessionId ?? null;
    if (existing) {
      this.sessionCache.set(printerId, {
        printSessionId: existing,
        filename: p?.currentFilename ?? null,
        startTimeSec: p?.currentStartTimeSec ?? null,
      });
      return existing;
    }

    if (input.state !== PrinterState.printing) return null;
    const filename = input.filename;
    if (!filename) return null;

    const startTimeSec = Math.floor(Date.now() / 1000);
    const printSessionId = `${printerId}:${filename}:${startTimeSec}`;
    await prisma.printer.update({
      where: { id: printerId },
      data: {
        currentPrintSessionId: printSessionId,
        currentFilename: filename,
        currentStartTimeSec: startTimeSec,
      },
    });
    this.sessionCache.set(printerId, {
      printSessionId,
      filename,
      startTimeSec,
    });
    return printSessionId;
  }

  async clearPrintSession(printerId: string) {
    await prisma.printer.update({
      where: { id: printerId },
      data: {
        currentPrintSessionId: null,
        currentFilename: null,
        currentStartTimeSec: null,
      },
    });
    this.sessionCache.set(printerId, {
      printSessionId: null,
      filename: null,
      startTimeSec: null,
    });
  }

  markDirty(printerId: string) {
    this.dirtyPrinters.add(printerId);
    this.onPrinterSnapshot?.(printerId);
  }

  getSnapshot(printerId: string): PrinterSnapshotDto {
    return this.cache.get(printerId).snapshot;
  }

  async initFromDb() {
    const printers = await prisma.printer.findMany();
    for (const p of printers) {
      this.cache.get(p.id);
      await this.ensureConnector(p.id);
    }
  }

  async backfillHistoryForPrinter(
    printerId: string,
    opts?: { limit?: number },
  ) {
    const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit ?? 50)));

    let baseUrl: string;
    let apiKey: string;
    try {
      const s = await this.getPrinterSecrets(printerId);
      baseUrl = s.baseUrl;
      apiKey = s.apiKey;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'PRINTER_NEEDS_REKEY') return;
      throw e;
    }

    const http = new MoonrakerHttp({ baseUrl, apiKey });
    const res = await http.get<any>(`/server/history/list?limit=${limit}`);
    const jobs: any[] = Array.isArray(res?.result?.jobs)
      ? res.result.jobs
      : Array.isArray(res?.jobs)
        ? res.jobs
        : [];

    for (const j of jobs) {
      const filename = strOrNull(j?.filename) ?? 'unknown';
      const status = normalizeHistoryStatus(String(j?.status ?? 'changed'));
      const startTimeSec = numOrNull(j?.start_time);
      const endTimeSec = numOrNull(j?.end_time);

      const startedAt = startTimeSec
        ? new Date(Math.floor(startTimeSec) * 1000)
        : new Date();
      const endedAt = endTimeSec
        ? new Date(Math.floor(endTimeSec) * 1000)
        : status === HistoryStatus.in_progress
          ? null
          : new Date();

      const printDurationSec = numOrNull(j?.print_duration);
      const totalDurationSec = numOrNull(j?.total_duration);
      const filamentUsedMm = numOrNull(j?.filament_used);
      const errorMessage = strOrNull(j?.message) ?? strOrNull(j?.error) ?? null;

      const computedSessionId = startTimeSec
        ? `${printerId}:${filename}:${Math.floor(startTimeSec)}`
        : null;

      const existing = computedSessionId
        ? await prisma.printHistory.findFirst({
            where: { printerId, printSessionId: computedSessionId },
          })
        : await prisma.printHistory.findFirst({
            where: { printerId, filename, startedAt },
          });

      if (existing) {
        await prisma.printHistory.update({
          where: { id: existing.id },
          data: {
            filename,
            status,
            startedAt,
            endedAt,
            printDurationSec,
            totalDurationSec,
            filamentUsedMm,
            errorMessage,
            printSessionId: computedSessionId ?? existing.printSessionId,
          },
        });
      } else {
        await prisma.printHistory.create({
          data: {
            printerId,
            printSessionId: computedSessionId,
            filename,
            status,
            startedAt,
            endedAt,
            printDurationSec,
            totalDurationSec,
            filamentUsedMm,
            errorMessage,
          },
        });
      }
    }
  }

  async backfillHistoryForAllPrinters(opts?: { limit?: number }) {
    const printers = await prisma.printer.findMany({ select: { id: true } });
    for (const p of printers) {
      try {
        await this.backfillHistoryForPrinter(p.id, opts);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ printerId: p.id, err: msg }, 'history backfill failed');
      }
    }
  }

  private async getPrinterSecrets(printerId: string) {
    const p = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!p) throw new Error('Printer not found');
    try {
      const apiKey = decryptApiKey(
        p.apiKeyEncrypted,
        env.PRINTER_API_KEY_ENC_KEY,
      );
      if (!apiKey.trim()) throw new Error('Empty api key');

      if (p.needsRekey) {
        await prisma.printer.update({
          where: { id: printerId },
          data: { needsRekey: false },
        });
      }

      return { baseUrl: p.baseUrl, apiKey };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        { printerId, err: msg },
        'failed to decrypt printer api key; marking needsRekey and skipping connect',
      );
      if (!p.needsRekey) {
        await prisma.printer.update({
          where: { id: printerId },
          data: { needsRekey: true },
        });
      }
      throw new Error('PRINTER_NEEDS_REKEY');
    }
  }

  async ensureConnector(printerId: string) {
    if (this.connectors.has(printerId)) return;

    let baseUrl: string;
    let apiKey: string;
    try {
      const s = await this.getPrinterSecrets(printerId);
      baseUrl = s.baseUrl;
      apiKey = s.apiKey;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'PRINTER_NEEDS_REKEY') {
        // skip connecting
        return;
      }
      throw e;
    }

    const connector = new MoonrakerWsConnector({
      printerId,
      baseUrl,
      apiKey,
      callbacks: {
        onStatusUpdate: (diff) => {
          const current = this.rawStatus.get(printerId) ?? {};
          const merged = deepMerge(current, diff) as RawStatus;
          this.rawStatus.set(printerId, merged);

          const { snapshot, printDurationSec } =
            computeSnapshotFromStatus(merged);
          const internal = this.cache.get(printerId);

          const now = Date.now();

          const progress = snapshot.progress;
          const activeFilename = snapshot.filename;

          if (
            activeFilename &&
            (snapshot.state === PrinterState.printing ||
              snapshot.state === PrinterState.paused)
          ) {
            const cachedMeta = this.metaByPrinter.get(printerId);
            if (cachedMeta?.filename !== activeFilename) {
              this.metaByPrinter.delete(printerId);
            }
            if (!this.metaFetchInFlight.has(printerId)) {
              this.metaFetchInFlight.add(printerId);
              void (async () => {
                try {
                  const http = new MoonrakerHttp({ baseUrl, apiKey });
                  const metaRaw = await http.get<any>(
                    `/server/files/metadata?filename=${encodeURIComponent(
                      activeFilename,
                    )}`,
                  );
                  const metaObj = (metaRaw as any)?.result ?? metaRaw;
                  const est = numOrNull((metaObj as any)?.estimated_time);
                  const firstLayerHeight = numOrNull(
                    (metaObj as any)?.first_layer_height,
                  );
                  const layerHeight = numOrNull((metaObj as any)?.layer_height);
                  const objectHeight = numOrNull(
                    (metaObj as any)?.object_height,
                  );
                  this.metaByPrinter.set(printerId, {
                    filename: activeFilename,
                    meta: {
                      estimatedTimeSec: est,
                      firstLayerHeight,
                      layerHeight,
                      objectHeight,
                    },
                  });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  logger.warn(
                    { printerId, err: msg },
                    'failed to fetch gcode metadata',
                  );
                } finally {
                  this.metaFetchInFlight.delete(printerId);
                }
              })();
            }
          }

          // ETA prefers slicer metadata estimated_time
          let etaSec: number | null = null;
          const meta = this.metaByPrinter.get(printerId);
          const totalFromMeta =
            meta?.filename === activeFilename
              ? meta.meta.estimatedTimeSec
              : null;

          if (progress !== null && progress > 0 && totalFromMeta !== null) {
            const rawEta = Math.max(
              0,
              Math.round(totalFromMeta * (1 - progress)),
            );
            const minInterval = 12_000;
            if (now - internal.lastEtaUpdateAtMs >= minInterval) {
              const prev = internal.etaSecSmoothed;
              const alpha = 0.25;
              etaSec =
                prev === null
                  ? rawEta
                  : Math.round(prev * (1 - alpha) + rawEta * alpha);
              internal.etaSecSmoothed = etaSec;
              internal.lastEtaUpdateAtMs = now;
            } else {
              etaSec = internal.etaSecSmoothed;
            }
          }

          // Layers: mimic Fluidd formula (derived from current_file metadata + gcode Z)
          let nextLayers = snapshot.layers;
          if (
            (snapshot.state === PrinterState.printing ||
              snapshot.state === PrinterState.paused) &&
            meta?.filename === activeFilename
          ) {
            const h = meta.meta.objectHeight;
            const flh = meta.meta.firstLayerHeight;
            const lh = meta.meta.layerHeight;
            const z = snapshot.position?.gcode?.z ?? null;

            if (
              h !== null &&
              flh !== null &&
              lh !== null &&
              lh > 0 &&
              h > 0 &&
              z !== null
            ) {
              const layers = Math.ceil((h - flh) / lh + 1) || 0;
              const current = Math.ceil((z - flh) / lh + 1) || 0;

              if (layers > 0 && current > 0 && current <= layers) {
                nextLayers = { current, total: layers };
              } else {
                nextLayers = { current: null, total: null };
              }
            }
          }

          internal.snapshot = { ...snapshot, etaSec, layers: nextLayers };
          internal.updatedAtMs = now;

          this.markDirty(printerId);

          this.onRawStatus?.(printerId, merged);
        },
        onHistoryChanged: async (payload) => {
          const now = new Date();
          const action = String((payload as any)?.action ?? '').toLowerCase();
          const filename = String(
            (payload as any)?.filename ??
              (payload as any)?.job?.filename ??
              'unknown',
          );
          const rawStatus = String(
            (payload as any)?.status ?? (payload as any)?.action ?? 'changed',
          );
          const status = normalizeHistoryStatus(rawStatus);
          const printSessionIdRaw =
            String((payload as any)?.uid ?? (payload as any)?.job_id ?? '') ||
            null;

          const currentFromCache =
            this.sessionCache.get(printerId)?.printSessionId ?? null;
          const currentFromDb =
            (await prisma.printer.findUnique({ where: { id: printerId } }))
              ?.currentPrintSessionId ?? null;

          let printSessionId: string | null =
            currentFromCache ?? currentFromDb ?? printSessionIdRaw;

          if (action === 'added') {
            const startTimeSecRaw =
              numOrNull((payload as any)?.job?.start_time) ??
              numOrNull((payload as any)?.start_time);
            const startTimeSec =
              startTimeSecRaw === null
                ? Math.floor(Date.now() / 1000)
                : Math.floor(startTimeSecRaw);
            const computed = `${printerId}:${filename}:${startTimeSec}`;
            await prisma.printer.update({
              where: { id: printerId },
              data: {
                currentPrintSessionId: computed,
                currentFilename: filename,
                currentStartTimeSec: startTimeSec,
              },
            });
            this.sessionCache.set(printerId, {
              printSessionId: computed,
              filename,
              startTimeSec,
            });

            printSessionId = computed;
          }

          const job = (payload as any)?.job ?? null;
          const startTimeSec = numOrNull(job?.start_time);
          const endTimeSec = numOrNull(job?.end_time);
          const printDurationSec = numOrNull(job?.print_duration);
          const totalDurationSec = numOrNull(job?.total_duration);
          const filamentUsedMm = numOrNull(job?.filament_used);
          const errorMessage =
            strOrNull(job?.message) ?? strOrNull(job?.error) ?? null;

          const startedAt = startTimeSec
            ? new Date(Math.floor(startTimeSec) * 1000)
            : now;
          const endedAt = endTimeSec
            ? new Date(Math.floor(endTimeSec) * 1000)
            : status === HistoryStatus.in_progress
              ? null
              : now;

          // Do not persist print history locally.
          // History must be fetched live from each printer's Moonraker.
          this.onHistoryEvent?.(printerId, {
            id: `${printerId}:${printSessionId ?? printSessionIdRaw ?? filename}:${startedAt.getTime()}`,
            printerId,
            filename,
            status,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt ? endedAt.toISOString() : null,
            printDurationSec,
            totalDurationSec,
            filamentUsedMm,
            errorMessage,
          });

          if (
            status === HistoryStatus.completed ||
            status === HistoryStatus.error ||
            status === HistoryStatus.cancelled
          ) {
            await this.clearPrintSession(printerId);
          }
        },
        onGcodeResponse: (line) => {
          this.onGcodeLine?.(printerId, line);
        },
      },
    });

    this.connectors.set(printerId, connector);
    connector.start();

    if (!this.specsFetchInFlight.has(printerId)) {
      this.specsFetchInFlight.add(printerId);
      void (async () => {
        try {
          const http = new MoonrakerHttp({ baseUrl, apiKey });
          const configResp = (await http.queryObjects(['configfile'])) as any;
          const cfg =
            configResp?.result?.status?.configfile?.settings ??
            configResp?.status?.configfile?.settings ??
            null;

          const nozzle =
            Number((cfg as any)?.extruder?.nozzle_diameter ?? NaN) || null;
          const meshMax = (cfg as any)?.bed_mesh?.mesh_max;
          const { bedX, bedY } = parseMeshMaxToBedXY(meshMax);

          const data: any = {};
          if (nozzle !== null && Number.isFinite(nozzle))
            data.nozzleDiameter = nozzle;
          if (bedX !== null && Number.isFinite(bedX)) data.bedX = bedX;
          if (bedY !== null && Number.isFinite(bedY)) data.bedY = bedY;
          // bedZ is not reliably provided here; keep existing
          if (Object.keys(data).length > 0) {
            await prisma.printer.update({ where: { id: printerId }, data });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(
            { printerId, err: msg },
            'failed to auto-detect printer specs',
          );
        } finally {
          this.specsFetchInFlight.delete(printerId);
        }
      })();
    }
  }

  async removeConnector(printerId: string) {
    const c = this.connectors.get(printerId);
    if (c) {
      c.stop();
      this.connectors.delete(printerId);
    }
    this.rawStatus.delete(printerId);
  }

  async createPrinter(input: {
    displayName: string;
    modelId: string;
    moonrakerBaseUrl: string;
    moonrakerApiKey: string;
  }) {
    const apiKeyEncrypted = encryptApiKey(
      input.moonrakerApiKey,
      env.PRINTER_API_KEY_ENC_KEY,
    );

    const created = await prisma.printer.create({
      data: {
        displayName: input.displayName,
        baseUrl: input.moonrakerBaseUrl,
        apiKeyEncrypted,
        needsRekey: false,
        bedX: 0,
        bedY: 0,
        bedZ: 0,
        nozzleDiameter: 0.4,
        modelId: input.modelId,
      },
    });

    await this.ensureConnector(created.id);

    return created;
  }

  async updatePrinter(
    printerId: string,
    patch: {
      displayName?: string;
      modelId?: string;
      moonrakerBaseUrl?: string;
      moonrakerApiKey?: string;
    },
  ) {
    const data: any = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.modelId !== undefined) data.modelId = patch.modelId;
    if (patch.moonrakerBaseUrl !== undefined)
      data.baseUrl = patch.moonrakerBaseUrl;
    if (patch.moonrakerApiKey !== undefined) {
      data.apiKeyEncrypted = encryptApiKey(
        patch.moonrakerApiKey,
        env.PRINTER_API_KEY_ENC_KEY,
      );
      data.needsRekey = false;
    }

    const updated = await prisma.printer.update({
      where: { id: printerId },
      data,
    });

    await this.removeConnector(printerId);
    await this.ensureConnector(printerId);

    return updated;
  }

  async deletePrinter(printerId: string) {
    await this.removeConnector(printerId);
    await prisma.printer.delete({ where: { id: printerId } });
  }

  async action(printerId: string, action: 'pause' | 'resume' | 'cancel') {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });

    if (action === 'pause') return http.post('/printer/print/pause');
    if (action === 'resume') return http.post('/printer/print/resume');
    return http.post('/printer/print/cancel');
  }

  async emergencyStop(printerId: string) {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });
    return http.post('/printer/emergency_stop');
  }

  async firmwareRestart(printerId: string) {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });
    return http.post('/printer/firmware_restart');
  }
}

export const printerRuntime = new PrinterRuntimeManager();
