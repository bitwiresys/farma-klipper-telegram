'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { PrinterDto, PrintHistoryDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { connectBackendWs } from '../lib/ws';
import {
  getTelegramInitData,
  isTelegramWebApp,
  telegramReady,
  waitForTelegramWebApp,
} from '../lib/telegram';

type WsEvent = { type: string; payload: any };

type LoginState =
  | { state: 'need_telegram' }
  | { state: 'ready_to_login' }
  | { state: 'logging_in' }
  | { state: 'authed' };

function fmtPct(x: number | null): string {
  if (x === null) return '-';
  return `${Math.round(x * 100)}%`;
}

function fmtEta(sec: number | null): string {
  if (sec === null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return '-';
  const p = Math.pow(10, digits);
  return String(Math.round(x * p) / p);
}

function fmtPct01(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${Math.round(x * 100)}%`;
}

function fmtXYZ(p?: {
  x: number | null;
  y: number | null;
  z: number | null;
  e: number | null;
}): string {
  if (!p) return '-';
  return `X ${fmtNum(p.x, 2)} Y ${fmtNum(p.y, 2)} Z ${fmtNum(p.z, 2)}`;
}

export default function DashboardPage() {
  const { token, setToken } = useAuth();

  const [wsStatus, setWsStatus] = useState<
    'idle' | 'connecting' | 'open' | 'closed' | 'error'
  >('idle');
  const [err, setErr] = useState<string | null>(null);
  const [tgDebug, setTgDebug] = useState<{
    hasTelegram: boolean;
    initDataLen: number;
  }>({
    hasTelegram: false,
    initDataLen: 0,
  });
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [errorDetails, setErrorDetails] = useState<{
    open: boolean;
    title: string;
    message: string;
  }>({ open: false, title: '', message: '' });
  const [cancelConfirm, setCancelConfirm] = useState<{
    open: boolean;
    printerId: string;
    printerName: string;
    filename: string;
  }>({ open: false, printerId: '', printerName: '', filename: '' });
  const [loginState, setLoginState] = useState<LoginState>({
    state: 'logging_in',
  });

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

  const pause = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${printerId}/pause`, {
      token,
      method: 'POST',
    });
  };

  const resume = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${printerId}/resume`, {
      token,
      method: 'POST',
    });
  };

  const cancel = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${printerId}/cancel`, {
      token,
      method: 'POST',
    });
  };

  const load = async () => {
    if (!token) return;
    setErr(null);
    const res = await apiRequest<{ printers: PrinterDto[] }>('/api/snapshot', {
      token,
    });
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
    <AppShell wsStatus={wsStatus}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">
          {loginState.state === 'authed' ? 'Your printers' : ''}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          <Link href="/printers" className="hidden" />
        </div>
      </div>

      {loginState.state !== 'authed' && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-400">
            telegram: {tgDebug.hasTelegram ? 'yes' : 'no'}; initDataLen:{' '}
            {tgDebug.initDataLen}
          </div>
          {loginState.state === 'need_telegram' && (
            <div className="text-xs text-slate-300">
              Открой миниапку из Telegram.
              <button
                className="mt-2 w-full rounded bg-slate-950 px-3 py-2 text-xs"
                onClick={() => void pingHealth()}
              >
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
              {loginState.state === 'logging_in'
                ? 'Logging in…'
                : 'Login via Telegram'}
            </button>
          )}

          {err && (
            <div className="mt-2 break-all text-xs text-red-400">{err}</div>
          )}
        </div>
      )}

      {loginState.state === 'authed' && (
        <>
          <div className="mt-3 space-y-3">
            {printers.map((p) => {
              const st = p.snapshot.state;
              const showActions =
                st === 'printing' || st === 'paused' || st === 'error';
              return (
                <Card
                  key={p.id}
                  className={st === 'error' ? 'border-danger/40' : ''}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/printers/${p.id}`} className="block min-w-0">
                      <div className="truncate text-[16px] font-semibold text-textPrimary">
                        {p.displayName}
                      </div>
                      <div className="truncate text-xs text-textSecondary">
                        {p.modelName}
                      </div>
                    </Link>
                    <StatusPill state={st} />
                  </div>

                  <div className="mt-3">
                    <ProgressBar value01={p.snapshot.progress} />
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <div className="min-w-0 truncate text-textSecondary">
                        {p.snapshot.filename ?? '—'}
                      </div>
                      <div className="shrink-0 text-textPrimary">
                        {fmtPct(p.snapshot.progress)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                      <div className="text-textMuted">ETA</div>
                      <div className="text-textPrimary">
                        {fmtEta(p.snapshot.etaSec)}
                      </div>
                    </div>
                    <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                      <div className="text-textMuted">Temps</div>
                      <div className="text-textPrimary">
                        {p.snapshot.temps.extruder ?? '—'}/
                        {p.snapshot.temps.bed ?? '—'}
                      </div>
                    </div>
                    <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                      <div className="text-textMuted">Layers</div>
                      <div className="text-textPrimary">
                        {p.snapshot.layers.current ?? '—'}/
                        {p.snapshot.layers.total ?? '—'}
                      </div>
                    </div>
                  </div>

                  {showActions && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {st === 'printing' && (
                        <Button
                          variant="secondary"
                          onClick={() => void pause(p.id)}
                        >
                          Pause
                        </Button>
                      )}
                      {st === 'paused' && (
                        <Button
                          variant="primary"
                          onClick={() => void resume(p.id)}
                        >
                          Resume
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        onClick={() =>
                          setCancelConfirm({
                            open: true,
                            printerId: p.id,
                            printerName: p.displayName,
                            filename: p.snapshot.filename ?? '—',
                          })
                        }
                      >
                        Cancel
                      </Button>
                      {st === 'error' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setErrorDetails({
                              open: true,
                              title: p.displayName,
                              message: p.snapshot.message ?? '(no message)',
                            })
                          }
                        >
                          Details
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}

            {printers.length === 0 && (
              <EmptyState
                title="No printers"
                subtitle="Add your first printer to see status here."
                actionLabel="Add printer"
                onAction={() => {
                  window.location.href = '/printers';
                }}
              />
            )}
          </div>
        </>
      )}

      <BottomSheet
        open={errorDetails.open}
        title={`Error: ${errorDetails.title}`}
        onClose={() => setErrorDetails({ open: false, title: '', message: '' })}
      >
        <div className="text-xs text-textSecondary">{errorDetails.message}</div>
      </BottomSheet>

      <BottomSheet
        open={cancelConfirm.open}
        title="Cancel print?"
        onClose={() =>
          setCancelConfirm({
            open: false,
            printerId: '',
            printerName: '',
            filename: '',
          })
        }
      >
        <div className="text-xs text-textSecondary">
          {cancelConfirm.printerName}
        </div>
        <div className="mt-1 break-all text-xs text-textMuted">
          {cancelConfirm.filename}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setCancelConfirm({
                open: false,
                printerId: '',
                printerName: '',
                filename: '',
              })
            }
          >
            Keep printing
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const id = cancelConfirm.printerId;
              setCancelConfirm({
                open: false,
                printerId: '',
                printerName: '',
                filename: '',
              });
              void cancel(id);
            }}
          >
            Cancel print
          </Button>
        </div>
      </BottomSheet>
    </AppShell>
  );
}
