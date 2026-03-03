import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { WebSocketServer, type WebSocket } from 'ws';

export type MockMoonrakerCall =
  | {
      kind: 'upload';
      filename: string;
      path: string | null;
      root: string | null;
      checksum: string | null;
      size: number;
    }
  | { kind: 'metascan'; filename: string }
  | { kind: 'metadata'; filename: string }
  | { kind: 'thumbnails'; filename: string }
  | { kind: 'download'; root: string; filename: string }
  | { kind: 'print_start'; filename: string };

export type MockMoonrakerControls = {
  setBusy(state: boolean): void;
  setDelayMs(delayMs: number): void;
  resetCalls(): void;
  releaseStartBarrier(): void;
  setStartBarrier(count: number): void;
};

export type MockMoonrakerServer = {
  baseUrl: string;
  calls: MockMoonrakerCall[];
  files: Map<string, Buffer>;
  close(): Promise<void>;
  controls: MockMoonrakerControls;
  stats: {
    activeStarts: number;
    maxConcurrentStarts: number;
  };
  ws: {
    sendStatusUpdate(diff: unknown): void;
    sendHistoryChanged(payload: unknown): void;
  };
};

export type MockMoonrakerSharedState = {
  stats: {
    activeStarts: number;
    maxConcurrentStarts: number;
  };
  barrier: {
    count: number;
    released: boolean;
    waiters: Array<() => void>;
  };
};

