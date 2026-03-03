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

import type { WsEvent } from '../lib/ws';
import { connectBackendWs } from '../lib/ws';
import { useAuth } from '../auth/auth_context';

type Listener = (ev: WsEvent) => void;

type WsState = {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  subscribe: (fn: Listener) => () => void;
  reconnect: () => void;
};

const Ctx = createContext<WsState | null>(null);

export function WsProvider({ children }: { children: ReactNode }) {
  const { token, refreshAuth } = useAuth();
  const [status, setStatus] = useState<WsState['status']>('idle');
  const connRef = useRef<{ close: () => void } | null>(null);
  const listenersRef = useRef(new Set<Listener>());
  const [epoch, setEpoch] = useState(0);

  const recentCloseRef = useRef<{ at: number; count: number }>({
    at: Date.now(),
    count: 0,
  });

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const reconnect = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    setEpoch((x) => x + 1);
  }, []);

  useEffect(() => {
    if (!token) {
      connRef.current?.close();
      connRef.current = null;
      setStatus('idle');
      return;
    }

    connRef.current?.close();
    connRef.current = connectBackendWs({
      token,
      onStatus: (s) => {
        setStatus(s);

        if (s === 'closed' || s === 'error') {
          const now = Date.now();
          const prev = recentCloseRef.current;
          const within = now - prev.at < 15_000;
          const nextCount = within ? prev.count + 1 : 1;
          recentCloseRef.current = {
            at: within ? prev.at : now,
            count: nextCount,
          };

          if (nextCount >= 3) {
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

    return () => {
      connRef.current?.close();
      connRef.current = null;
    };
  }, [token, epoch, refreshAuth]);

  const value = useMemo<WsState>(
    () => ({ status, subscribe, reconnect }),
    [status, subscribe, reconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('WsProvider missing');
  return v;
}
