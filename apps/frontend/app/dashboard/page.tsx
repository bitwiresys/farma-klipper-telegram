'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { PrinterDto, PrintHistoryDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { InsetStat } from '../components/ui/InsetStat';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { useWs } from '../ws/ws_context';

type WsEvent = { type: string; payload: any };

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
  const { token } = useAuth();
  const ws = useWs();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
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
    return ws.subscribe((ev) => {
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
        const _h = e.payload?.history as PrintHistoryDto | undefined;
        void _h;
      }
    });
  }, [token, ws]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Your printers</div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          <Link href="/printers" className="hidden" />
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {printers.map((p) => {
          const st = p.snapshot.state;
          const showActions =
            st === 'printing' || st === 'paused' || st === 'error';
          const filename =
            st === 'standby' ? '—' : (p.snapshot.filename ?? '—');
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
                    {filename}
                  </div>
                  <div className="shrink-0 text-textPrimary">
                    {fmtPct(p.snapshot.progress)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <InsetStat label="ETA" value={fmtEta(p.snapshot.etaSec)} />
                <InsetStat
                  label="TEMPS"
                  value={`${p.snapshot.temps.extruder ?? '—'}/${p.snapshot.temps.bed ?? '—'}`}
                />
                <InsetStat
                  label="LAYERS"
                  value={`${p.snapshot.layers.current ?? '—'}/${p.snapshot.layers.total ?? '—'}`}
                />
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
                    <Button variant="primary" onClick={() => void resume(p.id)}>
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

              {st === 'standby' && (
                <div className="mt-2 text-[11px] text-textMuted">Ready</div>
              )}
            </Card>
          );
        })}

        {printers.length === 0 && !err && (
          <div className="mt-6">
            <EmptyState
              title="No printers"
              subtitle="Add a printer to see live status."
              actionLabel="Add printer"
              onAction={() => router.push('/printers/new')}
            />
          </div>
        )}

        {err && (
          <div className="mt-3 break-all text-xs text-red-400">{err}</div>
        )}
      </div>

      <BottomSheet
        open={errorDetails.open}
        onClose={() => setErrorDetails({ open: false, title: '', message: '' })}
        title={errorDetails.title}
      >
        <div className="text-xs text-textSecondary">{errorDetails.message}</div>
      </BottomSheet>

      <BottomSheet
        open={cancelConfirm.open}
        onClose={() =>
          setCancelConfirm({
            open: false,
            printerId: '',
            printerName: '',
            filename: '',
          })
        }
        title="Cancel print?"
      >
        <div className="text-xs text-textSecondary">
          This will stop the print on {cancelConfirm.printerName}.
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
            onClick={() =>
              void (async () => {
                await cancel(cancelConfirm.printerId);
                setCancelConfirm({
                  open: false,
                  printerId: '',
                  printerName: '',
                  filename: '',
                });
              })()
            }
          >
            Cancel
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
