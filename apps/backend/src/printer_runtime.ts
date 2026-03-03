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

function normalizePrinterState(raw: string | null): PrinterState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'printing') return PrinterState.printing;
  if (s === 'paused') return PrinterState.paused;
  if (s === 'error') return PrinterState.error;
  if (s === 'standby' || s === 'ready' || s === 'idle')
    return PrinterState.standby;
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
  const ext = (raw.extruder ?? {}) as Record<string, unknown>;
  const bed = (raw.heater_bed ?? {}) as Record<string, unknown>;
  const th = (raw.toolhead ?? {}) as Record<string, unknown>;
  const gm = (raw.gcode_move ?? {}) as Record<string, unknown>;
  const mr = (raw.motion_report ?? {}) as Record<string, unknown>;
  const fan = (raw.fan ?? {}) as Record<string, unknown>;

  const state = normalizePrinterState(strOrNull(ps.state));

  const filename = strOrNull(ps.filename) ?? strOrNull(vsd.filename);

  const p1 = numOrNull(ds.progress);
  const p2 = numOrNull(vsd.progress);
  const progress = p1 !== null ? clamp01(p1) : p2 !== null ? clamp01(p2) : null;

  const printDurationSec = numOrNull(ps.print_duration);

  const temps = {
    extruder: numOrNull(ext.temperature),
    bed: numOrNull(bed.temperature),
  };

  const layers = {
    current: numOrNull((ps as any)?.info?.current_layer) ?? null,
    total: numOrNull((ps as any)?.info?.total_layer) ?? null,
  };

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

  return {
    snapshot: {
      state,
      filename,
      progress,
      etaSec: null,
      temps,
      layers,
      position: {
        commanded,
        live,
        gcode,
      },
      speed: {
        liveVelocityMmS,
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
      await this.ensureConnector(p.id);
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

          // ETA smoothing rule
          const progress = snapshot.progress;
          let etaSec: number | null = null;

          if (progress !== null && printDurationSec !== null) {
            const minDur = progress >= 0.2 ? 60 : 120;
            if (
              progress >= 0.02 &&
              printDurationSec >= minDur &&
              progress > 0
            ) {
              const estTotal = Math.round(printDurationSec / progress);
              const rawEta = Math.max(
                0,
                estTotal - Math.round(printDurationSec),
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
          }

          internal.snapshot = { ...snapshot, etaSec };
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

          const existing =
            printSessionId === null
              ? null
              : await prisma.printHistory.findFirst({
                  where: {
                    printerId,
                    printSessionId,
                  },
                });

          const saved = existing
            ? await prisma.printHistory.update({
                where: { id: existing.id },
                data: {
                  filename,
                  status,
                  endedAt: null,
                },
              })
            : await prisma.printHistory.create({
                data: {
                  printerId,
                  printSessionId,
                  filename,
                  status,
                  startedAt: now,
                  endedAt: null,
                  printDurationSec: null,
                  totalDurationSec: null,
                  filamentUsedMm: null,
                  errorMessage: null,
                },
              });

          this.onHistoryEvent?.(printerId, {
            id: saved.id,
            printerId: saved.printerId,
            filename: saved.filename,
            status: saved.status as HistoryStatus,
            startedAt: saved.startedAt.toISOString(),
            endedAt: saved.endedAt ? saved.endedAt.toISOString() : null,
            printDurationSec: saved.printDurationSec,
            totalDurationSec: saved.totalDurationSec,
            filamentUsedMm: saved.filamentUsedMm,
            errorMessage: saved.errorMessage,
          });
        },
        onGcodeResponse: (line) => {
          this.onGcodeLine?.(printerId, line);
        },
      },
    });

    this.connectors.set(printerId, connector);
    connector.start();
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

  async testPrinter(printerId: string) {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });
    return http.get('/server/info');
  }

  async rescanPrinter(printerId: string) {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });

    const toolheadResp = (await http.queryObjects(['toolhead'])) as any;
    const configResp = (await http.queryObjects(['configfile'])) as any;

    const toolhead =
      toolheadResp?.result?.status?.toolhead ?? toolheadResp?.status?.toolhead;
    const axisMin = toolhead?.axis_minimum;
    const axisMax = toolhead?.axis_maximum;

    const bedX =
      Array.isArray(axisMin) && Array.isArray(axisMax)
        ? Number(axisMax[0]) - Number(axisMin[0])
        : null;
    const bedY =
      Array.isArray(axisMin) && Array.isArray(axisMax)
        ? Number(axisMax[1]) - Number(axisMin[1])
        : null;
    const bedZ =
      Array.isArray(axisMin) && Array.isArray(axisMax)
        ? Number(axisMax[2]) - Number(axisMin[2])
        : null;

    const nozzle =
      Number(
        configResp?.result?.status?.configfile?.settings?.extruder
          ?.nozzle_diameter ??
          configResp?.status?.configfile?.settings?.extruder?.nozzle_diameter,
      ) || null;

    const data: any = {};
    if (bedX !== null && Number.isFinite(bedX)) data.bedX = bedX;
    if (bedY !== null && Number.isFinite(bedY)) data.bedY = bedY;
    if (bedZ !== null && Number.isFinite(bedZ)) data.bedZ = bedZ;
    if (nozzle !== null && Number.isFinite(nozzle))
      data.nozzleDiameter = nozzle;

    return prisma.printer.update({ where: { id: printerId }, data });
  }

  async action(printerId: string, action: 'pause' | 'resume' | 'cancel') {
    const { baseUrl, apiKey } = await this.getPrinterSecrets(printerId);
    const http = new MoonrakerHttp({ baseUrl, apiKey });

    if (action === 'pause') return http.post('/printer/print/pause');
    if (action === 'resume') return http.post('/printer/print/resume');
    return http.post('/printer/print/cancel');
  }
}

export const printerRuntime = new PrinterRuntimeManager();
