'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ApiError } from '../lib/api';

import { apiRequest } from '../lib/api';
import {
  getTelegramInitData,
  isTelegramWebApp,
  telegramReady,
  waitForTelegramWebApp,
} from '../lib/telegram';

type AuthPhase =
  | 'booting'
  | 'authorizing'
  | 'ready'
  | 'forbidden'
  | 'need_restart';

const LS_TOKEN = 'farma_token_v1';
const LS_INIT_DATA = 'farma_tg_init_data_v1';

type AuthState = {
  token: string | null;
  setToken: (t: string | null) => void;
  phase: AuthPhase;
  refreshAuth: (opts?: { reason?: string }) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [phase, setPhase] = useState<AuthPhase>('booting');

  const setToken = useCallback((t: string | null) => {
    setTokenState(t);
    try {
      if (t) localStorage.setItem(LS_TOKEN, t);
      else localStorage.removeItem(LS_TOKEN);
    } catch {
      return;
    }
  }, []);

  const loginViaTelegram = useCallback(async (): Promise<string> => {
    await waitForTelegramWebApp(2500);
    telegramReady();

    if (!isTelegramWebApp()) {
      throw new Error('Telegram WebApp is not available');
    }

    const initDataLive = getTelegramInitData();
    let initData = initDataLive;
    if (!initData) {
      try {
        initData = localStorage.getItem(LS_INIT_DATA) ?? '';
      } catch {
        initData = '';
      }
    }
    if (!initData) throw new Error('Telegram initData is empty');

    if (initDataLive) {
      try {
        localStorage.setItem(LS_INIT_DATA, initData);
      } catch {
        // ignore
      }
    }

    const res = await apiRequest<{ token: string }>('/api/auth/telegram', {
      method: 'POST',
      body: { initData },
    });
    return res.token;
  }, []);

  const refreshAuth = useCallback(
    async (opts?: { reason?: string }) => {
      void opts;
      setPhase('authorizing');
      try {
        const newToken = await loginViaTelegram();
        setToken(newToken);
        setPhase('ready');
      } catch {
        setToken(null);
        setPhase('need_restart');
      }
    },
    [loginViaTelegram, setToken],
  );

  useEffect(() => {
    // bootstrap
    (async () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(LS_TOKEN);
      } catch {
        stored = null;
      }

      if (stored) {
        setTokenState(stored);
        setPhase('authorizing');
        try {
          await apiRequest('/api/me', { token: stored });
          setPhase('ready');
          return;
        } catch (e) {
          const apiErr = e as Partial<ApiError>;
          if (apiErr?.status === 403) {
            setTokenState(stored);
            setPhase('forbidden');
            return;
          }
          // try re-auth below
        }
      }

      setPhase('authorizing');
      try {
        const newToken = await loginViaTelegram();
        setToken(newToken);
        setPhase('ready');
      } catch (e) {
        const apiErr = e as Partial<ApiError>;
        if (apiErr?.status === 403) {
          setToken(null);
          setPhase('forbidden');
          return;
        }
        setToken(null);
        setPhase('need_restart');
      }
    })();
  }, [loginViaTelegram, setToken]);

  const value = useMemo(
    () => ({ token, setToken, phase, refreshAuth }),
    [token, setToken, phase, refreshAuth],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
