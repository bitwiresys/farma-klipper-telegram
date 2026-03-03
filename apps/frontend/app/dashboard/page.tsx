'use client';

import { useEffect, useState } from 'react';

import type { PrinterDto, PrintHistoryDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { connectBackendWs } from '../lib/ws';
import { getTelegramInitData, isTelegramWebApp, telegramReady, waitForTelegramWebApp } from '../lib/telegram';

type WsEvent = { type: string; payload: any };

type LoginState =
  | { state: 'need_telegram' }
  | { state: 'ready_to_login' }
  | { state: 'logging_in' }
  | { state: 'authed' };

function fmtPct(x: number | null): string {
  if (x === null) return '-';
  return `${Math.round(x * 1000) / 10}%`;
}

function fmtEta(sec: number | null): string {
  if (sec === null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DashboardPage() {
  const { token, setToken } = useAuth();

  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [tgDebug, setTgDebug] = useState<{ hasTelegram: boolean; initDataLen: number }>({
    hasTelegram: false,
    initDataLen: 0,
  });
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [loginState, setLoginState] = useState<LoginState>({ state: 'logging_in' });

  useEffect(() => {
    if (token) {
      setLoginState({ state: 'authed' });
      return;
    }
    (async () => {
      await waitForTelegramWebApp(2500);
      telegramReady();
      const hasTelegram = isTelegramWebApp();
      const initDataLen = getTelegramInitData().length;
      setTgDebug({ hasTelegram, initDataLen });
      if (!hasTelegram) {
        setLoginState({ state: 'need_telegram' });
        return;
      }

      if (initDataLen > 0) {
        await login();
        return;
      }

      setLoginState({ state: 'need_telegram' });
    })();
  }, [token]);

  const login = async () => {
    setErr(null);
    setLoginState({ state: 'logging_in' });
    try {
      await waitForTelegramWebApp(2500);
      telegramReady();
      const initData = getTelegramInitData();
      if (!initData) throw new Error('Telegram initData is empty');
      const res = await apiRequest<{ token: string }>('/api/auth/telegram', {
        method: 'POST',
        body: { initData },
      });
      setToken(res.token);
      setLoginState({ state: 'authed' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoginState({ state: 'need_telegram' });
    }
  };

  const load = async () => {
    if (!token) return;
    setErr(null);
    const res = await apiRequest<{ printers: PrinterDto[] }>('/api/snapshot', { token });
    setPrinters(res.printers);
  };

  useEffect(() => {
    if (!token) return;
    void load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let closed = false;

    const conn = connectBackendWs({
      token,
      onStatus: (s) => {
        if (closed) return;
        setWsStatus(s);
      },
      onEvent: (ev) => {
        const e = ev as WsEvent;
        if (e.type === 'PRINTER_STATUS') {
          const p = e.payload?.printer as PrinterDto | undefined;
          if (!p) return;
          setPrinters((prev) => {
            const idx = prev.findIndex((x) => x.id === p.id);
            if (idx === -1) return [p, ...prev];
            const copy = [...prev];
            copy[idx] = p;
            return copy;
          });
        }
        if (e.type === 'HISTORY_EVENT') {
          // dashboard doesn't render history yet, but keep parser stable
          const _h = e.payload?.history as PrintHistoryDto | undefined;
          void _h;
        }
      },
    });

    return () => {
      closed = true;
      conn.close();
    };
  }, [token]);

  const pingHealth = async () => {
    setErr(null);
    try {
      const res = await apiRequest('/api/health');
      setErr(JSON.stringify(res));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Dashboard</div>
        <div className="text-xs text-slate-400">ws: {wsStatus}</div>
      </div>

      {loginState.state !== 'authed' && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-400">
            telegram: {tgDebug.hasTelegram ? 'yes' : 'no'}; initDataLen: {tgDebug.initDataLen}
          </div>
          {loginState.state === 'need_telegram' && (
            <div className="text-xs text-slate-300">
              Открой миниапку из Telegram.
              <button className="mt-2 w-full rounded bg-slate-950 px-3 py-2 text-xs" onClick={() => void pingHealth()}>
                Ping /api/health
              </button>
            </div>
          )}

          {loginState.state !== 'need_telegram' && (
            <button
              className="w-full rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950"
              onClick={() => void login()}
              disabled={loginState.state === 'logging_in'}
            >
              {loginState.state === 'logging_in' ? 'Logging in…' : 'Login via Telegram'}
            </button>
          )}

          {err && <div className="mt-2 break-all text-xs text-red-400">{err}</div>}
        </div>
      )}

      {loginState.state === 'authed' && (
        <>
          <button className="mt-3 w-full rounded bg-slate-950 px-3 py-2 text-xs" onClick={() => void load()}>
            Refresh snapshot
          </button>

          <div className="mt-3 space-y-3">
            {printers.map((p) => (
              <div key={p.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">{p.displayName}</div>
                    <div className="text-xs text-slate-400">{p.modelName}</div>
                  </div>
                  {p.needsRekey && <div className="text-xs text-amber-400">needs rekey</div>}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-slate-950 p-2">
                    <div className="text-slate-400">state</div>
                    <div>{p.snapshot.state}</div>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <div className="text-slate-400">progress</div>
                    <div>{fmtPct(p.snapshot.progress)}</div>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <div className="text-slate-400">ETA</div>
                    <div>{fmtEta(p.snapshot.etaSec)}</div>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <div className="text-slate-400">temps</div>
                    <div>
                      E {p.snapshot.temps.extruder ?? '-'} / B {p.snapshot.temps.bed ?? '-'}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-300">
                  <div className="text-slate-400">file</div>
                  <div className="break-all">{p.snapshot.filename ?? '-'}</div>
                </div>
              </div>
            ))}

            {printers.length === 0 && <div className="text-xs text-slate-400">No printers.</div>}
          </div>
        </>
      )}
    </AppShell>
  );
}
