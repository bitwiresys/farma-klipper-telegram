'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { PrinterDto } from '../lib/dto';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { InsetStat } from '../components/ui/InsetStat';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusPill } from '../components/ui/StatusPill';
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

function fmtPct100(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${Math.round(x)}%`;
}

function fmtMmS(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${fmtNum(x, 1)} mm/s`;
}

function fmtMm3S(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${fmtNum(x, 1)} mm³/s`;
}

export default function PrintersPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const [printers, setPrinters] = useState<PrinterDto[]>([]);

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
            const state = String((p.snapshot as any)?.state ?? 'offline');
            const filename = (p.snapshot as any)?.filename as string | null;
            const progress = (p.snapshot as any)?.progress as number | null;
            const etaSec = (p.snapshot as any)?.etaSec as number | null;
            const layers = (p.snapshot as any)?.layers as
              | { current: number | null; total: number | null }
              | undefined;

            const liveVelocityMmS = (p.snapshot as any)?.speed
              ?.liveVelocityMmS as number | null | undefined;
            const liveExtruderVelocityMmS = (p.snapshot as any)?.speed
              ?.liveExtruderVelocityMmS as number | null | undefined;

            // Default filament diameter. If you want this per-printer, we'll add it to printer model/settings.
            const filamentDiaMm = 1.75;
            const filamentAreaMm2 = Math.PI * Math.pow(filamentDiaMm / 2, 2);
            const flowMm3S =
              liveExtruderVelocityMmS === null ||
              liveExtruderVelocityMmS === undefined
                ? null
                : liveExtruderVelocityMmS * filamentAreaMm2;
            const fan = (p.snapshot as any)?.fans?.part?.speed as
              | number
              | null
              | undefined;

            return (
              <Link key={p.id} href={`/printers/${p.id}`} className="block">
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-textPrimary">
                        {p.displayName}
                      </div>
                      <div className="mt-1 text-xs text-textSecondary">
                        {p.modelName}
                      </div>
                      {(state === 'printing' || state === 'paused') &&
                        filename && (
                          <div className="mt-1 truncate text-[11px] text-textMuted">
                            {filename}
                          </div>
                        )}
                    </div>
                    <StatusPill state={state} />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="text-[28px] font-semibold leading-none text-textPrimary">
                      {fmtPct01(progress)}
                    </div>
                    <div className="text-right text-xs text-textMuted">
                      ETA{' '}
                      {etaSec === null || etaSec === undefined
                        ? '-'
                        : `${Math.max(0, Math.floor(etaSec / 60))}m`}
                    </div>
                  </div>

                  <div className="mt-3">
                    <ProgressBar value01={progress ?? null} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <InsetStat
                      label="EXTRUDER"
                      value={`${(p.snapshot as any)?.temps?.extruder ?? '—'}°C`}
                      right={
                        (p.snapshot as any)?.temps?.extruderTarget
                          ? `target ${(p.snapshot as any)?.temps?.extruderTarget}`
                          : undefined
                      }
                    />
                    <InsetStat
                      label="BED"
                      value={`${(p.snapshot as any)?.temps?.bed ?? '—'}°C`}
                      right={
                        (p.snapshot as any)?.temps?.bedTarget
                          ? `target ${(p.snapshot as any)?.temps?.bedTarget}`
                          : undefined
                      }
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <InsetStat
                      label="LAYERS"
                      value={`${layers?.current ?? '—'} / ${layers?.total ?? '—'}`}
                    />
                    <InsetStat
                      label="STATE"
                      value={String(state).toUpperCase()}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <InsetStat label="SPEED" value={fmtMmS(liveVelocityMmS)} />
                    <InsetStat label="FLOW" value={fmtMm3S(flowMm3S)} />
                    <InsetStat
                      label="FAN"
                      value={fmtPct100(
                        fan === null || fan === undefined ? null : fan * 100,
                      )}
                    />
                  </div>
                </Card>
              </Link>
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
        </div>
      )}
    </>
  );
}
