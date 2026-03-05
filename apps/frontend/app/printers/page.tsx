'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { OctagonX } from 'lucide-react';

import type { PrinterDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { InsetStat } from '../components/ui/InsetStat';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAuth } from '../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../lib/api';
import { buildPrinterLabelById } from '../lib/printer_label';
import { useWs } from '../ws/ws_context';

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
  const ws = useWs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  // Query params for focus and open (sheet)
  const focusId = useMemo(() => {
    const raw = String(searchParams?.get('focus') ?? '').trim();
    return raw ? raw : null;
  }, [searchParams]);

  const openId = useMemo(() => {
    const raw = String(searchParams?.get('open') ?? '').trim();
    return raw ? raw : null;
  }, [searchParams]);

  const labelById = useMemo(() => buildPrinterLabelById(printers), [printers]);

  // Active printer for edit sheet
  const activePrinter = useMemo(() => {
    if (!openId) return null;
    return printers.find((p) => p.id === openId) ?? null;
  }, [openId, printers]);

  // Edit form state
  const [displayName, setDisplayName] = useState('');
  const [modelId, setModelId] = useState('');
  const [moonrakerBaseUrl, setMoonrakerBaseUrl] = useState('');
  const [moonrakerApiKey, setMoonrakerApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  // Subscribe to WS events
  useEffect(() => {
    if (!token) return;

    // Request models
    ws.send({
      type: 'REQ_PRINTER_MODELS',
      payload: { requestId: ws.nextRequestId() },
    });

    return ws.subscribe((ev) => {
      const e = ev as any;
      if (e.type === 'PRINTERS_SNAPSHOT') {
        const ps = e.payload?.printers as PrinterDto[] | undefined;
        if (!ps) return;
        setPrinters(ps);
        return;
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
        return;
      }
      if (e.type === 'PRINTER_MODELS_SNAPSHOT') {
        const ms = e.payload?.models as Array<{ id: string; name: string }> | undefined;
        if (ms) setModels(ms);
      }
    });
  }, [token, ws]);

  // Scroll to focused printer
  useEffect(() => {
    if (!focusId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`printer-${focusId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [focusId, printers.length]);

  // Sync form state when active printer changes
  useEffect(() => {
    if (!activePrinter) return;
    setDisplayName(activePrinter.displayName ?? '');
    setModelId(activePrinter.modelId ?? '');
    setMoonrakerBaseUrl('');
    setMoonrakerApiKey('');
  }, [activePrinter?.id]);

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

  const closeSheet = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    router.replace(url.pathname + url.search);
  };

  const save = async () => {
    if (!token || !openId) return;
    setEditErr(null);
    setSaving(true);
    try {
      await apiRequest(`/api/printers/${openId}`, {
        token,
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          modelId,
          moonrakerBaseUrl: moonrakerBaseUrl.trim() || undefined,
          moonrakerApiKey: moonrakerApiKey.trim() || undefined,
        },
      });
      closeSheet();
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setEditErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token || !openId) return;
    setEditErr(null);
    setSaving(true);
    try {
      await apiRequest(`/api/printers/${openId}`, {
        token,
        method: 'DELETE',
      });
      closeSheet();
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setEditErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = !displayName.trim() || !modelId.trim() || saving;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Printers</div>
        <div className="flex gap-2">
          <Link href="/printers/new">
            <Button variant="primary">+ Add</Button>
          </Link>
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
            const filename =
              ((p.snapshot as any)?.jobLabel as string | null | undefined) ??
              ((p.snapshot as any)?.filename as string | null);
            const progress = (p.snapshot as any)?.progress as number | null;
            const etaSec = (p.snapshot as any)?.etaSec as number | null;
            const layers = (p.snapshot as any)?.layers as
              | { current: number | null; total: number | null }
              | undefined;

            const liveVelocityMmS = (p.snapshot as any)?.speed
              ?.liveVelocityMmS as number | null | undefined;
            const liveExtruderVelocityMmS = (p.snapshot as any)?.speed
              ?.liveExtruderVelocityMmS as number | null | undefined;

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
              <button
                key={p.id}
                type="button"
                className="block w-full text-left"
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('open', p.id);
                  router.push(url.pathname + url.search);
                }}
              >
                <div
                  id={`printer-${p.id}`}
                  className={
                    focusId === p.id
                      ? 'ring-2 ring-accentCyan/60 ring-offset-2 ring-offset-surface1 rounded-card'
                      : ''
                  }
                >
                  <Card className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-textPrimary">
                          {labelById.get(p.id) ?? p.displayName}
                        </div>
                        {(state === 'printing' || state === 'paused') &&
                          filename && (
                            <div className="mt-1 truncate text-[11px] text-textMuted">
                              {filename}
                            </div>
                          )}
                      </div>
                      <div className="flex items-center gap-2">
                        {(state === 'printing' || state === 'paused') && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              void emergencyStop(p.id);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-btn border border-danger/50 bg-surface2 text-danger transition active:scale-[0.98]"
                            aria-label="Emergency stop"
                            title="Emergency stop"
                          >
                            <OctagonX size={16} />
                          </button>
                        )}
                        <StatusPill state={state} />
                      </div>
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
                </div>
              </button>
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

      {/* Edit Printer BottomSheet */}
      <BottomSheet
        open={!!openId}
        onClose={closeSheet}
        title="Edit printer"
      >
        {!activePrinter && (
          <div className="text-xs text-textSecondary">Loading…</div>
        )}

        {activePrinter && (
          <div className="space-y-3">
            {editErr && <div className="break-all text-xs text-red-400">{editErr}</div>}

            <Card className="p-3">
              <div className="text-xs font-medium text-textPrimary">Fields</div>
              <div className="mt-2 grid gap-2">
                <input
                  className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />

                <select
                  className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  <option value="">Model…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <input
                  className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  placeholder="Moonraker URL (leave empty to keep current)"
                  value={moonrakerBaseUrl}
                  onChange={(e) => setMoonrakerBaseUrl(e.target.value)}
                />

                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    placeholder="API Key (leave empty to keep current)"
                    type={showKey ? 'text' : 'password'}
                    value={moonrakerApiKey}
                    onChange={(e) => setMoonrakerApiKey(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs font-medium text-textPrimary">
                Detected specs
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-btn border border-border/45 bg-surface2/55 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="text-textMuted">Bed size</div>
                  <div className="text-textPrimary">
                    {fmtNum(activePrinter.bedX, 0)}×{fmtNum(activePrinter.bedY, 0)}×
                    {fmtNum(activePrinter.bedZ, 0)}
                  </div>
                </div>
                <div className="rounded-btn border border-border/45 bg-surface2/55 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="text-textMuted">Nozzle</div>
                  <div className="text-textPrimary">
                    {fmtNum(activePrinter.nozzleDiameter, 2)}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-textMuted">
                Specs are detected automatically from Moonraker.
              </div>
            </Card>

            <Button
              className="w-full"
              variant="primary"
              onClick={() => void save()}
              disabled={saveDisabled}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button
                className="w-full"
                variant="ghost"
                onClick={closeSheet}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => setConfirmRemoveOpen(true)}
                disabled={saving}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Confirm Remove BottomSheet */}
      <BottomSheet
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        title="Remove printer?"
      >
        {activePrinter && (
          <div className="space-y-3">
            <div className="text-xs text-textSecondary">
              {activePrinter.displayName}
            </div>
            <div className="text-xs text-textMuted">
              History and presets will stay.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmRemoveOpen(false)}
                disabled={saving}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => void remove()}
                disabled={saving}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
