import { getBackendWsUrl } from './env';

export type WsEvent = {
  type: string;
  payload: unknown;
};

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
    };

    ws.onmessage = (m) => {
      try {
        const parsed = JSON.parse(String(m.data)) as WsEvent;
        opts.onEvent(parsed);
      } catch {
        return;
      }
    };

    ws.onerror = () => {
      opts.onStatus('error');
    };

    ws.onclose = () => {
      opts.onStatus('closed');
      if (stopped) return;
      const delay = Math.min(30_000, Math.max(1, attempt) * 1000);
      setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
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
