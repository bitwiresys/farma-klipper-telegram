'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  computePresetCompatibilityReasons,
  type CompatibilityReason,
} from '@farma/shared';

import { AppShell } from '../../components/AppShell';
import { useAuth } from '../../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../../lib/api';
import { connectBackendWs } from '../../lib/ws';
import type { PresetDto, PrinterDto } from '../../lib/dto';

type WsEvent = { type: string; payload: any };

type PrintResultRow = {
  printerId: string;
  displayName: string;
  ok: boolean;
  reasons: CompatibilityReason[];
};

function reasonToText(r: CompatibilityReason): string {
  return r;
}

function stateBadge(state: string): string {
  if (state === 'standby') return 'READY';
  if (state === 'printing' || state === 'paused') return 'BUSY';
  if (state === 'offline') return 'OFFLINE';
  return 'NOT_READY';
}

export default function PresetDetailPage() {
  const params = useParams();
  const presetId = String((params as any).id ?? '');

  const { token } = useAuth();

  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetDto | null>(null);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [results, setResults] = useState<PrintResultRow[] | null>(null);

  const load = async () => {
    if (!token) return;
    setErr(null);
    const p = await apiRequest<{ preset: PresetDto }>(
      `/api/presets/${presetId}`,
      {
        token,
      },
    );
    setPreset(p.preset);

    const s = await apiRequest<{ printers: PrinterDto[] }>('/api/snapshot', {
      token,
    });
    setPrinters(s.printers);
  };

  useEffect(() => {
    void load();
  }, [token, presetId]);

  useEffect(() => {
    if (!token) return;
    let closed = false;

    const conn = connectBackendWs({
      token,
      onStatus: () => undefined,
      onEvent: (ev) => {
        if (closed) return;
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
        if (e.type === 'PRESET_UPDATED') {
          const id = String(e.payload?.presetId ?? '');
          if (id === presetId) void load();
        }
      },
    });

    return () => {
      closed = true;
      conn.close();
    };
  }, [token, presetId]);

  const printersWithReasons = useMemo(() => {
    if (!preset)
      return [] as Array<{ p: PrinterDto; reasons: CompatibilityReason[] }>;
    return printers
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((p) => {
        const reasons = computePresetCompatibilityReasons({
          presetRules: preset.compatibilityRules,
          printer: {
            modelId: p.modelId,
            nozzleDiameter: p.nozzleDiameter,
            bedX: p.bedX,
            bedY: p.bedY,
            snapshot: p.snapshot as any,
          },
        });
        return { p, reasons };
      });
  }, [printers, preset]);

  const selectablePrinterIds = useMemo(() => {
    return printersWithReasons
      .filter((x) => x.reasons.length === 0)
      .map((x) => x.p.id);
  }, [printersWithReasons]);

  const selectAllCompatible = () => {
    setSelected(new Set(selectablePrinterIds));
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const submitPrint = async () => {
    if (!token) return;
    if (!preset) return;

    const printerIds = Array.from(selected);
    if (printerIds.length === 0) return;

    setPrinting(true);
    setErr(null);
    setResults(null);

    try {
      await apiRequest(`/api/presets/${preset.id}/print`, {
        token,
        method: 'POST',
        body: { printerIds },
      });

      const rows: PrintResultRow[] = printersWithReasons
        .filter((x) => printerIds.includes(x.p.id))
        .map((x) => ({
          printerId: x.p.id,
          displayName: x.p.displayName,
          ok: true,
          reasons: [],
        }));

      setResults(rows);
    } catch (e) {
      const ae = e as ApiError;
      const body = tryParseApiErrorBody(ae.bodyText) as any;

      if (
        ae.status === 409 &&
        body?.error === 'BLOCKED' &&
        Array.isArray(body?.reasons)
      ) {
        const blocked = new Map<string, CompatibilityReason[]>(
          body.reasons.map((x: any) => [
            String(x.printerId),
            (x.reasons ?? []) as CompatibilityReason[],
          ]),
        );

        const rows: PrintResultRow[] = printersWithReasons
          .filter((x) => Array.from(selected).includes(x.p.id))
          .map((x) => {
            const br = blocked.get(x.p.id) ?? [];
            return {
              printerId: x.p.id,
              displayName: x.p.displayName,
              ok: br.length === 0,
              reasons: br,
            };
          });

        setResults(rows);
      } else {
        setErr(ae.bodyText);
      }
    } finally {
      setPrinting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Preset</div>
        <Link
          href="/presets"
          className="rounded bg-slate-950 px-3 py-2 text-xs"
        >
          Back
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && preset && (
        <>
          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex gap-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-slate-950">
                {preset.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preset.thumbnailUrl}
                    alt="thumbnail"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                    no thumb
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">
                  {preset.title}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {preset.plasticType}
                </div>
                {preset.description && (
                  <div className="mt-2 text-xs text-slate-300">
                    {preset.description}
                  </div>
                )}
              </div>
              <div
                className="h-6 w-6 shrink-0 rounded border border-slate-700"
                style={{ background: preset.colorHex }}
                title={preset.colorHex}
              />
            </div>

            {preset.gcodeMeta && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-slate-950 p-2">
                  <div className="text-slate-400">estimated</div>
                  <div>{preset.gcodeMeta.estimated_time_sec ?? '-'}</div>
                </div>
                <div className="rounded bg-slate-950 p-2">
                  <div className="text-slate-400">nozzle</div>
                  <div>{preset.gcodeMeta.gcode_nozzle_diameter ?? '-'}</div>
                </div>
                <div className="rounded bg-slate-950 p-2">
                  <div className="text-slate-400">filament type</div>
                  <div>{preset.gcodeMeta.filament_type ?? '-'}</div>
                </div>
                <div className="rounded bg-slate-950 p-2">
                  <div className="text-slate-400">filament name</div>
                  <div>{preset.gcodeMeta.filament_name ?? '-'}</div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs font-medium">Compatibility rules</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">models</div>
                <div>
                  {preset.compatibilityRules.allowedModelIds.length === 0
                    ? 'any'
                    : preset.compatibilityRules.allowedModelIds.length}
                </div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">nozzles</div>
                <div>
                  {preset.compatibilityRules.allowedNozzleDiameters.length === 0
                    ? 'any'
                    : preset.compatibilityRules.allowedNozzleDiameters
                        .slice()
                        .sort((a, b) => a - b)
                        .join(', ')}
                </div>
              </div>
              <div className="rounded bg-slate-950 p-2">
                <div className="text-slate-400">min bed</div>
                <div>
                  {preset.compatibilityRules.minBedX}×
                  {preset.compatibilityRules.minBedY}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">Printers</div>
              <button
                className="rounded bg-slate-950 px-3 py-2 text-xs"
                onClick={() => selectAllCompatible()}
                type="button"
              >
                Select all compatible
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {printersWithReasons.map(({ p, reasons }) => {
                const disabled = reasons.length > 0;
                const checked = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    className={
                      'w-full rounded border p-3 text-left ' +
                      (disabled
                        ? 'border-slate-800 bg-slate-950/30 text-slate-500'
                        : 'border-slate-800 bg-slate-950 text-slate-200')
                    }
                    disabled={disabled}
                    onClick={() => toggleSelected(p.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">
                          {p.displayName}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {p.modelName}
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="text-slate-400">
                          {stateBadge(p.snapshot.state)}
                        </div>
                        <div
                          className={
                            checked ? 'text-emerald-300' : 'text-slate-500'
                          }
                        >
                          {checked ? 'selected' : 'tap to select'}
                        </div>
                      </div>
                    </div>

                    {disabled && (
                      <div className="mt-2 text-xs text-red-300">
                        {reasons.map(reasonToText).join(', ')}
                      </div>
                    )}
                  </button>
                );
              })}

              {printersWithReasons.length === 0 && (
                <div className="text-xs text-slate-400">No printers.</div>
              )}
            </div>
          </div>

          <button
            className="mt-3 w-full rounded bg-slate-200 px-3 py-3 text-sm font-semibold text-slate-950"
            onClick={() => setConfirmOpen(true)}
            disabled={printing || selected.size === 0}
            type="button"
          >
            {printing ? 'Starting…' : `START PRINT (${selected.size})`}
          </button>

          {confirmOpen && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
              <div className="w-full max-w-xl rounded border border-slate-800 bg-slate-950 p-4">
                <div className="text-sm font-medium">Confirm print</div>
                <div className="mt-2 text-xs text-slate-300">
                  Печатать на {selected.size} принтерах?
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    className="rounded bg-slate-900 px-3 py-2 text-xs"
                    onClick={() => setConfirmOpen(false)}
                    disabled={printing}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950"
                    onClick={() => void submitPrint()}
                    disabled={printing}
                    type="button"
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>
          )}

          {results && (
            <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-xs font-medium">Results</div>
              <div className="mt-2 space-y-2">
                {results.map((r) => (
                  <div
                    key={r.printerId}
                    className="rounded bg-slate-950 p-2 text-xs"
                  >
                    <div className="flex items-start justify-between">
                      <div className="font-medium">{r.displayName}</div>
                      <div
                        className={r.ok ? 'text-emerald-300' : 'text-red-300'}
                      >
                        {r.ok ? 'OK' : 'FAILED'}
                      </div>
                    </div>
                    {!r.ok && r.reasons.length > 0 && (
                      <div className="mt-1 text-red-300">
                        {r.reasons.map(reasonToText).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
