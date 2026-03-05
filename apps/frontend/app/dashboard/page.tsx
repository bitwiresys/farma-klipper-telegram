'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { OctagonX, LayoutGrid, List, Pause, Play, XCircle } from 'lucide-react';

import type { PrinterDto, PrintHistoryDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { InsetStat } from '../components/ui/InsetStat';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusPill } from '../components/ui/StatusPill';
import { GCodeThumbnail } from '../components/GCodeViewer';
import { useAuth } from '../auth/auth_context';
import { apiRequest, type ApiError } from '../lib/api';
import { useWs } from '../ws/ws_context';
import { buildPrinterLabelById } from '../lib/printer_label';

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

  const [viewMode, setViewMode] = useState<'cards' | 'compact'>('cards');
  const [groupActionConfirm, setGroupActionConfirm] = useState<{
    open: boolean;
    action: 'pause' | 'resume' | 'cancel';
    count: number;
  }>({ open: false, action: 'pause', count: 0 });

  const printerLabelById = useMemo(() => {
    return buildPrinterLabelById(printers);
  }, [printers]);

  // Group action helpers
  const printingPrinters = useMemo(
    () => printers.filter((p) => p.snapshot.state === 'printing'),
    [printers],
  );

  const pausedPrinters = useMemo(
    () => printers.filter((p) => p.snapshot.state === 'paused'),
    [printers],
  );

  const activePrinters = useMemo(
    () =>
      printers.filter(
        (p) => p.snapshot.state === 'printing' || p.snapshot.state === 'paused',
      ),
    [printers],
  );

  const pause = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    try {
      await apiRequest(`/api/printers/${printerId}/pause`, {
        token,
        method: 'POST',
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.bodyText ?? String(e));
    }
  };

  const resume = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    try {
      await apiRequest(`/api/printers/${printerId}/resume`, {
        token,
        method: 'POST',
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.bodyText ?? String(e));
    }
  };

  const cancel = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    try {
      await apiRequest(`/api/printers/${printerId}/cancel`, {
        token,
        method: 'POST',
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.bodyText ?? String(e));
    }
  };

  const emergencyStop = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    try {
      await apiRequest(`/api/printers/${printerId}/emergency_stop`, {
        token,
        method: 'POST',
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.bodyText ?? String(e));
    }
  };

  const firmwareRestart = async (printerId: string) => {
    if (!token) return;
    setErr(null);
    try {
      await apiRequest(`/api/printers/${printerId}/firmware_restart`, {
        token,
        method: 'POST',
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.bodyText ?? String(e));
    }
  };

  // Group actions
  const groupPause = async () => {
    if (!token) return;
    setErr(null);
    await Promise.all(
      printingPrinters.map((p) =>
        apiRequest(`/api/printers/${p.id}/pause`, {
          token,
          method: 'POST',
        }).catch(() => {}),
      ),
    );
  };

  const groupResume = async () => {
    if (!token) return;
    setErr(null);
    await Promise.all(
      pausedPrinters.map((p) =>
        apiRequest(`/api/printers/${p.id}/resume`, {
          token,
          method: 'POST',
        }).catch(() => {}),
      ),
    );
  };

  const groupCancel = async () => {
    if (!token) return;
    setErr(null);
    await Promise.all(
      activePrinters.map((p) =>
        apiRequest(`/api/printers/${p.id}/cancel`, {
          token,
          method: 'POST',
        }).catch(() => {}),
      ),
    );
  };

  useEffect(() => {
    if (!token) return;
    return ws.subscribe((ev) => {
      const e = ev as WsEvent;
      if (e.type === 'PRINTERS_SNAPSHOT') {
        const ps = e.payload?.printers as PrinterDto[] | undefined;
        if (!ps) return;
        setPrinters(ps);
      }
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
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-btn border border-border/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`rounded-sm p-1.5 transition ${viewMode === 'cards' ? 'bg-surface2 text-textPrimary' : 'text-textMuted'}`}
              title="Card view"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`rounded-sm p-1.5 transition ${viewMode === 'compact' ? 'bg-surface2 text-textPrimary' : 'text-textMuted'}`}
              title="Compact view"
            >
              <List size={14} />
            </button>
          </div>
          <Link href="/printers" className="hidden" />
        </div>
      </div>

      {/* Group actions bar */}
      {activePrinters.length > 1 && (
        <div className="mt-2 flex items-center gap-2 rounded-btn border border-border/45 bg-surface2/55 p-2">
          <div className="text-xs text-textMuted">
            {activePrinters.length} active
          </div>
          <div className="flex-1" />
          {printingPrinters.length > 0 && (
            <Button
              variant="secondary"
              className="px-2 py-1 text-[10px]"
              onClick={() =>
                setGroupActionConfirm({
                  open: true,
                  action: 'pause',
                  count: printingPrinters.length,
                })
              }
            >
              <Pause size={12} className="mr-1" />
              Pause all
            </Button>
          )}
          {pausedPrinters.length > 0 && (
            <Button
              variant="secondary"
              className="px-2 py-1 text-[10px]"
              onClick={() =>
                setGroupActionConfirm({
                  open: true,
                  action: 'resume',
                  count: pausedPrinters.length,
                })
              }
            >
              <Play size={12} className="mr-1" />
              Resume all
            </Button>
          )}
          <Button
            variant="secondary"
            className="px-2 py-1 text-[10px]"
            onClick={() =>
              setGroupActionConfirm({
                open: true,
                action: 'cancel',
                count: activePrinters.length,
              })
            }
          >
            <XCircle size={12} className="mr-1" />
            Cancel all
          </Button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {viewMode === 'cards' ? (
          // Card view (existing)
          printers.map((p) => {
            const st = p.snapshot.state;
            const showActions =
              st === 'printing' || st === 'paused' || st === 'error';
            const filename =
              st === 'standby'
                ? '—'
                : (p.snapshot.jobLabel ?? p.snapshot.filename ?? '—');
            return (
              <Card
                key={p.id}
                className={st === 'error' ? 'border-danger/40' : ''}
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/printers?focus=${encodeURIComponent(p.id)}`}
                    className="block min-w-0"
                  >
                    <div className="truncate text-[16px] font-semibold text-textPrimary">
                      {printerLabelById.get(p.id) ?? p.displayName}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    {(st === 'printing' || st === 'paused') && (
                      <button
                        type="button"
                        onClick={() => void emergencyStop(p.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-btn border border-danger/50 bg-surface2 text-danger transition active:scale-[0.98]"
                        aria-label="Emergency stop"
                        title="Emergency stop"
                      >
                        <OctagonX size={16} />
                      </button>
                    )}
                    <StatusPill state={st} />
                  </div>
                </div>

                {/* G-code thumbnail + progress */}
                {(st === 'printing' || st === 'paused') &&
                  p.snapshot.filename && (
                    <Link
                      href={`/printers/${p.id}/3d?filename=${encodeURIComponent(p.snapshot.filename)}`}
                      className="mt-3 block"
                    >
                      <GCodeThumbnail
                        printerId={p.id}
                        filename={p.snapshot.filename}
                        token={token ?? ''}
                        className="h-[80px] w-full object-cover"
                      />
                    </Link>
                  )}

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
                          printerName:
                            printerLabelById.get(p.id) ?? p.displayName,
                          filename:
                            p.snapshot.jobLabel ?? p.snapshot.filename ?? '—',
                        })
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {st === 'error' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void firmwareRestart(p.id)}
                    >
                      Firmware restart
                    </Button>
                  </div>
                )}

                {st === 'standby' && (
                  <div className="mt-2 text-[11px] text-textMuted">Ready</div>
                )}
              </Card>
            );
          })
        ) : (
          // Compact view - comparison mode
          <div className="space-y-2">
            {/* Progress comparison */}
            <div className="rounded-btn border border-border/45 bg-surface2/55 p-3">
              <div className="text-xs font-medium text-textPrimary">
                Progress comparison
              </div>
              <div className="mt-2 space-y-2">
                {printers
                  .filter(
                    (p) =>
                      p.snapshot.state === 'printing' ||
                      p.snapshot.state === 'paused',
                  )
                  .sort(
                    (a, b) =>
                      (b.snapshot.progress ?? 0) - (a.snapshot.progress ?? 0),
                  )
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className="w-24 truncate text-xs text-textSecondary">
                        {printerLabelById.get(p.id) ?? p.displayName}
                      </div>
                      <div className="flex-1">
                        <ProgressBar value01={p.snapshot.progress} />
                      </div>
                      <div className="w-12 text-right text-xs font-mono text-textPrimary">
                        {fmtPct(p.snapshot.progress)}
                      </div>
                      <StatusPill state={p.snapshot.state} />
                    </div>
                  ))}
                {printers.filter(
                  (p) =>
                    p.snapshot.state === 'printing' ||
                    p.snapshot.state === 'paused',
                ).length === 0 && (
                  <div className="text-xs text-textMuted">No active prints</div>
                )}
              </div>
            </div>

            {/* All printers list */}
            <div className="rounded-btn border border-border/45 bg-surface2/55 p-3">
              <div className="text-xs font-medium text-textPrimary">
                All printers
              </div>
              <div className="mt-2 divide-y divide-border/30">
                {printers.map((p) => (
                  <Link
                    key={p.id}
                    href={`/printers?focus=${encodeURIComponent(p.id)}`}
                    className="flex items-center gap-3 py-2 last:pb-0"
                  >
                    <StatusPill state={p.snapshot.state} />
                    <div className="flex-1 truncate text-xs text-textPrimary">
                      {printerLabelById.get(p.id) ?? p.displayName}
                    </div>
                    <div className="text-xs text-textMuted">
                      {p.snapshot.state === 'standby'
                        ? 'Ready'
                        : p.snapshot.state === 'printing'
                          ? fmtEta(p.snapshot.etaSec)
                          : p.snapshot.state === 'paused'
                            ? 'Paused'
                            : 'Error'}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

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
