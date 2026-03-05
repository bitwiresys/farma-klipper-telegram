'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, GCodeRenderer } from 'gcode-viewer';

type GCodeViewerProps = {
  printerId: string;
  filename: string;
  token: string;
  toolheadPosition?: { x: number; y: number; z: number };
  showNozzle?: boolean;
  showProgress?: boolean;
  progress?: number; // 0-100
  currentLayer?: number | null;
  totalLayers?: number | null;
  className?: string;
  lowPoly?: boolean;
  simulationMode?: boolean; // Enable interactive sliders
};

export function GCodeViewer({
  printerId,
  filename,
  token,
  toolheadPosition,
  showNozzle = true,
  showProgress = true,
  progress = 0,
  currentLayer,
  totalLayers,
  className = '',
  lowPoly = false,
  simulationMode = false,
}: GCodeViewerProps) {

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GCodeRenderer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerCount, setLayerCount] = useState(0);
  const [simLayer, setSimLayer] = useState(0);
  const [simLayerPct, setSimLayerPct] = useState(100);

  const derivedLayer = useMemo(() => {
    const total = Math.max(1, totalLayers ?? layerCount);
    const byProgress = Math.floor((progress / 100) * total);
    const base = currentLayer ?? byProgress;
    return Math.max(0, base);
  }, [currentLayer, layerCount, progress, totalLayers]);

  // Load + render via gcode-viewer
  useEffect(() => {
    if (!containerRef.current) return;
    if (!token) return;

    let disposed = false;
    const el = containerRef.current;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Failed to load G-code: ${res.status} ${t.slice(0, 120)}`);
        }

        const gcodeString = await res.text();
        if (disposed) return;

        // cleanup previous renderer
        if (rendererRef.current) {
          try {
            const prevEl = rendererRef.current.element();
            prevEl?.remove?.();
          } catch {
            // ignore
          }
          rendererRef.current = null;
        }

        const width = Math.max(10, el.clientWidth);
        const height = Math.max(10, el.clientHeight);

        const r = new GCodeRenderer(gcodeString, width, height, new Color(0x0b0f14));
        r.radialSegments = lowPoly ? 3 : 6;
        r.travelWidth = lowPoly ? 0.015 : 0.01;

        el.innerHTML = '';
        el.append(r.element());
        rendererRef.current = r;

        await r.render();
        if (disposed) return;

        const defs = r.getLayerDefinitionsNoCopy?.() ?? r.getLayerDefinitions?.() ?? [];
        const lc = Array.isArray(defs) ? defs.length : 0;
        setLayerCount(lc);
        setSimLayer((x) => (lc > 0 ? Math.min(x, lc - 1) : 0));
        setLoading(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    };

    load();

    const onResize = () => {
      const r = rendererRef.current;
      if (!r) return;
      const w = Math.max(10, el.clientWidth);
      const h = Math.max(10, el.clientHeight);
      try {
        r.resize(w, h);
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
    };
  }, [filename, lowPoly, printerId, token]);

  // Apply slicing based on slider state
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (layerCount <= 0) return;

    const activeLayer = simulationMode ? simLayer : Math.min(derivedLayer, layerCount - 1);
    const maxLayer = Math.max(0, Math.min(activeLayer, layerCount - 1));

    try {
      // show layers 0..maxLayer
      r.sliceLayer(0, maxLayer);

      // slice within current layer for "layer progress" slider
      const def = r.getLayerDefinition(maxLayer);
      const start = (def as any)?.startPointNr ?? (def as any)?.start ?? 0;
      const end = (def as any)?.endPointNr ?? (def as any)?.end ?? start;
      const span = Math.max(0, end - start);
      const pct01 = Math.max(0, Math.min(simLayerPct / 100, 1));
      const until = start + Math.floor(span * pct01);
      r.slice(0, until);
    } catch {
      // ignore
    }
  }, [derivedLayer, layerCount, simLayer, simLayerPct, simulationMode]);

  const total = Math.max(1, totalLayers ?? layerCount);
  const displayLayer = simulationMode ? simLayer : Math.min(derivedLayer, Math.max(0, total - 1));

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
          <div className="text-textPrimary">Loading G-code...</div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80 p-4">
          <div className="text-red-400 text-center text-sm">{error}</div>
        </div>
      )}

      {showProgress && layerCount > 0 && (
        <>
          <div className="absolute right-2 top-2 bottom-12 w-6 flex flex-col items-center">
            <div className="text-[9px] text-textMuted mb-1">Layer</div>
            <div className="flex-1 w-2 rounded-full bg-surface2 relative overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-accentCyan/70 rounded-full transition-all"
                style={{ height: `${((displayLayer + 1) / total) * 100}%` }}
              />
            </div>
            {simulationMode && (
              <input
                type="range"
                min={0}
                max={Math.max(0, layerCount - 1)}
                value={simLayer}
                onChange={(e) => setSimLayer(parseInt(e.target.value))}
                className="absolute inset-0 opacity-0 cursor-pointer"
                style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              />
            )}
            <div className="text-[9px] text-textMuted mt-1">
              {displayLayer + 1}/{total}
            </div>
          </div>

          <div className="absolute bottom-2 left-2 right-10">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-textMuted w-12">Layer</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface2 relative">
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-full bg-accentCyan transition-all"
                  style={{ width: `${simLayerPct}%` }}
                />
                {simulationMode && (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={simLayerPct}
                    onChange={(e) => setSimLayerPct(parseInt(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full"
                  />
                )}
              </div>
              <span className="text-[10px] text-textMuted w-12 text-right">
                {simulationMode ? `${simLayerPct}%` : `${progress.toFixed(0)}%`}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Miniature viewer for dashboard (non-interactive thumbnail)
export function GCodeThumbnail({
  printerId,
  filename,
  token,
  className = '',
}: {
  printerId: string;
  filename: string;
  token: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!token) return;

    let disposed = false;
    const el = containerRef.current;

    const run = async () => {
      try {
        const res = await fetch(
          `/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const gcodeString = await res.text();
        if (disposed) return;

        const r = new GCodeRenderer(gcodeString, 120, 120, new Color(0x0b0f14));
        r.radialSegments = 3;
        r.travelWidth = 0;

        el.innerHTML = '';
        el.append(r.element());
        await r.render();
        if (disposed) return;
        setLoaded(true);
      } catch {
        // ignore
      }
    };

    run();

    return () => {
      disposed = true;
    };
  }, [filename, printerId, token]);

  return (
    <div
      ref={containerRef}
      className={`rounded overflow-hidden ${loaded ? 'opacity-100' : 'opacity-50'} ${className}`}
      style={{ width: 120, height: 120 }}
    />
  );
}
