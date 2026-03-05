'use client';

import { useEffect, useState } from 'react';

import { BarChart3, Clock, TrendingUp, Printer } from 'lucide-react';

import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';

type FilamentStats = {
  totalMm: number;
  totalMeters: number;
  byPlasticType: Record<string, number>;
  byPrinter: Array<{ name: string; mm: number }>;
};

type PrintStats = {
  total: number;
  completed: number;
  error: number;
  cancelled: number;
  successRate: number;
  avgDurationSec: number | null;
};

type TimeSeriesPoint = {
  date: string;
  count: number;
  filamentMm: number;
};

type UptimeStats = {
  printers: Array<{
    name: string;
    totalHours: number;
    printCount: number;
    avgPrintHours: number;
  }>;
};

function fmtDuration(sec: number | null): string {
  if (sec === null) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtMeters(mm: number): string {
  if (mm < 1000) return `${Math.round(mm)}mm`;
  return `${(mm / 1000).toFixed(1)}m`;
}

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [filament, setFilament] = useState<FilamentStats | null>(null);
  const [prints, setPrints] = useState<PrintStats | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesPoint[]>([]);
  const [uptime, setUptime] = useState<UptimeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);

    Promise.all([
      apiRequest<FilamentStats>('/api/analytics/filament', { token }),
      apiRequest<PrintStats>('/api/analytics/prints', { token }),
      apiRequest<{ data: TimeSeriesPoint[] }>(
        '/api/analytics/timeseries?days=14',
        { token },
      ),
      apiRequest<UptimeStats>('/api/analytics/uptime', { token }),
    ])
      .then(([f, p, t, u]) => {
        setFilament(f);
        setPrints(p);
        setTimeseries(t.data);
        setUptime(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) {
    return <div className="text-xs text-textSecondary">Login required.</div>;
  }

  if (loading) {
    return (
      <div className="text-xs text-textSecondary">Loading analytics...</div>
    );
  }

  if (error) {
    return <div className="text-xs text-red-400">{error}</div>;
  }

  const maxCount = Math.max(...timeseries.map((t) => t.count), 1);

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-textSecondary">
            <TrendingUp size={14} />
            <div>Success rate</div>
          </div>
          <div className="mt-2 text-2xl font-semibold text-textPrimary">
            {prints?.successRate ?? 0}%
          </div>
          <div className="mt-1 text-xs text-textMuted">
            {prints?.completed ?? 0} of {prints?.total ?? 0} prints
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-textSecondary">
            <BarChart3 size={14} />
            <div>Filament used</div>
          </div>
          <div className="mt-2 text-2xl font-semibold text-textPrimary">
            {filament?.totalMeters?.toFixed(1) ?? 0}m
          </div>
          <div className="mt-1 text-xs text-textMuted">
            {fmtMeters(filament?.totalMm ?? 0)} total
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-textSecondary">
            <Clock size={14} />
            <div>Avg print time</div>
          </div>
          <div className="mt-2 text-2xl font-semibold text-textPrimary">
            {fmtDuration(prints?.avgDurationSec ?? null)}
          </div>
          <div className="mt-1 text-xs text-textMuted">per print</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-textSecondary">
            <Printer size={14} />
            <div>Active printers</div>
          </div>
          <div className="mt-2 text-2xl font-semibold text-textPrimary">
            {uptime?.printers?.length ?? 0}
          </div>
          <div className="mt-1 text-xs text-textMuted">with history</div>
        </Card>
      </div>

      {/* Prints chart */}
      <Card className="p-3">
        <div className="text-xs font-medium text-textPrimary">
          Prints (last 14 days)
        </div>
        <div className="mt-3 flex items-end gap-1" style={{ height: '80px' }}>
          {timeseries.map((t) => (
            <div
              key={t.date}
              className="flex-1 rounded-t bg-accentCyan/40 transition hover:bg-accentCyan/60"
              style={{
                height: `${(t.count / maxCount) * 100}%`,
                minHeight: t.count > 0 ? '4px' : '0',
              }}
              title={`${t.date}: ${t.count} prints`}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-textMuted">
          <div>{timeseries[0]?.date}</div>
          <div>{timeseries[timeseries.length - 1]?.date}</div>
        </div>
      </Card>

      {/* Printer usage */}
      {uptime && uptime.printers.length > 0 && (
        <Card className="p-3">
          <div className="text-xs font-medium text-textPrimary">
            Printer usage
          </div>
          <div className="mt-2 space-y-2">
            {uptime.printers.slice(0, 5).map((p) => (
              <div key={p.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="truncate text-textSecondary">{p.name}</div>
                  <div className="text-textPrimary">{p.totalHours}h</div>
                </div>
                <ProgressBar
                  value01={p.totalHours / (uptime.printers[0]?.totalHours || 1)}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filament by printer */}
      {filament && filament.byPrinter.length > 0 && (
        <Card className="p-3">
          <div className="text-xs font-medium text-textPrimary">
            Filament by printer
          </div>
          <div className="mt-2 space-y-2">
            {filament.byPrinter.slice(0, 5).map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between text-xs"
              >
                <div className="truncate text-textSecondary">{p.name}</div>
                <div className="text-textPrimary">{fmtMeters(p.mm)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Error summary */}
      {prints && prints.error > 0 && (
        <Card className="border-danger/30 bg-danger/5 p-3">
          <div className="text-xs font-medium text-danger">Errors</div>
          <div className="mt-2 text-xs text-textSecondary">
            {prints.error} prints ended with error (
            {Math.round((prints.error / prints.total) * 100)}%)
          </div>
        </Card>
      )}
    </div>
  );
}
