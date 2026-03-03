'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { PresetDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { connectBackendWs } from '../lib/ws';

type WsEvent = { type: string; payload: any };

function Badge({ children }: { children: string }) {
  return (
    <div className="rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-200">
      {children}
    </div>
  );
}

function fmtModels(models: string[]): string {
  if (models.length === 0) return 'models: any';
  return models.length <= 3
    ? `models: ${models.length}`
    : `models: ${models.length}`;
}

function fmtNozzles(xs: number[]): string {
  if (xs.length === 0) return 'nozzle: any';
  const sorted = [...xs].sort((a, b) => a - b);
  return `nozzle: ${sorted.join(', ')}`;
}

function fmtBed(minBedX: number, minBedY: number): string {
  return `bed: ${minBedX}×${minBedY}`;
}

export default function PresetsPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetDto[]>([]);

  const load = async () => {
    if (!token) return;
    setErr(null);
    const res = await apiRequest<{ presets: PresetDto[] }>('/api/presets', {
      token,
    });
    setPresets(res.presets);
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    const conn = connectBackendWs({
      token,
      onStatus: () => undefined,
      onEvent: (ev) => {
        if (closed) return;
        const e = ev as WsEvent;
        if (e.type === 'PRESET_UPDATED') {
          void load();
        }
      },
    });
    return () => {
      closed = true;
      conn.close();
    };
  }, [token]);

  const sorted = useMemo(() => {
    return [...presets].sort((a, b) => a.title.localeCompare(b.title));
  }, [presets]);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Presets</div>
        <div className="flex gap-2">
          <Link
            href="/presets/new"
            className="rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950"
          >
            New
          </Link>
          <button
            className="rounded bg-slate-950 px-3 py-2 text-xs"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <div className="mt-3 space-y-3">
          {sorted.map((p) => (
            <Link
              key={p.id}
              href={`/presets/${p.id}`}
              className="block rounded border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-950">
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnailUrl}
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {p.title}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {p.plasticType}
                      </div>
                    </div>
                    <div
                      className="h-5 w-5 shrink-0 rounded border border-slate-700"
                      style={{ background: p.colorHex }}
                      title={p.colorHex}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>
                      {fmtModels(p.compatibilityRules.allowedModelIds)}
                    </Badge>
                    <Badge>
                      {fmtNozzles(p.compatibilityRules.allowedNozzleDiameters)}
                    </Badge>
                    <Badge>
                      {fmtBed(
                        p.compatibilityRules.minBedX,
                        p.compatibilityRules.minBedY,
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {sorted.length === 0 && (
            <div className="text-xs text-slate-400">No presets.</div>
          )}
        </div>
      )}
    </AppShell>
  );
}
