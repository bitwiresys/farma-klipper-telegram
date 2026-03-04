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
import { apiRequest } from '../lib/api';
import { useWs } from '../ws/ws_context';

type WsEvent = { type: string; payload: any };

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
  const [query, setQuery] = useState('');

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
    return ws.subscribe((ev) => {
      const e = ev as WsEvent;
      if (e.type === 'PRESET_UPDATED') void load();
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
                      <Chip>{p.plasticType}</Chip>
                      <div
                        className="h-4 w-4 rounded-full border border-border/70"
                        style={{ background: p.colorHex || '#ffffff' }}
                        aria-label={p.colorHex}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip>
                        {p.compatibilityRules.allowedModelIds.length > 0
                          ? 'models'
                          : 'models any'}
                      </Chip>
                      <Chip>
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
