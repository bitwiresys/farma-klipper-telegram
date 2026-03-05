'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import type { CompatibilityReason, PresetDto, PrinterDto } from '../lib/dto';

import { computePresetCompatibilityReasons } from '../lib/compatibility';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { SearchInput } from '../components/ui/SearchInput';
import { useAuth } from '../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../lib/api';
import { getBackendBaseUrl } from '../lib/env';
import { buildPrinterLabelById } from '../lib/printer_label';
import { useWs } from '../ws/ws_context';

type WsEvent = { type: string; payload: any };

type PrinterModelRow = {
  id: string;
  name: string;
};

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

function withCacheBust(url: string): string {
  const t = String(Date.now());
  return url.includes('?') ? `${url}&t=${t}` : `${url}?t=${t}`;
}

function textColorForBg(hex: string): string {
  const h = String(hex ?? '').trim();
  const m = h.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '#e6e8ee';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#0b1220' : '#f8fafc';
}

function fmtNozzle(xs: number[]): string {
  if (xs.length === 0) return 'nozzle any';
  const sorted = [...xs].sort((a, b) => a - b);
  return `${sorted.join(', ')}`;
}

function resolveThumbUrl(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = (getBackendBaseUrl() ?? '').replace(/\/+$/, '');
  if (!base) return raw;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

export default function PresetsPage() {
  const { token } = useAuth();
  const ws = useWs();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [models, setModels] = useState<PrinterModelRow[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [query, setQuery] = useState('');

  const focusId = useMemo(() => {
    const raw = String(searchParams?.get('focus') ?? '').trim();
    return raw ? raw : null;
  }, [searchParams]);

  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [selectOpen, setSelectOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<PrintResultRow[] | null>(null);

  const modelNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of models) m.set(x.id, x.name);
    return m;
  }, [models]);

  const requestAll = () => {
    if (!token) return;
    setErr(null);
    ws.send({
      type: 'REQ_PRINTER_MODELS',
      payload: { requestId: ws.nextRequestId() },
    });
    ws.send({
      type: 'REQ_PRESETS',
      payload: { requestId: ws.nextRequestId() },
    });
  };

  useEffect(() => {
    requestAll();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    return ws.subscribe((ev) => {
      const e = ev as WsEvent;
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
        const ms = (e.payload as any)?.models as PrinterModelRow[] | undefined;
        if (!ms) return;
        setModels(ms);
        return;
      }
      if (e.type === 'PRESETS_SNAPSHOT') {
        const ps = (e.payload as any)?.presets as PresetDto[] | undefined;
        if (!ps) return;
        setPresets(ps);
        return;
      }
      if (e.type === 'PRESET_UPDATED') {
        ws.send({
          type: 'REQ_PRESETS',
          payload: { requestId: ws.nextRequestId() },
        });
      }
    });
  }, [token, ws]);

  const active = useMemo(() => {
    if (!activeId) return null;
    return presets.find((x) => x.id === activeId) ?? null;
  }, [activeId, presets]);

  const printerLabelById = useMemo(() => {
    return buildPrinterLabelById(printers);
  }, [printers]);

  const printersWithReasons = useMemo(() => {
    if (!active)
      return [] as Array<{ p: PrinterDto; reasons: CompatibilityReason[] }>;
    return printers
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((p) => {
        const reasons = computePresetCompatibilityReasons({
          presetRules: active.compatibilityRules,
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
  }, [active, printers]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const selectedBlocking = useMemo(() => {
    const ids = selected;
    const m = new Map<string, CompatibilityReason[]>();
    for (const row of printersWithReasons) {
      if (!ids.has(row.p.id)) continue;
      if (row.reasons.length > 0) m.set(row.p.id, row.reasons);
    }
    return m;
  }, [printersWithReasons, selected]);

  const hasBlockingSelected = selectedBlocking.size > 0;

  const submitPrint = async () => {
    if (!token) return;
    if (!active) return;

    const printerIds = Array.from(selected);
    if (printerIds.length === 0) return;

    setPrinting(true);
    setErr(null);
    setResults(null);

    try {
      await apiRequest(`/api/presets/${active.id}/print`, {
        token,
        method: 'POST',
        body: { printerIds },
      });

      const rows: PrintResultRow[] = printersWithReasons
        .filter((x) => printerIds.includes(x.p.id))
        .map((x) => ({
          printerId: x.p.id,
          displayName: printerLabelById.get(x.p.id) ?? x.p.displayName,
          ok: true,
          reasons: [],
        }));
      setResults(rows);

      router.push('/printers');
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
          .filter((x) => printerIds.includes(x.p.id))
          .map((x) => {
            const br = blocked.get(x.p.id) ?? [];
            return {
              printerId: x.p.id,
              displayName: printerLabelById.get(x.p.id) ?? x.p.displayName,
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
      setSelectOpen(false);
      setOpen(false);
    }
  };

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...presets].sort((a, b) => a.title.localeCompare(b.title));
    if (!q) return list;
    return list.filter((p) => {
      const hay = `${p.title} ${p.plasticType}`.toLowerCase();
      return hay.includes(q);
    });
  }, [presets]);

  // Scroll to focused preset
  useEffect(() => {
    if (!focusId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`preset-${focusId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [focusId, presets.length]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Presets</div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              window.location.href = '/presets/new';
            }}
          >
            + Add
          </Button>
        </div>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <>
          <div className="mt-3">
            <SearchInput
              placeholder="Search presets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="mt-3 space-y-3">
            {sorted.map((p) => (
              <button
                key={p.id}
                id={`preset-${p.id}`}
                className={
                  'w-full text-left ' +
                  (focusId === p.id
                    ? 'ring-2 ring-accentCyan/60 ring-offset-2 ring-offset-surface1 rounded-card'
                    : '')
                }
                type="button"
                onClick={() => {
                  setActiveId(p.id);
                  setOpen(true);
                }}
              >
                <Card className="p-3">
                  <div className="flex gap-3">
                    <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-btn bg-surface2">
                      {p.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveThumbUrl(withCacheBust(p.thumbnailUrl))}
                          alt="thumbnail"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] text-textMuted">
                          —
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="block truncate text-[14px] font-semibold text-textPrimary">
                        {p.title}
                      </div>

                      <div className="mt-1 flex items-center gap-2">
                        <div
                          className="inline-flex items-center rounded-full border border-border/45 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          style={{
                            background: p.colorHex || '#ffffff',
                            color: textColorForBg(p.colorHex || '#ffffff'),
                          }}
                        >
                          {p.plasticType}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <Chip>
                          {p.compatibilityRules.allowedModelIds.length > 0
                            ? p.compatibilityRules.allowedModelIds
                                .map((id) => modelNameById.get(id) ?? id)
                                .join(', ')
                            : 'Any model'}
                        </Chip>
                        <Chip>
                          Nozzle{' '}
                          {fmtNozzle(
                            p.compatibilityRules.allowedNozzleDiameters,
                          )}
                        </Chip>
                        <Chip>
                          {p.compatibilityRules.minBedX}×
                          {p.compatibilityRules.minBedY}
                        </Chip>
                      </div>
                    </div>

                    <div className="flex flex-col justify-end">
                      <Button
                        variant="primary"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveId(p.id);
                          setOpen(true);
                          setSelected(new Set());
                          setResults(null);
                          setSelectOpen(true);
                        }}
                      >
                        Print
                      </Button>
                    </div>
                  </div>
                </Card>
              </button>
            ))}

            {sorted.length === 0 && (
              <div className="pt-2">
                <EmptyState
                  title="Upload your first preset"
                  subtitle="Add a .gcode preset to start prints from the library."
                  actionLabel="Add preset"
                  onAction={() => {
                    window.location.href = '/presets/new';
                  }}
                />
              </div>
            )}
          </div>

          <BottomSheet
            open={open}
            onClose={() => setOpen(false)}
            title="Preset"
          >
            {!active && (
              <div className="text-xs text-textSecondary">
                No preset selected.
              </div>
            )}

            {active && (
              <div className="space-y-3">
                {active.thumbnailUrl && (
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded-card border border-border/70 bg-surface2"
                    onClick={() => setPreviewOpen(true)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveThumbUrl(withCacheBust(active.thumbnailUrl))}
                      alt="thumbnail"
                      className="h-40 w-full object-cover"
                    />
                  </button>
                )}

                <div className="rounded-card border border-border/70 bg-surface2 p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-textPrimary">
                        {active.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div
                          className="inline-flex items-center rounded-full border border-border/45 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          style={{
                            background: active.colorHex || '#ffffff',
                            color: textColorForBg(active.colorHex || '#ffffff'),
                          }}
                        >
                          {active.plasticType}
                        </div>
                      </div>
                    </div>
                  </div>

                  {active.description && (
                    <div className="mt-3 break-words rounded-btn border border-border/70 bg-surface p-2 text-textSecondary">
                      <div className="text-textMuted">Description</div>
                      <div className="mt-1 text-textPrimary">
                        {active.description}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Chip>
                      {active.compatibilityRules.allowedModelIds.length > 0
                        ? active.compatibilityRules.allowedModelIds
                            .map((id) => modelNameById.get(id) ?? id)
                            .join(', ')
                        : 'Any model'}
                    </Chip>
                    <Chip>
                      Nozzle{' '}
                      {fmtNozzle(
                        active.compatibilityRules.allowedNozzleDiameters,
                      )}
                    </Chip>
                    <Chip>
                      {active.compatibilityRules.minBedX}×
                      {active.compatibilityRules.minBedY}
                    </Chip>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setOpen(false)}
                    disabled={printing}
                  >
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSelected(new Set());
                      setResults(null);
                      setSelectOpen(true);
                    }}
                    disabled={printing}
                  >
                    Print
                  </Button>
                </div>

                {results && (
                  <Card className="p-3">
                    <div className="text-xs font-medium text-textPrimary">
                      Results
                    </div>
                    <div className="mt-2 space-y-2">
                      {results.map((r) => (
                        <div
                          key={r.printerId}
                          className="rounded-card border border-border/45 bg-surface2/55 p-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        >
                          <div className="flex items-start justify-between">
                            <div className="font-medium text-textPrimary">
                              {r.displayName}
                            </div>
                            <div
                              className={
                                r.ok ? 'text-accentGreen' : 'text-accentRed'
                              }
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
              </div>
            )}
          </BottomSheet>

          <BottomSheet
            open={selectOpen}
            onClose={() => setSelectOpen(false)}
            title="Select printers"
          >
            {!active && (
              <div className="text-xs text-textSecondary">
                No preset selected.
              </div>
            )}

            {active && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {printersWithReasons.map(({ p, reasons }) => {
                    const disabled = reasons.includes('MODEL_NOT_ALLOWED');
                    const checked = selected.has(p.id);

                    return (
                      <button
                        key={p.id}
                        className={
                          'w-full rounded-card border p-3 text-left ' +
                          (disabled
                            ? 'border-border/50 bg-surface2 text-textMuted'
                            : reasons.length > 0
                              ? 'border-warning/30 bg-warning/10 text-textPrimary'
                              : 'border-border/70 bg-surface text-textPrimary')
                        }
                        disabled={disabled || printing}
                        onClick={() => toggleSelected(p.id)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold">
                              {printerLabelById.get(p.id) ?? p.displayName}
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

                        {reasons.length > 0 && (
                          <div
                            className={`mt-2 text-[11px] ${disabled ? 'text-accentRed' : 'text-warning'}`}
                          >
                            {reasons.map(reasonToText).join(', ')}
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {printersWithReasons.length === 0 && (
                    <div className="text-xs text-textSecondary">
                      No printers.
                    </div>
                  )}
                </div>

                <div className="sticky bottom-0 -mx-4 border-t border-border/50 bg-surface1/80 px-4 pt-3 backdrop-blur">
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
                      disabled={
                        printing || selected.size === 0 || hasBlockingSelected
                      }
                    >
                      Start on {selected.size}
                    </Button>
                  </div>
                  {hasBlockingSelected && (
                    <div className="mt-2 text-[11px] text-warning">
                      Remove printers with warnings (nozzle/bed/state) or fix
                      them to start printing.
                    </div>
                  )}
                </div>
              </div>
            )}
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
                      className="flex items-center justify-between rounded-card border border-border/45 bg-surface2/55 p-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    >
                      <div className="font-medium text-textPrimary">
                        {printerLabelById.get((p as PrinterDto).id) ??
                          (p as PrinterDto).displayName}
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
                  disabled={printing || hasBlockingSelected}
                >
                  {printing ? 'Starting…' : 'Start print'}
                </Button>
              </div>
              {hasBlockingSelected && (
                <div className="text-[11px] text-warning">
                  Printing is blocked because selected printers have warnings.
                </div>
              )}
            </div>
          </BottomSheet>

          {previewOpen && active?.thumbnailUrl && (
            <button
              type="button"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setPreviewOpen(false)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveThumbUrl(withCacheBust(active.thumbnailUrl))}
                alt="preview"
                className="max-h-[85vh] w-auto max-w-full rounded-card border border-border/60 bg-surface2 object-contain"
              />
            </button>
          )}
        </>
      )}
    </>
  );
}
