 'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PrinterDto, PrintHistoryDto } from '@farma/shared';

import { useAuth } from './auth/auth_context';
import { apiRequest, type ApiError } from './lib/api';
import { connectBackendWs } from './lib/ws';
import { getTelegramInitData, isTelegramWebApp } from './lib/telegram';

type Tab = 'dashboard' | 'printers' | 'history' | 'presets' | 'settings';

type WsEvent = { type: string; payload: any };

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

export default function Home() {
  const { token, setToken } = useAuth();

  const [tab, setTab] = useState<Tab>('dashboard');
  const [me, setMe] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');

  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [history, setHistory] = useState<PrintHistoryDto[]>([]);

  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [newPrinter, setNewPrinter] = useState({
    displayName: '',
    modelId: '',
    moonrakerBaseUrl: '',
    moonrakerApiKey: '',
  });

  const hasTelegram = useMemo(() => isTelegramWebApp(), []);

  const doLogin = async () => {
    setErr(null);
    try {
      const initData = getTelegramInitData();
      if (!initData) throw new Error('Telegram initData is empty');

      const res = await apiRequest<{ token: string }>('/api/auth/telegram', {
        method: 'POST',
        body: { initData },
      });
      setToken(res.token);
    } catch (e) {
      const msg = e && typeof e === 'object' && 'status' in (e as any) ? `API ${(e as ApiError).status}` : (e instanceof Error ? e.message : String(e));
      setErr(msg);
    }
  };

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    (async () => {
      try {
        const res = await apiRequest('/api/me', { token });
        setMe(res);
      } catch (e) {
        setMe(null);
      }
    })();
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
          const h = e.payload?.history as PrintHistoryDto | undefined;
          if (!h) return;
          setHistory((prev) => [h, ...prev].slice(0, 200));
        }
      },
    });

    return () => {
      closed = true;
      conn.close();
    };
  }, [token]);

  const loadSnapshot = async () => {
    if (!token) return;
    setErr(null);
    try {
      const res = await apiRequest<{ printers: PrinterDto[] }>('/api/snapshot', { token });
      setPrinters(res.printers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const loadPrinters = async () => {
    if (!token) return;
    setErr(null);
    const res = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', { token });
    setPrinters(res.printers);
  };

  const loadModels = async () => {
    if (!token) return;
    const res = await apiRequest<{ models: Array<{ id: string; name: string }> }>('/api/printer-models', { token });
    setModels(res.models);
  };

  const loadHistory = async () => {
    if (!token) return;
    const res = await apiRequest<{ history: PrintHistoryDto[] }>('/api/history', { token });
    setHistory(res.history);
  };

  useEffect(() => {
    if (!token) return;
    void loadSnapshot();
    void loadModels();
    void loadHistory();
  }, [token]);

  const createPrinter = async () => {
    if (!token) return;
    setErr(null);
    await apiRequest('/api/printers', { token, method: 'POST', body: newPrinter });
    setNewPrinter({ displayName: '', modelId: '', moonrakerBaseUrl: '', moonrakerApiKey: '' });
    await loadPrinters();
  };

  const updatePrinter = async (p: PrinterDto, patch: any) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${p.id}`, { token, method: 'PATCH', body: patch });
    await loadPrinters();
  };

  const deletePrinter = async (p: PrinterDto) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${p.id}`, { token, method: 'DELETE' });
    await loadPrinters();
  };

  const testPrinter = async (p: PrinterDto) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${p.id}/test`, { token, method: 'POST' });
  };

  const rescanPrinter = async (p: PrinterDto) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${p.id}/rescan`, { token, method: 'POST' });
    await loadPrinters();
  };

  const tabs: Array<{ id: Tab; title: string }> = [
    { id: 'dashboard', title: 'Dashboard' },
    { id: 'printers', title: 'Printers' },
    { id: 'history', title: 'History' },
    { id: 'presets', title: 'Presets' },
    { id: 'settings', title: 'Settings' },
  ];

  return (
    <main className="mx-auto max-w-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Farma</div>
          <div className="text-xs text-slate-400">READ-ONLY mode</div>
        </div>

        <div className="text-right text-xs text-slate-400">
          <div>{token ? 'auth: ok' : 'auth: none'}</div>
          <div>ws: {wsStatus}</div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-200">
        <div className="font-medium">READ-ONLY</div>
        <div className="mt-1 text-slate-300">
          Управление печатью отключено. Backend и UI не содержат действий pause/resume/cancel.
        </div>
      </div>

      {!token && (
        <div className="mt-4 rounded border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-sm font-medium">Login</div>
          <div className="mt-2 text-xs text-slate-300">
            Telegram WebApp: {hasTelegram ? 'yes' : 'no'}
          </div>
          <button
            className="mt-3 w-full rounded bg-slate-200 px-3 py-2 text-sm font-medium text-slate-950"
            onClick={() => void doLogin()}
          >
            Login via Telegram
          </button>
          {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
        </div>
      )}

      {token && (
        <>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={
                  'rounded px-2 py-2 text-xs ' +
                  (tab === t.id ? 'bg-slate-200 text-slate-950' : 'bg-slate-900/40 text-slate-200')
                }
                onClick={() => setTab(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>

          {err && <div className="mt-3 text-xs text-red-400">{err}</div>}

          {tab === 'dashboard' && (
            <section className="mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Dashboard</div>
                <button className="rounded bg-slate-900/40 px-3 py-1 text-xs" onClick={() => void loadSnapshot()}>
                  Refresh
                </button>
              </div>
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
            </section>
          )}

          {tab === 'printers' && (
            <section className="mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Printers</div>
                <button className="rounded bg-slate-900/40 px-3 py-1 text-xs" onClick={() => void loadPrinters()}>
                  Refresh
                </button>
              </div>

              <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-xs font-medium">Add printer</div>
                <div className="mt-2 grid gap-2">
                  <input
                    className="w-full rounded bg-slate-950 p-2 text-xs"
                    placeholder="displayName"
                    value={newPrinter.displayName}
                    onChange={(e) => setNewPrinter((p) => ({ ...p, displayName: e.target.value }))}
                  />
                  <select
                    className="w-full rounded bg-slate-950 p-2 text-xs"
                    value={newPrinter.modelId}
                    onChange={(e) => setNewPrinter((p) => ({ ...p, modelId: e.target.value }))}
                  >
                    <option value="">model...</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded bg-slate-950 p-2 text-xs"
                    placeholder="moonrakerBaseUrl (http://...:7125)"
                    value={newPrinter.moonrakerBaseUrl}
                    onChange={(e) => setNewPrinter((p) => ({ ...p, moonrakerBaseUrl: e.target.value }))}
                  />
                  <input
                    className="w-full rounded bg-slate-950 p-2 text-xs"
                    placeholder="moonrakerApiKey"
                    value={newPrinter.moonrakerApiKey}
                    onChange={(e) => setNewPrinter((p) => ({ ...p, moonrakerApiKey: e.target.value }))}
                  />
                  <button
                    className="w-full rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950"
                    onClick={() => void createPrinter()}
                  >
                    Create
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {printers.map((p) => (
                  <div key={p.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-medium">{p.displayName}</div>
                        <div className="text-xs text-slate-400">{p.modelName}</div>
                      </div>
                      <div className="text-xs text-slate-400">{p.id.slice(0, 8)}</div>
                    </div>

                    {p.needsRekey && (
                      <div className="mt-2 rounded bg-amber-950/40 p-2 text-xs text-amber-300">
                        Printer требует rekey (apiKeyEncrypted не расшифровывается).
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void testPrinter(p)}>
                        test
                      </button>
                      <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void rescanPrinter(p)}>
                        rescan
                      </button>
                      <button className="rounded bg-red-950/40 px-2 py-2 text-xs" onClick={() => void deletePrinter(p)}>
                        delete
                      </button>
                    </div>

                    <button
                      className="mt-2 w-full rounded bg-slate-950 px-2 py-2 text-xs"
                      onClick={() => void updatePrinter(p, { displayName: p.displayName })}
                    >
                      save (no changes)
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'history' && (
            <section className="mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">History</div>
                <button className="rounded bg-slate-900/40 px-3 py-1 text-xs" onClick={() => void loadHistory()}>
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded border border-slate-800 bg-slate-900/40 p-3 text-xs">
                    <div className="flex items-start justify-between">
                      <div className="font-medium">{h.filename}</div>
                      <div className="text-slate-400">{h.status}</div>
                    </div>
                    <div className="mt-1 text-slate-400">{h.startedAt}</div>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-slate-400">No history.</div>}
              </div>
            </section>
          )}

          {tab === 'presets' && (
            <section className="mt-4 rounded border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-sm font-medium">Presets</div>
              <div className="mt-1 text-xs text-slate-400">Coming soon</div>
            </section>
          )}

          {tab === 'settings' && (
            <section className="mt-4 rounded border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-sm font-medium">Settings</div>
              <div className="mt-1 text-xs text-slate-400">Coming soon</div>
              <div className="mt-3 text-xs text-slate-300">me: {me ? JSON.stringify(me) : '-'}</div>
              <button className="mt-3 w-full rounded bg-slate-950 px-3 py-2 text-xs" onClick={() => setToken(null)}>
                Logout
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
