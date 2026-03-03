import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

import type { WsEvent } from '@farma/shared';
import type WebSocket from 'ws';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';

type Client = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      client.close(1008, msg);
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

    const client: Client = {
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    };

    await wsHub.addClient(client, token);

    socket.on('close', () => {
      wsHub.removeClient(client);
    });
  };

  app.get('/api/ws', { websocket: true }, handler);
  app.get('/ws', { websocket: true }, handler);
}
