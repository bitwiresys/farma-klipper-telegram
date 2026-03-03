'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { PrinterDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';

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

function statusText(p: PrinterDto): {
  text: string;
  tone: 'ok' | 'warn' | 'bad';
} {
  const state = String((p.snapshot as any)?.state ?? 'offline');
  if (p.needsRekey) return { text: 'Rekey', tone: 'warn' };
  if (state === 'offline') return { text: 'Offline', tone: 'bad' };
  if (state === 'printing') return { text: 'Printing', tone: 'ok' };
  if (state === 'paused') return { text: 'Paused', tone: 'warn' };
  if (state === 'error') return { text: 'Error', tone: 'bad' };
  if (state === 'standby') return { text: 'Ready', tone: 'ok' };
  return { text: 'Not ready', tone: 'warn' };
}

export default function PrintersPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const [printers, setPrinters] = useState<PrinterDto[]>([]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [activePrinterId, setActivePrinterId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    setErr(null);
    const p = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    setPrinters(p.printers);
  };

  useEffect(() => {
    void load();
  }, [token]);

  const testPrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    setBusy(true);
    try {
      await apiRequest(`/api/printers/${id}/test`, { token, method: 'POST' });
    } finally {
      setBusy(false);
    }
  };

  const rescanPrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    setBusy(true);
    try {
      await apiRequest(`/api/printers/${id}/rescan`, { token, method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removePrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    setBusy(true);
    try {
      await apiRequest(`/api/printers/${id}`, { token, method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const active = useMemo(() => {
    if (!activePrinterId) return null;
    return printers.find((p) => p.id === activePrinterId) ?? null;
  }, [activePrinterId, printers]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Printers</div>
        <div className="flex gap-2">
          <Link href="/printers/new">
            <Button variant="primary">+ Add</Button>
          </Link>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <div className="mt-3 space-y-3">
          {printers.map((p) => {
            const st = statusText(p);
            const dotClass =
              st.tone === 'ok'
                ? 'bg-accentGreen'
                : st.tone === 'bad'
                  ? 'bg-accentRed'
                  : 'bg-accentAmber';

            return (
              <Card key={p.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/printers/${p.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-textPrimary">
                      {p.displayName}
                    </div>
                    <div className="mt-0.5 text-xs text-textSecondary">
                      {p.modelName}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-textSecondary">
                      <div className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <div>{st.text}</div>
                    </div>
                  </Link>

                  <button
                    className="h-11 w-11 rounded-btn border border-border/70 bg-surface2 text-xs text-textSecondary"
                    onClick={() => {
                      setActivePrinterId(p.id);
                      setActionsOpen(true);
                    }}
                    type="button"
                    aria-label="Actions"
                  >
                    ⋯
                  </button>
                </div>
              </Card>
            );
          })}

          {printers.length === 0 && (
            <EmptyState
              title="Add your first printer"
              subtitle="Connect Moonraker to start live monitoring and printing."
              actionLabel="Add printer"
              onAction={() => {
                window.location.href = '/printers/new';
              }}
            />
          )}

          <BottomSheet
            open={actionsOpen}
            onClose={() => setActionsOpen(false)}
            title={active ? active.displayName : 'Printer'}
          >
            <div className="space-y-2">
              <Button
                variant="primary"
                onClick={() => {
                  if (!activePrinterId) return;
                  void testPrinter(activePrinterId);
                }}
                disabled={!activePrinterId || busy}
              >
                {busy ? 'Testing…' : 'Test connection'}
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  if (!activePrinterId) return;
                  void rescanPrinter(activePrinterId);
                }}
                disabled={!activePrinterId || busy}
              >
                Rescan specs
              </Button>

              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmRemoveOpen(true);
                }}
                disabled={!activePrinterId || busy}
              >
                Remove
              </Button>
            </div>
          </BottomSheet>

          <BottomSheet
            open={confirmRemoveOpen}
            onClose={() => setConfirmRemoveOpen(false)}
            title="Remove printer?"
          >
            <div className="space-y-3">
              <div className="text-xs text-textSecondary">
                {active ? active.displayName : 'Printer'}
              </div>
              <div className="text-xs text-textMuted">
                History and presets will stay.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmRemoveOpen(false)}
                  disabled={busy}
                >
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (!activePrinterId) return;
                    void removePrinter(activePrinterId);
                    setConfirmRemoveOpen(false);
                    setActionsOpen(false);
                  }}
                  disabled={!activePrinterId || busy}
                >
                  Remove
                </Button>
              </div>
            </div>
          </BottomSheet>
        </div>
      )}
    </>
  );
}
