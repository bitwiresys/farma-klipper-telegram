'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import type { PrinterDto } from '../../lib/dto';

import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../auth/auth_context';
import { apiRequest } from '../../lib/api';
import { connectBackendWs } from '../../lib/ws';

type WsEvent = { type: string; payload: any };

function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return '-';
  const p = Math.pow(10, digits);
  return String(Math.round(x * p) / p);
}

function fmtPct01(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${Math.round(x * 100)}%`;
}

function fmtEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PrinterDetailsPage() {
  const { token } = useAuth();
  const params = useParams() as any;
  const printerId = String(params?.id ?? '');

  const [err, setErr] = useState<string | null>(null);
  const [printer, setPrinter] = useState<PrinterDto | null>(null);

  const state = printer?.snapshot?.state ?? 'offline';

  const load = async () => {
    if (!token || !printerId) return;
    setErr(null);
    const res = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    const p = res.printers.find((x) => x.id === printerId) ?? null;
    setPrinter(p);
  };

  useEffect(() => {
    void load();
  }, [token, printerId]);

  useEffect(() => {
    if (!token || !printerId) return;
    let closed = false;

    const conn = connectBackendWs({
      token,
      onStatus: () => undefined,
      onEvent: (ev) => {
        if (closed) return;
        const e = ev as WsEvent;
        if (e.type !== 'PRINTER_STATUS') return;
        const p = e.payload?.printer as PrinterDto | undefined;
        if (!p) return;
        if (p.id !== printerId) return;
        setPrinter(p);
      },
    });

    return () => {
      closed = true;
      conn.close();
    };
  }, [token, printerId]);

  const controls = useMemo(() => {
    const pause = async () => {
      if (!token) return;
      setErr(null);
      await apiRequest(`/api/printers/${printerId}/pause`, {
        token,
        method: 'POST',
      });
    };

    const resume = async () => {
      if (!token) return;
      setErr(null);
      await apiRequest(`/api/printers/${printerId}/resume`, {
        token,
        method: 'POST',
      });
    };

    const cancel = async () => {
      if (!token) return;
      setErr(null);
      await apiRequest(`/api/printers/${printerId}/cancel`, {
        token,
        method: 'POST',
      });
    };

    const emergencyStop = async () => {
      if (!token) return;
      setErr(null);
      await apiRequest(`/api/printers/${printerId}/emergency_stop`, {
        token,
        method: 'POST',
      });
    };

    return { pause, resume, cancel, emergencyStop };
  }, [token, printerId]);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Printer</div>
          <div className="text-xs text-slate-400">{printerId.slice(0, 8)}</div>
        </div>
        <Link
          className="rounded bg-slate-950 px-3 py-2 text-xs"
          href="/printers"
        >
          Back
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && !printer && (
        <div className="mt-3 text-xs text-slate-400">Loading…</div>
      )}

      {token && printer && (
        <div className="mt-3 space-y-3">
          <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium">{printer.displayName}</div>
                <div className="text-xs text-slate-400">
                  {printer.modelName}
                </div>
              </div>
              <div className="text-xs text-slate-200">{state}</div>
            </div>

            <div className="mt-2 text-xs text-slate-300">
              <div className="text-slate-400">file</div>
              <div className="break-all">
                {printer.snapshot.filename ?? '(no file)'}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">progress</div>
                <div>{fmtPct01(printer.snapshot.progress)}</div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">ETA</div>
                <div>{fmtEta(printer.snapshot.etaSec)}</div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">temps</div>
                <div>
                  E {fmtNum(printer.snapshot.temps.extruder, 1)} / B{' '}
                  {fmtNum(printer.snapshot.temps.bed, 1)}
                </div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">layers</div>
                <div>
                  {fmtNum(printer.snapshot.layers.current, 0)}/
                  {fmtNum(printer.snapshot.layers.total, 0)}
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                className="rounded bg-slate-950 px-2 py-2 text-xs"
                onClick={() => void load()}
              >
                Refresh
              </button>
              <button
                className="rounded bg-slate-950 px-2 py-2 text-xs"
                onClick={() => void controls.pause()}
                disabled={state !== 'printing'}
              >
                Pause
              </button>
              <button
                className="rounded bg-slate-950 px-2 py-2 text-xs"
                onClick={() => void controls.resume()}
                disabled={state !== 'paused'}
              >
                Resume
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                className="rounded bg-red-950/40 px-2 py-2 text-xs"
                onClick={() => {
                  if (!confirm('Cancel print?')) return;
                  void controls.cancel();
                }}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-950 px-2 py-2 text-xs"
                onClick={() => {
                  if (
                    !confirm(
                      'EMERGENCY STOP? This will immediately stop the printer.',
                    )
                  )
                    return;
                  void controls.emergencyStop();
                }}
              >
                Emergency stop
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs font-medium">Specs</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">bed</div>
                <div>
                  {fmtNum(printer.bedX, 0)}×{fmtNum(printer.bedY, 0)}×
                  {fmtNum(printer.bedZ, 0)}
                </div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">nozzle</div>
                <div>{fmtNum(printer.nozzleDiameter, 2)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
