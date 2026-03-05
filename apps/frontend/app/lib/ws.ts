import { getBackendWsUrl } from './env';

export type WsEvent = {
  type: string;
  payload: unknown;
};

export type WsError = {
  type: 'connection' | 'auth' | 'timeout' | 'unknown';
  message: string;
  timestamp: string;
};

type WsErrorListener = (err: WsError) => void;

const wsErrorListeners = new Set<WsErrorListener>();

export function subscribeWsErrors(fn: WsErrorListener): () => void {
  wsErrorListeners.add(fn);
  return () => wsErrorListeners.delete(fn);
}

function emitWsError(err: WsError) {
  for (const fn of wsErrorListeners) {
    try {
      fn(err);
    } catch {
      // ignore
    }
  }
}

export function connectBackendWs(opts: {
  token: string;
  onEvent: (ev: WsEvent) => void;
  onStatus: (s: 'connecting' | 'open' | 'closed' | 'error') => void;
}): { close: () => void; send: (data: unknown) => void } {
  const base = getBackendWsUrl();
  if (!base) throw new Error('NEXT_PUBLIC_BACKEND_WS_URL is not set');

  let stopped = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let missedHeartbeats = 0;
  const MAX_MISSED_HEARTBEATS = 3;

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = () => {
    clearHeartbeat();
    missedHeartbeats = 0;
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      missedHeartbeats++;
      if (missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        emitWsError({
          type: 'timeout',
          message: 'WebSocket heartbeat timeout - reconnecting',
          timestamp: new Date().toISOString(),
        });
        ws.close(1000, 'heartbeat timeout');
        return;
      }
      // Send ping - server should respond with pong
      ws.send(JSON.stringify({ type: 'PING' }));
    }, 30000); // 30s heartbeat
  };

  const connect = () => {
    if (stopped) return;

    attempt++;
    opts.onStatus('connecting');

    const u = new URL(base);

    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol === 'https:') u.protocol = 'wss:';

    if (u.pathname.endsWith('/api/ws')) {
      u.pathname = u.pathname.slice(0, -'/api/ws'.length) || '/';
    }

    const prefix = u.pathname.replace(/\/$/, '');
    u.pathname = `${prefix}/api/ws`;
    u.search = new URLSearchParams({ token: opts.token }).toString();

    ws = new WebSocket(u.toString());

    ws.onopen = () => {
      attempt = 0;
      opts.onStatus('open');
      startHeartbeat();
    };

    ws.onmessage = (m) => {
      try {
        const parsed = JSON.parse(String(m.data)) as WsEvent;
        // Reset heartbeat on any message
        missedHeartbeats = 0;
        // Handle pong
        if (parsed.type === 'PONG') return;
        opts.onEvent(parsed);
      } catch {
        return;
      }
    };

    ws.onerror = (e) => {
      opts.onStatus('error');
      emitWsError({
        type: 'connection',
        message: `WebSocket error: ${String(e)}`,
        timestamp: new Date().toISOString(),
      });
    };

    ws.onclose = (e) => {
      clearHeartbeat();
      opts.onStatus('closed');
      if (stopped) return;

      // Exponential backoff with jitter
      const baseDelay = Math.min(
        30000,
        Math.pow(2, Math.min(attempt, 5)) * 1000,
      );
      const jitter = Math.random() * 1000;
      const delay = baseDelay + jitter;

      setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      clearHeartbeat();
      try {
        ws?.close();
      } catch {
        return;
      }
    },
    send: (data) => {
      try {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(data));
      } catch {
        return;
      }
    },
  };
}
