'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { PresetDto } from '../lib/dto';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { SearchInput } from '../components/ui/SearchInput';
import { useAuth } from '../auth/auth_context';
import { useWs } from '../ws/ws_context';

type WsEvent = { type: string; payload: any };

type PrinterModelRow = {
  id: string;
  name: string;
};

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

export default function PresetsPage() {
  const { token } = useAuth();
  const ws = useWs();
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [models, setModels] = useState<PrinterModelRow[]>([]);
  const [query, setQuery] = useState('');

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

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...presets].sort((a, b) => a.title.localeCompare(b.title));
    if (!q) return list;
    return list.filter((p) => {
      const hay = `${p.title} ${p.plasticType}`.toLowerCase();
      return hay.includes(q);
    });
  }, [presets]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Presets</div>
        <div className="flex gap-2">
          <Link href="/presets/new">
            <Button variant="primary">+ Add</Button>
          </Link>
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
              <Card key={p.id} className="p-3">
                <div className="flex gap-3">
                  <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-btn bg-surface2">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbnailUrl}
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
                    <Link
                      href={`/presets/${p.id}`}
                      className="block truncate text-[14px] font-semibold text-textPrimary"
                    >
                      {p.title}
                    </Link>

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
                        {fmtNozzle(p.compatibilityRules.allowedNozzleDiameters)}
                      </Chip>
                      <Chip>
                        {p.compatibilityRules.minBedX}×
                        {p.compatibilityRules.minBedY}
                      </Chip>
                    </div>
                  </div>

                  <div className="flex flex-col justify-end">
                    <Link href={`/presets/${p.id}`}>
                      <Button variant="primary">Print</Button>
                    </Link>
                  </div>
                </div>
              </Card>
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
        </>
      )}
    </>
  );
}
