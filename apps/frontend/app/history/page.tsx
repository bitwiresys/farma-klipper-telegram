'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PrintHistoryDto, PrinterDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';

type StatusFilter = 'all' | 'completed' | 'error' | 'cancelled';

export default function HistoryPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [history, setHistory] = useState<PrintHistoryDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);

  const printerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of printers) m.set(p.id, p.displayName);
    return m;
  }, [printers]);

  const load = async () => {
    if (!token) return;
    setErr(null);

    const p = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    setPrinters(p.printers);

    const qs = new URLSearchParams({
      limit: '50',
      offset: '0',
      status,
    });

    const h = await apiRequest<{ history: PrintHistoryDto[] }>(
      `/api/history?${qs.toString()}`,
      { token },
    );
    setHistory(h.history);
  };

  useEffect(() => {
    void load();
  }, [token, status]);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">History</div>
        <button
          className="rounded bg-slate-950 px-3 py-2 text-xs"
          onClick={() => void load()}
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
              <option value="cancelled">cancelled</option>
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
                  startedAt: {h.startedAt}
                </div>
                {h.endedAt && (
                  <div className="mt-1 text-slate-400">
                    endedAt: {h.endedAt}
                  </div>
                )}
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
          </div>
        </>
      )}
    </AppShell>
  );
}
