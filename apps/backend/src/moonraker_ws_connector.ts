import WebSocket from 'ws';

import { logger } from './logger.js';
import { MoonrakerHttp } from './moonraker_http.js';

export type MoonrakerWsCallbacks = {
  onStatusUpdate: (diff: unknown) => void;
  onHistoryChanged: (payload: unknown) => void;
  onGcodeResponse: (line: string) => void;
};

export type MoonrakerWsConnectorOptions = {
  printerId: string;
  baseUrl: string;
  apiKey: string;
  callbacks: MoonrakerWsCallbacks;
};

type JsonRpcMsg = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

function toWsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  // Moonraker ws endpoint
  u.pathname = '/websocket';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function backoffMs(attempt: number): number {
  const ms = Math.min(30_000, 1000 * Math.max(1, attempt));
  return ms;
}

export class MoonrakerWsConnector {
  private opts: MoonrakerWsConnectorOptions;
  private ws: WebSocket | null = null;
  private stopped = false;
  private nextId = 1;
  private attempt = 0;
  private connectionId: string | null = null;
  private gcodeRing: string[] = [];
  private gcodeRingMax = 200;
  private extraSubscribedObjects: string[] = [];

  constructor(opts: MoonrakerWsConnectorOptions) {
    if (!opts.apiKey.trim()) {
      throw new Error('Moonraker apiKey is required for ws');
    }
    this.opts = opts;
  }

  start() {
    this.stopped = false;
    void this.connectLoop();
  }

  stop() {
    this.stopped = true;
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }

  getLastGcodeLines(): string[] {
    return [...this.gcodeRing];
  }

  private pushGcode(line: string) {
    this.gcodeRing.push(line);
    while (this.gcodeRing.length > this.gcodeRingMax) this.gcodeRing.shift();
  }

  private sendRpc(method: string, params?: unknown): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WS not open');

    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString('utf8')) as JsonRpcMsg;
          if (parsed.id !== id) return;
          ws.off('message', onMessage);
          if (parsed.error)
            return reject(new Error(JSON.stringify(parsed.error)));
          resolve(parsed.result);
        } catch (e) {
          ws.off('message', onMessage);
          reject(e);
        }
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify(msg));
    });
  }

  private async connectLoop() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        // connectOnce returns only after close
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          { printerId: this.opts.printerId, err: msg },
          'moonraker ws connect failed',
        );
      }

      if (this.stopped) return;

      this.attempt++;
      const delay = backoffMs(this.attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async connectOnce(): Promise<void> {
    const wsUrl = toWsUrl(this.opts.baseUrl);

    this.connectionId = null;

    const headers: Record<string, string> = {};
    if (this.opts.apiKey.trim()) {
      headers['X-Api-Key'] = this.opts.apiKey;
    }

    const ws = new WebSocket(wsUrl, {
      headers,
      handshakeTimeout: 8000,
    });

    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: unknown) => reject(err));
    });

    // Reset backoff after successful TCP+WS handshake
    this.attempt = 0;

    logger.info(
      { printerId: this.opts.printerId, wsUrl },
      'moonraker ws connected',
    );

    // Identify
    const identifyRes = await this.sendRpc('server.connection.identify', {
      client_name: 'farma-backend',
      version: '0.1',
      type: 'agent',
      url: 'https://github.com/bitwiresys/farma-klipper-telegram',
    });

    const cid = (identifyRes as { connection_id?: unknown } | null)
      ?.connection_id;
    this.connectionId = typeof cid === 'string' ? cid : null;

    logger.info(
      { printerId: this.opts.printerId, connectionId: this.connectionId },
      'moonraker ws identify ok',
    );

    // Subscribe
    const subscribeRes = await this.sendRpc('printer.objects.subscribe', {
      objects: {
        print_stats: null,
        virtual_sdcard: null,
        display_status: null,
        toolhead: null,
        webhooks: null,
        extruder: null,
        heater_bed: null,
        gcode_move: null,
        motion_report: null,
        fan: null,
      },
    });

    try {
      const initialStatus = (subscribeRes as any)?.status;
      if (initialStatus && typeof initialStatus === 'object') {
        this.opts.callbacks.onStatusUpdate(initialStatus);
      }
    } catch {
      // ignore
    }

    logger.info(
      { printerId: this.opts.printerId },
      'moonraker ws subscribe ok',
    );

    this.extraSubscribedObjects = [];
    try {
      const http = new MoonrakerHttp({
        baseUrl: this.opts.baseUrl,
        apiKey: this.opts.apiKey,
      });

      const res = await http.get<any>('/printer/objects/list');
      const objects =
        (res as any)?.result?.objects ?? (res as any)?.objects ?? ([] as any[]);
      const list = Array.isArray(objects) ? objects.map(String) : [];

      const candidates = list.filter((k) => {
        const s = String(k).toLowerCase();
        return s.startsWith('temperature_sensor') || s.includes('chamber');
      });

      const unique = Array.from(new Set(candidates)).slice(0, 12);
      if (unique.length > 0) {
        await this.sendRpc('printer.objects.subscribe', {
          objects: Object.fromEntries(unique.map((k) => [k, null])),
        });
        this.extraSubscribedObjects = unique;
        logger.info(
          { printerId: this.opts.printerId, objects: unique },
          'moonraker ws extra subscribe ok',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        { printerId: this.opts.printerId, err: msg },
        'moonraker ws chamber sensor discovery/subscribe failed',
      );
    }

    let gotFirstStatus = false;

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString('utf8')) as JsonRpcMsg;

        if (parsed.method === 'notify_status_update') {
          if (!gotFirstStatus) {
            gotFirstStatus = true;
            logger.info(
              { printerId: this.opts.printerId },
              'moonraker ws first status_update received',
            );
          }
          const params = parsed.params;
          // Moonraker sends [diff, eventtime]
          const diff = Array.isArray(params) ? params[0] : params;
          this.opts.callbacks.onStatusUpdate(diff);
          return;
        }

        if (parsed.method === 'notify_history_changed') {
          this.opts.callbacks.onHistoryChanged(parsed.params);
          return;
        }

        if (parsed.method === 'notify_gcode_response') {
          const params = parsed.params;
          const line = Array.isArray(params)
            ? String(params[0] ?? '')
            : String(params ?? '');
          if (line) {
            this.pushGcode(line);
            this.opts.callbacks.onGcodeResponse(line);
          }
          return;
        }
      } catch (e) {
        logger.debug(
          { printerId: this.opts.printerId },
          'moonraker ws message parse failed',
        );
      }
    });

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.once('error', () => resolve());
    });

    logger.warn(
      { printerId: this.opts.printerId },
      'moonraker ws disconnected',
    );

    this.ws = null;
    this.attempt = 0;
  }
}
