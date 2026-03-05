'use client';

import { useEffect, useMemo, useState } from 'react';

import { Download, Filter, Box } from 'lucide-react';

import type { PrintHistoryDto, PrinterDto } from '../lib/dto';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { GCodeThumbnail } from '../components/GCodeViewer';
import { useAuth } from '../auth/auth_context';
import { getBackendBaseUrl } from '../lib/env';
import { buildPrinterLabelById } from '../lib/printer_label';
import { useWs } from '../ws/ws_context';

type StatusFilter = 'all' | 'completed' | 'error' | 'cancelled';

const PAGE_SIZE = 20;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().split('T')[0] ?? iso;
}

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

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryPage() {
  const { token } = useAuth();
  const ws = useWs();
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [printerFilter, setPrinterFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [history, setHistory] = useState<PrintHistoryDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const printerLabelById = useMemo(() => {
    return buildPrinterLabelById(printers);
  }, [printers]);

  const active = useMemo(() => {
    if (!activeId) return null;
    return history.find((x) => x.id === activeId) ?? null;
  }, [activeId, history]);

  // Filter history by printer and date (client-side)
  const filteredHistory = useMemo(() => {
    let result = history;
    if (printerFilter !== 'all') {
      result = result.filter((h) => h.printerId === printerFilter);
    }
    if (dateFrom) {
      result = result.filter((h) => fmtDate(h.startedAt) >= dateFrom);
    }
    if (dateTo) {
      result = result.filter((h) => fmtDate(h.startedAt) <= dateTo);
    }
    return result;
  }, [history, printerFilter, dateFrom, dateTo]);

  // Export functions
  const exportCsv = () => {
    const headers = [
      'Filename',
      'Printer',
      'Status',
      'Started',
      'Ended',
      'Duration (min)',
      'Filament (mm)',
    ];
    const rows = filteredHistory.map((h) => [
      h.filename,
      printerLabelById.get(h.printerId) ?? h.printerId,
      h.status,
      h.startedAt,
      h.endedAt ?? '',
      h.printDurationSec ? Math.round(h.printDurationSec / 60) : '',
      h.filamentUsedMm ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadFile(csv, 'history.csv', 'text/csv');
  };

  const exportJson = () => {
    const data = filteredHistory.map((h) => ({
      filename: h.filename,
      printer: printerLabelById.get(h.printerId) ?? h.printerId,
      status: h.status,
      startedAt: h.startedAt,
      endedAt: h.endedAt,
      printDurationSec: h.printDurationSec,
      totalDurationSec: h.totalDurationSec,
      filamentUsedMm: h.filamentUsedMm,
      errorMessage: h.errorMessage,
    }));
    downloadFile(
      JSON.stringify(data, null, 2),
      'history.json',
      'application/json',
    );
  };

  const requestHistory = (opts?: { reset?: boolean; pages?: number }) => {
    if (!token) return;
    setErr(null);

    const reset = opts?.reset ?? false;
    const nextPagesLoaded =
      typeof opts?.pages === 'number' ? opts.pages : reset ? 1 : pagesLoaded;
    const limit = PAGE_SIZE * nextPagesLoaded;

    const requestId = ws.nextRequestId();
    ws.send({
      type: 'REQ_HISTORY',
      payload: {
        requestId,
        status,
        limit,
        offset: 0,
      },
    });
    setPagesLoaded(nextPagesLoaded);
  };

  const loadMore = async () => {
    if (!token) return;
    const next = pagesLoaded + 1;
    requestHistory({ pages: next });
  };

  useEffect(() => {
    setPagesLoaded(1);
    requestHistory({ reset: true });
  }, [token, status]);

  useEffect(() => {
    if (!token) return;
    return ws.subscribe((ev) => {
      const e = ev as any;

      if (e.type === 'PRINTERS_SNAPSHOT') {
        const ps = e.payload?.printers as PrinterDto[] | undefined;
        if (!ps) return;
        setPrinters(ps);
        return;
      }

      if (e.type === 'HISTORY_SNAPSHOT') {
        const q = e.payload?.query as
          | { status: string; limit: number; offset: number }
          | undefined;
        const list = e.payload?.history as PrintHistoryDto[] | undefined;
        const total = e.payload?.total as number | undefined;
        if (!q || !list) return;

        if (q.status !== status) return;
        if (q.offset !== 0) return;

        setHistory(list);
        const computedHasMore =
          typeof total === 'number'
            ? q.offset + list.length < total
            : list.length === q.limit;
        setHasMore(computedHasMore);
        return;
      }

      if (e.type === 'HISTORY_EVENT') {
        requestHistory({ reset: true });
        return;
      }
    });
  }, [token, status, pagesLoaded, ws]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">History</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((f) => !f)}
            className={`rounded-btn p-1.5 transition ${showFilters ? 'bg-surface2 text-textPrimary' : 'text-textMuted'}`}
            title="Filters"
          >
            <Filter size={14} />
          </button>
          {filteredHistory.length > 0 && (
            <button
              type="button"
              onClick={() => exportCsv()}
              className="rounded-btn p-1.5 text-textMuted transition hover:text-textPrimary"
              title="Export CSV"
            >
              <Download size={14} />
            </button>
          )}
        </div>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <>
          {/* Extended filters */}
          {showFilters && (
            <div className="mt-2 space-y-2 rounded-btn border border-border/45 bg-surface2/55 p-3">
              <div className="text-xs font-medium text-textPrimary">
                Filters
              </div>

              {/* Printer filter */}
              <div className="space-y-1">
                <div className="text-xs text-textMuted">Printer</div>
                <select
                  value={printerFilter}
                  onChange={(e) => setPrinterFilter(e.target.value)}
                  className="w-full rounded-btn border border-border/50 bg-surface px-2 py-1.5 text-xs text-textPrimary"
                >
                  <option value="all">All printers</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {printerLabelById.get(p.id) ?? p.displayName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-textMuted">From</div>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-btn border border-border/50 bg-surface px-2 py-1.5 text-xs text-textPrimary"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-textMuted">To</div>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-btn border border-border/50 bg-surface px-2 py-1.5 text-xs text-textPrimary"
                  />
                </div>
              </div>

              {/* Clear filters */}
              {(printerFilter !== 'all' || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPrinterFilter('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}

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
            {filteredHistory.map((h) => (
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
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-btn border border-border/60 bg-surface2">
                      {h.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveThumbUrl(withCacheBust(h.thumbnailUrl))}
                          alt="thumbnail"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full bg-surface" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-textPrimary">
                        {h.filename}
                      </div>
                      <div className="mt-0.5 text-xs text-textSecondary">
                        {printerLabelById.get(h.printerId) ?? h.printerId}
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
            {filteredHistory.length === 0 && history.length > 0 && (
              <div className="text-xs text-textSecondary">
                No matches for selected filters.
              </div>
            )}
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
                        {active.filename}
                      </div>
                      <div className="mt-0.5 text-textSecondary">
                        {printerLabelById.get(active.printerId) ??
                          active.printerId}
                      </div>
                    </div>
                    <div className="shrink-0 text-textSecondary">
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
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = `/printers?open=${encodeURIComponent(active.printerId)}`;
                  }}
                >
                  Open printer
                </Button>
                {active.filename && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => {
                      window.location.href = `/printers/${active.printerId}/3d?filename=${encodeURIComponent(active.filename)}`;
                    }}
                  >
                    <Box size={14} className="mr-1.5" />
                    View 3D G-code
                  </Button>
                )}
              </div>
            )}
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
