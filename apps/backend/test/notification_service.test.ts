import { describe, expect, it } from 'vitest';

import { NotificationEventType, PrinterState } from '@farma/shared';

import {
  NotificationService,
  type NotificationRepo,
  type NotificationSender,
  type NotificationUserSettings,
} from '../src/notification_service.js';

type Msg = { chatId: string; text: string };

class MemRepo implements NotificationRepo {
  private set = new Set<string>();
  async tryLogSend(input: {
    printerId: string;
    printSessionId: string;
    eventType: NotificationEventType;
  }): Promise<boolean> {
    const key = `${input.printerId}|${input.printSessionId}|${input.eventType}`;
    if (this.set.has(key)) return false;
    this.set.add(key);
    return true;
  }
}

function mkService(opts: {
  snapshot: {
    state: PrinterState;
    filename: string | null;
    etaSec: number | null;
    layers: { current: number | null; total: number | null };
  };
  printSessionId?: string | null;
  users?: NotificationUserSettings[];
}) {
  const out: Msg[] = [];
  const sender: NotificationSender = {
    sendMessage: async (chatId, text) => {
      out.push({ chatId, text });
    },
  };

  const repo = new MemRepo();

  const service = new NotificationService({
    sender,
    repo,
    getSnapshot: () => opts.snapshot,
    getOrCreatePrintSessionId: async () => opts.printSessionId ?? 'p1:file:123',
    clearPrintSession: async () => {},
    listUsers: async () =>
      opts.users ?? [
        {
          chatId: 'c1',
          notificationsEnabled: true,
          notifyFirstLayer: true,
          notifyComplete: true,
          notifyError: true,
        },
      ],
    getPrinterDisplayName: async () => 'P1',
  });

  return { service, out };
}

describe('NotificationService', () => {
  it('layer==2 triggers FIRST_LAYER_DONE only once', async () => {
    const { service, out } = mkService({
      snapshot: {
        state: PrinterState.printing,
        filename: 'x.gcode',
        etaSec: 600,
        layers: { current: 1, total: 10 },
      },
    });

    await service.onStatusUpdate('p1', { print_stats: { state: 'printing' } });

    // jump to layer 2
    (service as any).getSnapshot = () => ({
      state: PrinterState.printing,
      filename: 'x.gcode',
      etaSec: 600,
      layers: { current: 2, total: 10 },
    });

    await service.onStatusUpdate('p1', { print_stats: { state: 'printing' } });
    await service.onStatusUpdate('p1', { print_stats: { state: 'printing' } });

    const fl = out.filter((m) => m.text.includes('FIRST LAYER DONE'));
    expect(fl.length).toBe(1);
  });

  it('fallback progress/duration triggers FIRST_LAYER_DONE', async () => {
    const { service, out } = mkService({
      snapshot: {
        state: PrinterState.printing,
        filename: 'x.gcode',
        etaSec: null,
        layers: { current: null, total: null },
      },
    });

    await service.onStatusUpdate('p1', {
      print_stats: { state: 'printing', print_duration: 130 },
      display_status: { progress: 0.03 },
    });

    const fl = out.filter((m) => m.text.includes('FIRST LAYER DONE'));
    expect(fl.length).toBe(1);
  });

  it('error triggers PRINT_ERROR and includes gcode tail', async () => {
    const { service, out } = mkService({
      snapshot: {
        state: PrinterState.error,
        filename: 'x.gcode',
        etaSec: null,
        layers: { current: null, total: null },
      },
    });

    service.onGcodeResponse('p1', 'echo: one');
    service.onGcodeResponse('p1', 'echo: two');

    await service.onStatusUpdate('p1', {
      print_stats: { state: 'error', message: 'boom' },
      webhooks: { reason: 'bad', state_message: 'halted' },
    });

    const err = out.find((m) => m.text.includes('PRINT ERROR'));
    expect(err).toBeTruthy();
    expect(err!.text).toContain('boom');
    expect(err!.text).toContain('webhooks reason');
    expect(err!.text).toContain('echo: one');
    expect(err!.text).toContain('echo: two');
  });

  it('dedup prevents sending same event twice for same session', async () => {
    const { service, out } = mkService({
      snapshot: {
        state: PrinterState.printing,
        filename: 'x.gcode',
        etaSec: null,
        layers: { current: null, total: null },
      },
      printSessionId: 'sess-1',
    });

    await service.onStatusUpdate('p1', {
      print_stats: { state: 'printing', print_duration: 130 },
      display_status: { progress: 0.03 },
    });

    await service.onStatusUpdate('p1', {
      print_stats: { state: 'printing', print_duration: 140 },
      display_status: { progress: 0.04 },
    });

    const fl = out.filter((m) => m.text.includes('FIRST LAYER DONE'));
    expect(fl.length).toBe(1);
  });
});
