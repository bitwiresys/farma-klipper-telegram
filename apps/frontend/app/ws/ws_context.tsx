'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { WsEvent, WsError } from '../lib/ws';
import { connectBackendWs, subscribeWsErrors } from '../lib/ws';
import { useAuth } from '../auth/auth_context';

type Listener = (ev: WsEvent) => void;

type WsState = {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  subscribe: (fn: Listener) => () => void;
  reconnect: () => void;
  send: (data: unknown) => void;
  nextRequestId: () => string;
  errors: WsError[];
};

const Ctx = createContext<WsState | null>(null);

export function WsProvider({ children }: { children: ReactNode }) {
  const { token, refreshAuth } = useAuth();
  const [status, setStatus] = useState<WsState['status']>('idle');
  const [errors, setErrors] = useState<WsError[]>([]);
  const connRef = useRef<{ close: () => void } | null>(null);
  const sendRef = useRef<((data: unknown) => void) | null>(null);
  const listenersRef = useRef(new Set<Listener>());
  const [epoch, setEpoch] = useState(0);

  const requestSeqRef = useRef(0);

  // Increased threshold to avoid unnecessary re-auth
  const recentCloseRef = useRef<{ at: number; count: number }>({
    at: Date.now(),
    count: 0,
  });

  // Subscribe to WS errors globally
  useEffect(() => {
    return subscribeWsErrors((err) => {
      setErrors((prev) => {
        const next = [...prev, err].slice(-20); // Keep last 20 errors
        return next;
      });
    });
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const reconnect = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    sendRef.current = null;
    setEpoch((x) => x + 1);
  }, []);

  const send = useCallback((data: unknown) => {
    sendRef.current?.(data);
  }, []);

  const nextRequestId = useCallback(() => {
    requestSeqRef.current += 1;
    return `${Date.now()}_${requestSeqRef.current}`;
  }, []);

  useEffect(() => {
    if (!token) {
      connRef.current?.close();
      connRef.current = null;
      setStatus('idle');
      return;
    }

    connRef.current?.close();
    const conn = connectBackendWs({
      token,
      onStatus: (s) => {
        setStatus(s);

        if (s === 'closed' || s === 'error') {
          const now = Date.now();
          const prev = recentCloseRef.current;
          // Only count closes within 60 seconds (increased from 15)
          const within = now - prev.at < 60_000;
          const nextCount = within ? prev.count + 1 : 1;
          recentCloseRef.current = {
            at: within ? prev.at : now,
            count: nextCount,
          };

          // Only re-auth after 5 closes in 60s (increased from 3 in 15s)
          if (nextCount >= 5) {
            void refreshAuth({ reason: 'ws_unstable' });
          }
        }
      },
      onEvent: (ev) => {
        for (const fn of listenersRef.current) {
          try {
            fn(ev);
          } catch {
            continue;
          }
        }
      },
    });

    connRef.current = conn;
    sendRef.current = conn.send;

    return () => {
      connRef.current?.close();
      connRef.current = null;
      sendRef.current = null;
    };
  }, [token, epoch, refreshAuth]);

  const value = useMemo<WsState>(
    () => ({ status, subscribe, reconnect, send, nextRequestId, errors }),
    [status, subscribe, reconnect, send, nextRequestId, errors],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('WsProvider missing');
  return v;
}
