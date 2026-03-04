import { NotificationEventType, PrinterState } from '@farma/shared';

import { prisma } from './prisma.js';
import { logger } from './logger.js';

export type NotificationSender = {
  sendMessage: (chatId: string, text: string) => Promise<void>;
};

export type NotificationUserSettings = {
  chatId: string;
  notificationsEnabled: boolean;
  notifyFirstLayer: boolean;
  notifyComplete: boolean;
  notifyError: boolean;
};

export type NotificationRepo = {
  tryLogSend: (input: {
    printerId: string;
    printSessionId: string;
    eventType: NotificationEventType;
  }) => Promise<boolean>; // true => newly logged
};

export class PrismaNotificationRepo implements NotificationRepo {
  async tryLogSend(input: {
    printerId: string;
    printSessionId: string;
    eventType: NotificationEventType;
  }): Promise<boolean> {
    try {
      await prisma.notificationLog.create({
        data: {
          printerId: input.printerId,
          printSessionId: input.printSessionId,
          eventType: input.eventType,
        },
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Prisma unique constraint error
      if (msg.toLowerCase().includes('unique') || msg.includes('P2002')) {
        return false;
      }
      throw e;
    }
  }
}

type GcodeLine = { t: number; line: string };

type PrinterMemo = {
  lastLayer: number | null;
  lastPrintState: string | null;
  gcode: GcodeLine[];
  lastDiagAtMs: number;
  lastInfoAtMs: number;
  lastPrintSessionId: string | null;
};

function nowMs(): number {
  return Date.now();
}

function numOrNull(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x;
}

function strOrNull(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  return x;
}

function normalizePrintStatsState(raw: unknown): string | null {
  const s = strOrNull(raw);
  if (!s) return null;
  const n = s.trim().toLowerCase();
  if (n === 'completed') return 'complete';
  if (n === 'cancelled') return 'cancelled';
  if (n === 'canceled') return 'cancelled';
  return n;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export class NotificationService {
  private sender: NotificationSender;
  private repo: NotificationRepo;
  private getSnapshot: (printerId: string) => {
    state: PrinterState;
    filename: string | null;
    etaSec: number | null;
    layers: { current: number | null; total: number | null };
  };
  private getOrCreatePrintSessionId: (input: {
    printerId: string;
    filename: string | null;
    state: PrinterState;
  }) => Promise<string | null>;
  private clearPrintSession: (printerId: string) => Promise<void>;
  private listUsers: () => Promise<NotificationUserSettings[]>;
  private getPrinterDisplayName: (printerId: string) => Promise<string>;
  private memo = new Map<string, PrinterMemo>();

  constructor(opts: {
    sender: NotificationSender;
    repo: NotificationRepo;
    getSnapshot: NotificationService['getSnapshot'];
    getOrCreatePrintSessionId: NotificationService['getOrCreatePrintSessionId'];
    clearPrintSession: NotificationService['clearPrintSession'];
    listUsers: NotificationService['listUsers'];
    getPrinterDisplayName: NotificationService['getPrinterDisplayName'];
  }) {
    this.sender = opts.sender;
    this.repo = opts.repo;
    this.getSnapshot = opts.getSnapshot;
    this.getOrCreatePrintSessionId = opts.getOrCreatePrintSessionId;
    this.clearPrintSession = opts.clearPrintSession;
    this.listUsers = opts.listUsers;
    this.getPrinterDisplayName = opts.getPrinterDisplayName;
  }

  onGcodeResponse(printerId: string, line: string) {
    const m = this.getMemo(printerId);
    m.gcode.push({ t: nowMs(), line });
    const cutoff = nowMs() - 5 * 60_000;
    while (m.gcode.length && m.gcode[0]!.t < cutoff) m.gcode.shift();
  }

  async onStatusUpdate(printerId: string, rawStatus: Record<string, unknown>) {
    const m = this.getMemo(printerId);

    const snapshot = this.getSnapshot(printerId);
    const printSessionId = await this.getOrCreatePrintSessionId({
      printerId,
      filename: snapshot.filename,
      state: snapshot.state,
    });

    if (printSessionId && m.lastPrintSessionId !== printSessionId) {
      m.lastPrintSessionId = printSessionId;
      m.lastLayer = null;
      m.lastPrintState = null;
    }

    const now = nowMs();
    const diagDue = now - m.lastDiagAtMs >= 30_000;
    const infoDue = now - m.lastInfoAtMs >= 120_000;

    if (!printSessionId) {
      if (diagDue) {
        m.lastDiagAtMs = now;
        logger.debug(
          {
            printerId,
            state: snapshot.state,
            filename: snapshot.filename,
          },
          'notifications: no printSessionId yet (skipping)',
        );
      }
      if (infoDue) {
        m.lastInfoAtMs = now;
        logger.info(
          {
            printerId,
            state: snapshot.state,
            filename: snapshot.filename,
          },
          'notifications: skipping (no printSessionId)',
        );
      }
      m.lastLayer = snapshot.layers.current;
      m.lastPrintState = normalizePrintStatsState(
        (rawStatus.print_stats as any)?.state,
      );
      return;
    }

    const printStats = (rawStatus.print_stats ?? {}) as Record<string, unknown>;
    const webhooks = (rawStatus.webhooks ?? {}) as Record<string, unknown>;

    const psState = normalizePrintStatsState(printStats.state);

    const progressRaw = numOrNull(
      (rawStatus.display_status as any)?.progress ??
        (rawStatus.virtual_sdcard as any)?.progress,
    );
    const progress = progressRaw === null ? null : clamp01(progressRaw);
    const printDurationSec = numOrNull(printStats.print_duration);

    const layers = snapshot.layers;

    const canNotify = await this.listUsers();
    if (canNotify.length === 0) {
      if (diagDue) {
        m.lastDiagAtMs = now;
        logger.debug(
          {
            printerId,
            printSessionId,
          },
          'notifications: no eligible users with chatId (skipping)',
        );
      }
      if (infoDue) {
        m.lastInfoAtMs = now;
        logger.info(
          {
            printerId,
            printSessionId,
          },
          'notifications: skipping (no eligible users)',
        );
      }
      m.lastLayer = layers.current;
      m.lastPrintState = psState;
      return;
    }

    // FIRST_LAYER_DONE
    const layersHave = layers.current !== null && layers.total !== null;
    const shouldFirstLayer = (() => {
      if (snapshot.state !== PrinterState.printing) return false;

      // Some firmwares/Moonraker setups report stale or bogus layer counters
      // immediately after print start. Guard against implausible early values.
      if (
        layersHave &&
        printDurationSec !== null &&
        printDurationSec < 120 &&
        (layers.current ?? 0) > 10
      ) {
        return false;
      }

      if (layersHave) {
        return (
          layers.current !== null &&
          layers.current >= 1 &&
          (m.lastLayer === null || m.lastLayer < 1)
        );
      }
      if (progress === null || printDurationSec === null) return false;
      return progress >= 0.02 && printDurationSec >= 120;
    })();

    if (shouldFirstLayer) {
      logger.info(
        {
          printerId,
          printSessionId,
        },
        'notifications: FIRST_LAYER_DONE triggered',
      );
      await this.maybeSend({
        printerId,
        printSessionId,
        eventType: NotificationEventType.FIRST_LAYER_DONE,
        users: canNotify.filter(
          (u) => u.notificationsEnabled && u.notifyFirstLayer,
        ),
        text: this.formatFirstLayer({
          displayName: await this.getPrinterDisplayName(printerId),
          filename: (snapshot as any).jobLabel ?? snapshot.filename,
          etaSec: snapshot.etaSec,
          layers,
          layersHave,
        }),
      });
    }

    // PRINT_COMPLETE
    const shouldComplete =
      psState === 'complete' && m.lastPrintState !== 'complete';
    if (shouldComplete) {
      logger.info(
        {
          printerId,
          printSessionId,
        },
        'notifications: PRINT_COMPLETE triggered',
      );
      await this.maybeSend({
        printerId,
        printSessionId,
        eventType: NotificationEventType.PRINT_COMPLETE,
        users: canNotify.filter(
          (u) => u.notificationsEnabled && u.notifyComplete,
        ),
        text: this.formatComplete({
          displayName: await this.getPrinterDisplayName(printerId),
          filename: (snapshot as any).jobLabel ?? snapshot.filename,
        }),
      });
    }

    // PRINT_ERROR
    const shouldError = psState === 'error' && m.lastPrintState !== 'error';
    if (shouldError) {
      logger.info(
        {
          printerId,
          printSessionId,
        },
        'notifications: PRINT_ERROR triggered',
      );
      const tail = this.getGcodeTail(printerId);
      await this.maybeSend({
        printerId,
        printSessionId,
        eventType: NotificationEventType.PRINT_ERROR,
        users: canNotify.filter((u) => u.notificationsEnabled && u.notifyError),
        text: this.formatError({
          displayName: await this.getPrinterDisplayName(printerId),
          filename: (snapshot as any).jobLabel ?? snapshot.filename,
          printStatsMessage: strOrNull(printStats.message),
          webhooksStateMessage: strOrNull((webhooks as any).state_message),
          webhooksReason: strOrNull((webhooks as any).reason),
          gcodeTail: tail,
        }),
      });
    }

    if (diagDue) {
      m.lastDiagAtMs = now;
      logger.debug(
        {
          printerId,
          printSessionId,
          psState,
          snapshotState: snapshot.state,
          progress,
          printDurationSec,
          layers,
          shouldFirstLayer,
          shouldComplete,
          shouldError,
          notifyUsers: {
            total: canNotify.length,
            firstLayer: canNotify.filter(
              (u) => u.notificationsEnabled && u.notifyFirstLayer,
            ).length,
            complete: canNotify.filter(
              (u) => u.notificationsEnabled && u.notifyComplete,
            ).length,
            error: canNotify.filter(
              (u) => u.notificationsEnabled && u.notifyError,
            ).length,
          },
        },
        'notifications: evaluated',
      );
    }

    m.lastLayer = layers.current;
    m.lastPrintState = psState;

    if (
      psState === 'complete' ||
      psState === 'error' ||
      psState === 'cancelled'
    ) {
      await this.clearPrintSession(printerId);
    }
  }

  private getMemo(printerId: string): PrinterMemo {
    const ex = this.memo.get(printerId);
    if (ex) return ex;
    const created: PrinterMemo = {
      lastLayer: null,
      lastPrintState: null,
      gcode: [],
      lastDiagAtMs: 0,
      lastInfoAtMs: 0,
      lastPrintSessionId: null,
    };
    this.memo.set(printerId, created);
    return created;
  }

  private getGcodeTail(printerId: string): string[] {
    const m = this.getMemo(printerId);
    const cutoff = nowMs() - 30_000;
    const last = m.gcode.filter((x) => x.t >= cutoff).slice(-10);
    return last.map((x) => x.line);
  }

  private async maybeSend(input: {
    printerId: string;
    printSessionId: string;
    eventType: NotificationEventType;
    users: Array<{ chatId: string }>;
    text: string;
  }) {
    if (input.users.length === 0) return;

    const ok = await this.repo.tryLogSend({
      printerId: input.printerId,
      printSessionId: input.printSessionId,
      eventType: input.eventType,
    });
    if (!ok) return;

    await Promise.all(
      input.users.map(async (u) => {
        try {
          await this.sender.sendMessage(u.chatId, input.text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(
            {
              printerId: input.printerId,
              eventType: input.eventType,
              chatId: u.chatId,
              err: msg,
            },
            'telegram send failed',
          );
        }
      }),
    );
  }

  private formatFirstLayer(input: {
    displayName: string;
    filename: string | null;
    etaSec: number | null;
    layers: { current: number | null; total: number | null };
    layersHave: boolean;
  }): string {
    const f = input.filename ?? '-';
    const eta =
      input.etaSec === null
        ? '-'
        : `${Math.max(0, Math.floor(input.etaSec / 60))}m`;
    const layer = input.layersHave
      ? `layer ${input.layers.current}/${input.layers.total}`
      : 'layer (unknown)';
    return `FIRST LAYER DONE\n${input.displayName}\n${f}\nETA ${eta}\n${layer}`;
  }

  private formatComplete(input: {
    displayName: string;
    filename: string | null;
  }): string {
    return `PRINT COMPLETE\n${input.displayName}\n${input.filename ?? '-'}`;
  }

  private formatError(input: {
    displayName: string;
    filename: string | null;
    printStatsMessage: string | null;
    webhooksStateMessage: string | null;
    webhooksReason: string | null;
    gcodeTail: string[];
  }): string {
    const parts: string[] = [];
    parts.push('PRINT ERROR');
    parts.push(input.displayName);
    parts.push(input.filename ?? '-');
    if (input.printStatsMessage)
      parts.push(`print_stats: ${input.printStatsMessage}`);
    if (input.webhooksReason)
      parts.push(`webhooks reason: ${input.webhooksReason}`);
    if (input.webhooksStateMessage)
      parts.push(`webhooks msg: ${input.webhooksStateMessage}`);
    if (input.gcodeTail.length > 0) {
      parts.push('gcode tail:');
      for (const l of input.gcodeTail) parts.push(`- ${l}`);
    }
    return parts.join('\n');
  }
}

export async function listNotificationUsersFromDb(): Promise<
  NotificationUserSettings[]
> {
  const users = await prisma.user.findMany({
    where: {
      isAllowed: true,
      chatId: { not: null },
    },
    select: {
      chatId: true,
      notificationsEnabled: true,
      notifyFirstLayer: true,
      notifyComplete: true,
      notifyError: true,
    },
  });

  return users
    .map((u) => ({
      chatId: u.chatId ?? '',
      notificationsEnabled: u.notificationsEnabled,
      notifyFirstLayer: u.notifyFirstLayer,
      notifyComplete: u.notifyComplete,
      notifyError: u.notifyError,
    }))
    .filter((u) => !!u.chatId);
}

export async function getPrinterDisplayNameFromDb(
  printerId: string,
): Promise<string> {
  const p = await prisma.printer.findUnique({ where: { id: printerId } });
  return p?.displayName ?? printerId;
}
