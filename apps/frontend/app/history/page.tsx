'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleX, Clock, TriangleAlert } from 'lucide-react';

import type { PrintHistoryDto, PrinterDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { getBackendBaseUrl } from '../lib/env';
import { useWs } from '../ws/ws_context';

type StatusFilter = 'all' | 'completed' | 'error' | 'cancelled';

const PAGE_SIZE = 20;

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDur(sec: number | null): string {
  if (sec === null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusIcon(status: PrintHistoryDto['status']) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'error') return TriangleAlert;
  if (status === 'cancelled') return CircleX;
  return Clock;
}

function statusTone(status: PrintHistoryDto['status']): string {
  if (status === 'completed') return 'text-accentGreen';
  if (status === 'error') return 'text-accentRed';
  if (status === 'cancelled') return 'text-textMuted';
  return 'text-accentAmber';
}

function statusBadge(status: PrintHistoryDto['status']): string {
  if (status === 'completed') return 'border-success/25 bg-success/12';
  if (status === 'error') return 'border-danger/25 bg-danger/12';
  if (status === 'cancelled') return 'border-offlineGray/25 bg-offlineGray/12';
  return 'border-warning/25 bg-warning/12';
}

function withCacheBust(url: string): string {
  const t = String(Date.now());
  return url.includes('?') ? `${url}&t=${t}` : `${url}?t=${t}`;
}

function resolveThumbUrl(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = (getBackendBaseUrl() ?? '').replace(/\/+$/, '');
  if (!base) return raw;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

export default function HistoryPage() {
  const { token } = useAuth();
  const ws = useWs();
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [history, setHistory] = useState<PrintHistoryDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const printerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of printers) m.set(p.id, p.displayName);
    return m;
  }, [printers]);

  const active = useMemo(() => {
    if (!activeId) return null;
    return history.find((x) => x.id === activeId) ?? null;
  }, [activeId, history]);

  const load = async (opts?: { reset?: boolean; pages?: number }) => {
    if (!token) return;
    setErr(null);

    const p = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    setPrinters(p.printers);

    const reset = opts?.reset ?? false;
    const nextPagesLoaded =
      typeof opts?.pages === 'number' ? opts.pages : reset ? 1 : pagesLoaded;
    const limit = PAGE_SIZE * nextPagesLoaded;

    const qs = new URLSearchParams({
      limit: String(limit),
      offset: '0',
      status,
    });

    const h = await apiRequest<{ history: PrintHistoryDto[] }>(
      `/api/history?${qs.toString()}`,
      { token },
    );
    setPagesLoaded(nextPagesLoaded);
    setHistory(h.history);
    setHasMore(h.history.length === limit);
  };

  const loadMore = async () => {
    if (!token) return;
    const next = pagesLoaded + 1;
    await load({ pages: next });
  };

  useEffect(() => {
    setPagesLoaded(1);
    void load({ reset: true });
  }, [token, status]);

  useEffect(() => {
    if (!token) return;
    return ws.subscribe((ev) => {
      if (ev.type !== 'HISTORY_EVENT') return;
      void load({ reset: true });
    });
  }, [token, status, pagesLoaded, ws]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">History</div>
        <Button variant="secondary" onClick={() => void load({ reset: true })}>
          Refresh
        </Button>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setStatus('all')}>
              <Chip active={status === 'all'}>All</Chip>
            </button>
            <button type="button" onClick={() => setStatus('completed')}>
              <Chip active={status === 'completed'}>Completed</Chip>
            </button>
            <button type="button" onClick={() => setStatus('error')}>
              <Chip active={status === 'error'}>Error</Chip>
            </button>
            <button type="button" onClick={() => setStatus('cancelled')}>
              <Chip active={status === 'cancelled'}>Cancelled</Chip>
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {history.map((h) => (
              <button
                key={h.id}
                className="w-full text-left"
                type="button"
                onClick={() => {
                  setActiveId(h.id);
                  setOpen(true);
                }}
              >
                <Card className="p-3">
                  <div className="flex items-resolveTsumbUrl(htart gap-3">
                    )
                    {h.thumbnailUrl ? (
                      <div className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-btn border border-border/60 bg-surface2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={withCacheBust(h.thumbnailUrl)}
                          alt="thumbnail"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div
                        className={
                          `mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ` +
                          `${statusBadge(h.status)} ${statusTone(h.status)}`
                        }
                      >
                        {(() => {
                          const Ico = statusIcon(h.status);
                          return <Ico size={18} />;
                        })()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-textPrimary">
                        {h.filename}
                      </div>
                      <div className="mt-0.5 text-xs text-textSecondary">
                        {printerNameById.get(h.printerId) ?? h.printerId}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-textMuted">
                        <div>{fmtDateTime(h.startedAt)}</div>
                        <div>{fmtDur(h.printDurationSec)}</div>
                      </div>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
            {history.length === 0 && (
              <div className="text-xs text-textSecondary">No history.</div>
            )}

            {history.length > 0 && hasMore && (
              <Button variant="secondary" onClick={() => void loadMore()}>
                Load more
              </Button>
            )}
          </div>

          <BottomSheet
            open={open}
            onClose={() => setOpen(false)}
            title="Job details"
          >
            {!active && (
              <div className="text-xs text-textSecondary">No job selected.</div>
            )}

            {active && (
              <div className="space-y-3">
                resolveThumbUrl()
                {active.thumbnailUrl && (
                  <div className="overflow-hidden rounded-card border border-border/70 bg-surface2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={withCacheBust(active.thumbnailUrl)}
                      alt="thumbnail"
                      className="h-40 w-full object-cover"
                    />
                  </div>
                )}
                <div className="rounded-card border border-border/70 bg-surface2 p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-textPrimary">
                        {active.filename}
                      </div>
                      <div className="mt-0.5 text-textSecondary">
                        {printerNameById.get(active.printerId) ??
                          active.printerId}
                      </div>
                    </div>
                    <div className={`shrink-0 ${statusTone(active.status)}`}>
                      {active.status}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-btn border border-border/70 bg-surface p-2">
                      <div className="text-textMuted">Start</div>
                      <div className="text-textPrimary">
                        {fmtDateTime(active.startedAt)}
                      </div>
                    </div>
                    <div className="rounded-btn border border-border/70 bg-surface p-2">
                      <div className="text-textMuted">End</div>
                      <div className="text-textPrimary">
                        {active.endedAt ? fmtDateTime(active.endedAt) : '—'}
                      </div>
                    </div>
                    <div className="rounded-btn border border-border/70 bg-surface p-2">
                      <div className="text-textMuted">Duration</div>
                      <div className="text-textPrimary">
                        {fmtDur(active.printDurationSec)}
                      </div>
                    </div>
                    <div className="rounded-btn border border-border/70 bg-surface p-2">
                      <div className="text-textMuted">Total</div>
                      <div className="text-textPrimary">
                        {fmtDur(active.totalDurationSec)}
                      </div>
                    </div>
                  </div>

                  {active.errorMessage && (
                    <div className="mt-3 break-words rounded-btn border border-border/70 bg-surface p-2 text-textSecondary">
                      <div className="text-textMuted">Error</div>
                      <div className="mt-1 text-accentRed">
                        {active.errorMessage}
                      </div>
                    </div>
                  )}
                </div>
                <Link href={`/printers/${active.printerId}`} className="block">
                  <Button className="w-full" variant="secondary">
                    Open printer
                  </Button>
                </Link>
              </div>
            )}
          </BottomSheet>
        </>
      )}
    </>
  );
}