function jsonrpcResult(id: number, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

export async function startMockMoonraker(opts?: {
  shared?: MockMoonrakerSharedState;
}): Promise<MockMoonrakerServer> {
  const calls: MockMoonrakerCall[] = [];
  const files = new Map<string, Buffer>();

  let busy = false;
  let delayMs = 0;

  // Barrier for /printer/print/start to support concurrency tests
  const shared: MockMoonrakerSharedState =
    opts?.shared ??
    ({
      stats: {
        activeStarts: 0,
        maxConcurrentStarts: 0,
      },
      barrier: {
        count: 0,
        released: false,
        waiters: [],
      },
    } satisfies MockMoonrakerSharedState);

  function barrierPromise(): Promise<void> {
    if (shared.barrier.released) return Promise.resolve();
    if (shared.barrier.count <= 0) return Promise.resolve();
    shared.barrier.count--;
    return new Promise<void>((resolve) => {
      shared.barrier.waiters.push(resolve);
    });
  }

  function releaseStartBarrier() {
    shared.barrier.released = true;
    const w = shared.barrier.waiters;
    shared.barrier.waiters = [];
    for (const r of w) r();
  }

  const app: FastifyInstance = Fastify({
    logger: false,
    ignoreTrailingSlash: true,
  });

  await app.register(multipart);

  // Minimal /server/info for any future use
  app.get('/server/info', async () => {
    return {
      klippy_connected: true,
      klippy_state: 'ready',
      websocket_count: 0,
      api_version: [1, 4, 0],
      api_version_string: '1.4.0',
      moonraker_version: 'mock',
      components: ['file_manager', 'history'],
      failed_components: [],
      registered_directories: ['config', 'gcodes'],
      warnings: [],
    };
  });

  app.post('/server/files/upload', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const mp = await (req as any).file();
    if (!mp) return reply.code(400).send({ error: 'NO_FILE' });

    const buf = await mp.toBuffer();

    const fields = (req as any).body ?? {};
    const root = typeof fields.root === 'string' ? fields.root : null;
    const path = typeof fields.path === 'string' ? fields.path : null;
    const checksum =
      typeof fields.checksum === 'string' ? fields.checksum : null;

    const filename = String(mp.filename);

    const key = [root ?? 'gcodes', path ?? '', filename]
      .filter(Boolean)
      .join('/');
    files.set(key, buf);

    calls.push({
      kind: 'upload',
      filename,
      path,
      root,
      checksum,
      size: buf.length,
    });

    return reply.send({ result: 'ok' });
  });

  app.post('/server/files/metascan', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const filename = String((req.query as any)?.filename ?? '');
    calls.push({ kind: 'metascan', filename });
    return reply.send({ result: 'ok' });
  });

  app.get('/server/files/metadata', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const filename = String((req.query as any)?.filename ?? '');
    calls.push({ kind: 'metadata', filename });

    return reply.send({
      filename,
      estimated_time: 123,
      nozzle_diameter: 0.4,
      filament_type: 'PLA',
      filament_name: 'Test PLA',
      size: 100,
      thumbnails: [
        {
          width: 100,
          height: 100,
          size: 10,
          relative_path: 'thumbs/100.png',
        },
      ],
    });
  });

  app.get('/server/files/thumbnails', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const filename = String((req.query as any)?.filename ?? '');
    calls.push({ kind: 'thumbnails', filename });

    return reply.send([
      {
        width: 100,
        height: 100,
        size: 10,
        thumbnail_path: 'test/.thumbs/small.png',
      },
      {
        width: 500,
        height: 500,
        size: 20,
        thumbnail_path: 'test/.thumbs/big.png',
      },
    ]);
  });

  app.get('/server/files/:root/*', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const root = String((req.params as any).root ?? '');
    const filename = String((req.params as any)['*'] ?? '');

    calls.push({ kind: 'download', root, filename });

    if (root === 'gcodes' && filename === 'test/.thumbs/small.png') {
      reply.header('content-type', 'image/png');
      return reply.send(Buffer.from('SMALL_THUMB', 'utf8'));
    }
    if (root === 'gcodes' && filename === 'test/.thumbs/big.png') {
      reply.header('content-type', 'image/png');
      return reply.send(Buffer.from('BIG_THUMB', 'utf8'));
    }

    const key = [root, filename].filter(Boolean).join('/');
    const found = files.get(key);
    if (!found) return reply.code(404).send({ error: 'NOT_FOUND' });

    reply.header('content-type', 'application/octet-stream');
    return reply.send(found);
  });

  app.post('/printer/print/start', async (req, reply) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    if (busy) return reply.code(409).send({ error: 'PRINTER_BUSY' });

    const body = (req.body ?? {}) as any;
    const filename = String(
      body.filename ?? (req.query as any)?.filename ?? '',
    );

    calls.push({ kind: 'print_start', filename });

    shared.stats.activeStarts++;
    shared.stats.maxConcurrentStarts = Math.max(
      shared.stats.maxConcurrentStarts,
      shared.stats.activeStarts,
    );

    try {
      await barrierPromise();
      return reply.send({ result: 'ok' });
    } finally {
      shared.stats.activeStarts--;
    }
  });

  // Start server on random port
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  // WS server on the same HTTP server, path /websocket
  const wss = new WebSocketServer({ server: app.server, path: '/websocket' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (socket) => {
    clients.add(socket);

    socket.on('close', () => {
      clients.delete(socket);
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as any;
        const id = typeof msg.id === 'number' ? msg.id : null;
        const method = typeof msg.method === 'string' ? msg.method : '';

        if (id !== null && method === 'server.connection.identify') {
          socket.send(
            JSON.stringify(jsonrpcResult(id, { connection_id: 'mock-1' })),
          );
          return;
        }

        if (id !== null && method === 'printer.objects.subscribe') {
          socket.send(JSON.stringify(jsonrpcResult(id, { status: 'ok' })));
          return;
        }

        if (id !== null) {
          socket.send(JSON.stringify(jsonrpcResult(id, { status: 'ok' })));
        }
      } catch {
        // ignore
      }
    });
  });

  function wsBroadcast(method: string, params: unknown[]) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const c of clients) {
      try {
        c.send(msg);
      } catch {
        // ignore
      }
    }
  }

  return {
    baseUrl,
    calls,
    files,
    stats: shared.stats,
    controls: {
      setBusy: (state: boolean) => {
        busy = state;
      },
      setDelayMs: (ms: number) => {
        delayMs = Math.max(0, ms);
      },
      resetCalls: () => {
        calls.splice(0, calls.length);
      },
      setStartBarrier: (count: number) => {
        shared.barrier.released = false;
        shared.barrier.count = Math.max(0, Math.floor(count));
      },
      releaseStartBarrier,
    },
    ws: {
      sendStatusUpdate: (diff: unknown) => {
        wsBroadcast('notify_status_update', [diff, Date.now() / 1000]);
      },
      sendHistoryChanged: (payload: unknown) => {
        wsBroadcast('notify_history_changed', [payload]);
      },
    },
    close: async () => {
      try {
        wss.close();
      } catch {
        // ignore
      }
      await app.close();
    },
  };
}
