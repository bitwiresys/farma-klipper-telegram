'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { ArrowLeft, Maximize2, Minimize2, Box } from 'lucide-react';

import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { GCodeViewer } from '../../../components/GCodeViewer';
import { useAuth } from '../../../auth/auth_context';
import { useWs } from '../../../ws/ws_context';
import { apiRequest } from '../../../lib/api';
import type { PrinterDto } from '../../../lib/dto';

type WsEvent = { type: string; payload: any };

function fmtPct(x: number | null): string {
  if (x === null) return '-';
  return `${Math.round(x * 100)}%`;
}

function fmtEta(sec: number | null): string {
  if (sec === null) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function GCode3DPageContent({ printerId }: { printerId: string }) {
  const { token } = useAuth();
  const ws = useWs();
  const router = useRouter();
  const searchParams = useSearchParams();

  const filename = searchParams.get('filename') ?? '';

  const [printer, setPrinter] = useState<PrinterDto | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toolheadPos, setToolheadPos] = useState<{ x: number; y: number; z: number } | null>(null);

  // Fetch printer info
  useEffect(() => {
    if (!token) return;

    const fetchPrinter = async () => {
      try {
        const p = await apiRequest<PrinterDto>(`/api/printers/${printerId}`);
        setPrinter(p);
      } catch {
        // Ignore
      }
    };

    fetchPrinter();
  }, [token, printerId]);

  // Subscribe to printer status for toolhead position
  useEffect(() => {
    if (!token) return;

    return ws.subscribe((ev) => {
      const e = ev as WsEvent;
      if (e.type === 'PRINTER_STATUS') {
        const p = e.payload?.printer as PrinterDto | undefined;
        if (p && p.id === printerId) {
          setPrinter(p);

          // Extract toolhead position from snapshot
          const pos = p.snapshot.position;
          if (pos?.live || pos?.commanded) {
            const live = pos.live ?? pos.commanded;
            setToolheadPos({
              x: live?.x ?? 0,
              y: live?.y ?? 0,
              z: live?.z ?? 0,
            });
          }
        }
      }
    });
  }, [token, ws, printerId]);

  // Fullscreen toggle
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const progress = printer?.snapshot.progress ?? 0;
  const state = printer?.snapshot.state ?? 'standby';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-surface1/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href="/printers"
            className="flex h-8 w-8 items-center justify-center rounded-btn text-textMuted transition hover:bg-surface2 hover:text-textPrimary"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="text-sm font-semibold text-textPrimary">
              {printer?.displayName ?? 'Printer'}
            </div>
            <div className="text-xs text-textMuted truncate max-w-[200px]">
              {filename || 'No file'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status */}
          <div className="flex items-center gap-1.5 rounded-full bg-surface2 px-2 py-1">
            <Box size={12} className="text-accentCyan" />
            <span className="text-xs text-textPrimary">{fmtPct(progress)}</span>
          </div>

          {/* Fullscreen toggle */}
          <Button
            variant="secondary"
            className="h-8 w-8 p-0"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
        </div>
      </div>

      {/* 3D Viewer */}
      <div className="relative flex-1">
        {filename ? (
          <GCodeViewer
            printerId={printerId}
            filename={filename}
            toolheadPosition={toolheadPos ?? undefined}
            showNozzle={true}
            showProgress={true}
            progress={progress * 100}
            lowPoly={true}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-textMuted">
            No G-code file loaded
          </div>
        )}
      </div>

      {/* Bottom stats bar */}
      <div className="border-t border-border/40 bg-surface1/80 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-textMuted">State: </span>
              <span className="text-textPrimary capitalize">{state}</span>
            </div>
            {toolheadPos && (
              <div>
                <span className="text-textMuted">Pos: </span>
                <span className="font-mono text-textPrimary">
                  X{toolheadPos.x.toFixed(1)} Y{toolheadPos.y.toFixed(1)} Z{toolheadPos.z.toFixed(1)}
                </span>
              </div>
            )}
          </div>
          <div>
            <span className="text-textMuted">ETA: </span>
            <span className="text-textPrimary">{fmtEta(printer?.snapshot.etaSec ?? null)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GCode3DPage({ params }: { params: Promise<{ id: string }> }) {
  const [printerId, setPrinterId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setPrinterId(p.id));
  }, [params]);

  if (!printerId) {
    return (
      <div className="flex h-full items-center justify-center text-textMuted">
        Loading...
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-textMuted">Loading...</div>}>
      <GCode3DPageContent printerId={printerId} />
    </Suspense>
  );
}
