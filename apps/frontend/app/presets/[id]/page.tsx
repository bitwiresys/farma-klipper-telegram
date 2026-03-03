'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { computePresetCompatibilityReasons } from '../../lib/compatibility';

import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { useAuth } from '../../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../../lib/api';
import { useWs } from '../../ws/ws_context';
import type { CompatibilityReason, PresetDto, PrinterDto } from '../../lib/dto';

type WsEvent = { type: string; payload: any };

type PrintResultRow = {
  printerId: string;
  displayName: string;
  ok: boolean;
  reasons: CompatibilityReason[];
};

function reasonToText(r: CompatibilityReason): string {
  if (r === 'MODEL_NOT_ALLOWED') return 'Model not allowed';
  if (r === 'NOZZLE_NOT_ALLOWED') return 'Nozzle not allowed';
  if (r === 'BED_TOO_SMALL') return 'Bed too small';
  if (r === 'PRINTER_BUSY') return 'Printer busy';
  if (r === 'PRINTER_NOT_READY') return 'Printer not ready';
  if (r === 'OFFLINE') return 'Offline';
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
  const ws = useWs();

  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetDto | null>(null);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [selectOpen, setSelectOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [results, setResults] = useState<PrintResultRow[] | null>(null);

  const [selectAll, setSelectAll] = useState(false);

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
      if (e.type === 'PRESET_UPDATED') {
        const id = String(e.payload?.presetId ?? '');
        if (id === presetId) void load();
      }
    });
  }, [token, presetId, ws]);

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

  useEffect(() => {
    if (!selectOpen) return;
    if (!selectAll) return;
    selectAllCompatible();
  }, [selectAll, selectablePrinterIds, selectOpen]);

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
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Preset</div>
        <Link href="/presets">
          <Button variant="ghost">Back</Button>
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-textSecondary">Login required.</div>
      )}

      {token && err && (
        <div className="mt-3 break-all text-xs text-red-400">{err}</div>
      )}

      {token && preset && (
        <>
          <Card className="mt-3 p-3">
            <div className="h-[200px] w-full overflow-hidden rounded-card bg-surface2">
              {preset.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preset.thumbnailUrl}
                  alt="thumbnail"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-textMuted">
                  Thumbnail will appear after first deploy
                </div>
              )}
            </div>

            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-textPrimary">
                  {preset.title}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Chip>{preset.plasticType}</Chip>
                  <div
                    className="h-4 w-4 rounded-full border border-border/70"
                    style={{ background: preset.colorHex || '#ffffff' }}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card className="mt-3 p-3">
            <div className="text-xs font-medium text-textPrimary">Metadata</div>
            <div className="mt-2 space-y-1 text-xs text-textSecondary">
              <div>
                Estimated time: {preset.gcodeMeta?.estimated_time_sec ?? '—'}
              </div>
              <div>
                Nozzle: {preset.gcodeMeta?.gcode_nozzle_diameter ?? '—'}
              </div>
              <div>Filament: {preset.gcodeMeta?.filament_name ?? '—'}</div>
              <div>Filament type: {preset.gcodeMeta?.filament_type ?? '—'}</div>
            </div>
          </Card>

          <Card className="mt-3 p-3">
            <div className="text-xs font-medium text-textPrimary">
              Compatibility
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip>
                {preset.compatibilityRules.allowedModelIds.length > 0
                  ? 'models'
                  : 'models any'}
              </Chip>
              <Chip>
                {preset.compatibilityRules.allowedNozzleDiameters.length > 0
                  ? `nozzle ${preset.compatibilityRules.allowedNozzleDiameters
                      .slice()
                      .sort((a, b) => a - b)
                      .join(', ')}`
                  : 'nozzle any'}
              </Chip>
              <Chip>
                bed {preset.compatibilityRules.minBedX}×
                {preset.compatibilityRules.minBedY}
              </Chip>
            </div>
          </Card>

          <Button
            className="mt-3 w-full"
            variant="primary"
            onClick={() => {
              setResults(null);
              setSelectOpen(true);
            }}
            disabled={printing}
          >
            Print
          </Button>

          {results && (
            <Card className="mt-3 p-3">
              <div className="text-xs font-medium text-textPrimary">
                Results
              </div>
              <div className="mt-2 space-y-2">
                {results.map((r) => (
                  <div
                    key={r.printerId}
                    className="rounded-card border border-border/70 bg-surface2 p-2 text-xs"
                  >
                    <div className="flex items-start justify-between">
                      <div className="font-medium text-textPrimary">
                        {r.displayName}
                      </div>
                      <div
                        className={r.ok ? 'text-accentGreen' : 'text-accentRed'}
                      >
                        {r.ok ? 'OK' : 'FAILED'}
                      </div>
                    </div>
                    {!r.ok && r.reasons.length > 0 && (
                      <div className="mt-1 text-textSecondary">
                        {r.reasons.map(reasonToText).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <BottomSheet
            open={selectOpen}
            onClose={() => setSelectOpen(false)}
            title="Select printers"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-textSecondary">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={(e) => setSelectAll(e.target.checked)}
                  />
                  Select all compatible
                </label>
                <button
                  className="text-xs text-accentCyan"
                  onClick={() => selectAllCompatible()}
                  type="button"
                >
                  Fill
                </button>
              </div>

              <div className="space-y-2">
                {printersWithReasons.map(({ p, reasons }) => {
                  const disabled = reasons.length > 0;
                  const checked = selected.has(p.id);

                  return (
                    <button
                      key={p.id}
                      className={
                        'w-full rounded-card border p-3 text-left ' +
                        (disabled
                          ? 'border-border/50 bg-surface2 text-textMuted'
                          : 'border-border/70 bg-surface text-textPrimary')
                      }
                      disabled={disabled}
                      onClick={() => toggleSelected(p.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold">
                            {p.displayName}
                          </div>
                          <div className="mt-0.5 text-[11px] text-textSecondary">
                            {p.modelName}
                          </div>
                        </div>
                        <div className="text-right text-[11px]">
                          <div className="text-textSecondary">
                            {stateBadge(p.snapshot.state)}
                          </div>
                          <div
                            className={
                              checked ? 'text-accentGreen' : 'text-textMuted'
                            }
                          >
                            {checked ? 'selected' : 'tap to select'}
                          </div>
                        </div>
                      </div>

                      {disabled && (
                        <div className="mt-2 text-[11px] text-accentRed">
                          {reasons.map(reasonToText).join(', ')}
                        </div>
                      )}
                    </button>
                  );
                })}

                {printersWithReasons.length === 0 && (
                  <div className="text-xs text-textSecondary">No printers.</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSelectOpen(false)}
                  disabled={printing}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setConfirmOpen(true)}
                  disabled={printing || selected.size === 0}
                >
                  Start on {selected.size}
                </Button>
              </div>
            </div>
          </BottomSheet>

          <BottomSheet
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            title="Confirm print"
          >
            <div className="space-y-3">
              <div className="text-xs text-textSecondary">
                Start printing preset on {selected.size} printers?
              </div>

              <div className="space-y-2">
                {Array.from(selected)
                  .map((id) => printers.find((p) => p.id === id))
                  .filter(Boolean)
                  .map((p) => (
                    <div
                      key={(p as PrinterDto).id}
                      className="flex items-center justify-between rounded-card border border-border/70 bg-surface2 p-2 text-xs"
                    >
                      <div className="font-medium text-textPrimary">
                        {(p as PrinterDto).displayName}
                      </div>
                      <div className="text-textSecondary">
                        {stateBadge((p as PrinterDto).snapshot.state)}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmOpen(false)}
                  disabled={printing}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void submitPrint()}
                  disabled={printing}
                >
                  {printing ? 'Starting…' : 'Start print'}
                </Button>
              </div>
            </div>
          </BottomSheet>
        </>
      )}
    </>
  );
}
