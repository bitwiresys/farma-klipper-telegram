'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PrintHistoryDto, PrinterDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { connectBackendWs } from '../lib/ws';

type StatusFilter = 'all' | 'completed' | 'error';

const PAGE_SIZE = 20;

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDur(sec: number | null): string {
  if (sec === null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function HistoryPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [history, setHistory] = useState<PrintHistoryDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const printerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of printers) m.set(p.id, p.displayName);
    return m;
  }, [printers]);

  const load = async (opts?: { reset?: boolean; pages?: number }) => {
    if (!token) return;
    setErr(null);

    const p = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    setPrinters(p.printers);

    const reset = opts?.reset ?? false;
    const nextPagesLoaded =
      typeof opts?.pages === 'number' ? opts.pages : reset ? 1 : pagesLoaded;
    const limit = PAGE_SIZE * nextPagesLoaded;

    const qs = new URLSearchParams({
      limit: String(limit),
      offset: '0',
      status,
    });

    const h = await apiRequest<{ history: PrintHistoryDto[] }>(
      `/api/history?${qs.toString()}`,
      { token },
    );
    setPagesLoaded(nextPagesLoaded);
    setHistory(h.history);
    setHasMore(h.history.length === limit);
  };

  const loadMore = async () => {
    if (!token) return;
    const next = pagesLoaded + 1;
    await load({ pages: next });
  };

  useEffect(() => {
    setPagesLoaded(1);
    void load({ reset: true });
  }, [token, status]);

  useEffect(() => {
    if (!token) return;
    let closed = false;

    const conn = connectBackendWs({
      token,
      onStatus: () => undefined,
      onEvent: (ev) => {
        if (closed) return;
        if (ev.type !== 'HISTORY_EVENT') return;
        const p = ev.payload as any;
        const h = p?.history as PrintHistoryDto | undefined;
        if (!h) return;

        if (status !== 'all' && h.status !== status) return;

        setHistory((prev) => {
          const maxItems = PAGE_SIZE * pagesLoaded;
          const idx = prev.findIndex((x) => x.id === h.id);
          if (idx !== -1) {
            const copy = [...prev];
            copy[idx] = h;
            return copy;
          }
          const next = [h, ...prev];
          return next.slice(0, maxItems);
        });
      },
    });

    return () => {
      closed = true;
      conn.close();
    };
  }, [token, status, pagesLoaded]);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">History</div>
        <button
          className="rounded bg-slate-950 px-3 py-2 text-xs"
          onClick={() => void load({ reset: true })}
        >
          Refresh
        </button>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <>
          <div className="mt-3 flex gap-2">
            <select
              className="w-full rounded bg-slate-950 p-2 text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">all</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
          </div>

          <div className="mt-3 space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="rounded border border-slate-800 bg-slate-900/40 p-3 text-xs"
              >
                <div className="flex items-start justify-between">
                  <div className="font-medium">{h.filename}</div>
                  <div className="text-slate-400">{h.status}</div>
                </div>
                <div className="mt-1 text-slate-400">
                  printer: {printerNameById.get(h.printerId) ?? h.printerId}
                </div>
                <div className="mt-1 text-slate-400">
                  startedAt: {fmtDateTime(h.startedAt)}
                </div>
                {h.endedAt && (
                  <div className="mt-1 text-slate-400">
                    endedAt: {fmtDateTime(h.endedAt)}
                  </div>
                )}
                <div className="mt-1 text-slate-400">
                  duration: {fmtDur(h.printDurationSec)} (total{' '}
                  {fmtDur(h.totalDurationSec)})
                </div>
                {h.errorMessage && (
                  <div className="mt-2 break-all text-red-300">
                    {h.errorMessage}
                  </div>
                )}
              </div>
            ))}
            {history.length === 0 && (
              <div className="text-xs text-slate-400">No history.</div>
            )}

            {history.length > 0 && hasMore && (
              <button
                className="w-full rounded bg-slate-950 px-3 py-2 text-xs"
                onClick={() => void loadMore()}
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
