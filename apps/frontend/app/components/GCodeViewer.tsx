'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, GCodeRenderer } from 'gcode-viewer';

function sanitizeGCode(input: string): string {
  // Remove non-standard lines that can contain huge numeric blobs (e.g. EXCLUDE_OBJECT_DEFINE)
  // and strip comments to keep the viewer parser stable.
  const out: string[] = [];

  // Avoid `split()` on large files (embedded thumbnails can be huge and cause OOM in webviews).
  // Process input line-by-line with minimal allocations.
  const maxLineLen = 8_192;
  const allowedCmds = new Set([
    'G0',
    'G1',
    'G21',
    'G90',
    'G91',
    'G92',
    'M82',
    'M83',
  ]);
  const allowedParams = new Set(['X', 'Y', 'Z', 'E', 'F']);

  let i = 0;
  const n = input.length;
  while (i < n) {
    let j = input.indexOf('\n', i);
    if (j === -1) j = n;

    // Slice without trimming the whole line first.
    let raw = input.slice(i, j);
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);

    // Hard-drop extremely long lines (base64 blobs, macros, etc.).
    if (raw.length > maxLineLen) {
      i = j + 1;
      continue;
    }

    // Skip leading whitespace
    let s = 0;
    while (s < raw.length) {
      const c = raw.charCodeAt(s);
      if (c !== 32 && c !== 9) break;
      s++;
    }
    if (s >= raw.length) {
      i = j + 1;
      continue;
    }

    // Skip full-line comments
    if (raw[s] === ';') {
      i = j + 1;
      continue;
    }

    // Remove inline comments (everything after ';')
    const semi = raw.indexOf(';', s);
    const line = (semi >= 0 ? raw.slice(s, semi) : raw.slice(s)).trim();
    if (!line) {
      i = j + 1;
      continue;
    }

    // Drop any lines that already contain NaN/Infinity tokens.
    if (/(^|[^a-z])(nan|inf|infinity)([^a-z]|$)/i.test(line)) {
      i = j + 1;
      continue;
    }

    // Accept only a strict, safe subset of commands.
    // This drops custom macros that can contain non-numeric blobs or unsupported parameters.
    const cmdMatch = /^([GMT])(\d+)\b/i.exec(line);
    if (!cmdMatch) {
      i = j + 1;
      continue;
    }
    const cmdLetter = cmdMatch[1].toUpperCase();
    const cmdNum = Number(cmdMatch[2]);
    const cmdKey = `${cmdLetter}${cmdNum}`;
    if (!allowedCmds.has(cmdKey)) {
      i = j + 1;
      continue;
    }

    // Strip invalid numeric params (e.g. Xnan, Yinf, X, X-)
    // Keep only XYZEF (the viewer's geometry depends on these).
    const parts = line.split(/\s+/);
    const cmd = parts[0].toUpperCase();
    const cleaned: string[] = [cmd];
    let keptParams = 0;
    let hasXyz = false;
    for (let k = 1; k < parts.length; k++) {
      const p = parts[k];
      if (!p) continue;
      const m =
        /^([A-Za-z])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(p);
      if (!m) continue;
      const key = m[1].toUpperCase();
      if (!allowedParams.has(key)) continue;
      const v = Number(m[2]);
      if (!Number.isFinite(v)) continue;
      cleaned.push(`${key}${m[2]}`);
      keptParams++;
      if (key === 'X' || key === 'Y' || key === 'Z') hasXyz = true;
    }

    // Drop empty motion commands (can confuse some parsers)
    if (
      (cmdKey === 'G0' || cmdKey === 'G1' || cmdKey === 'G92') &&
      keptParams === 0
    ) {
      i = j + 1;
      continue;
    }

    // Prevent NaN geometry in three.js: G0/G1 moves without any XYZ coordinates
    // (e.g. speed-only `G1 F...` or extrusion-only `G1 E...`) can create invalid segments.
    if ((cmdKey === 'G0' || cmdKey === 'G1') && !hasXyz) {
      i = j + 1;
      continue;
    }

    out.push(cleaned.join(' '));
    i = j + 1;
  }

  return out.join('\n');
}

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
  const [ready, setReady] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const derivedLayer = useMemo(() => {
    const total = Math.max(1, totalLayers ?? layerCount);
    const byProgress = Math.floor((progress / 100) * total);
    const base = currentLayer ?? byProgress;
    return Math.max(0, base);
  }, [currentLayer, layerCount, progress, totalLayers]);

  // Keep sliders in sync with real print progress until the user touches them.
  useEffect(() => {
    if (userInteracted) return;
    if (layerCount <= 0) return;
    setSimLayer(Math.min(derivedLayer, layerCount - 1));
    setSimLayerPct(Math.max(0, Math.min(Math.round(progress), 100)));
  }, [derivedLayer, layerCount, progress, userInteracted]);

  // Load + render via gcode-viewer
  useEffect(() => {
    if (!containerRef.current) return;
    if (!token) return;

    let disposed = false;
    const el = containerRef.current;

    const onResize = () => {
      const r = rendererRef.current;
      if (!r) return;
      const w = Math.max(10, el.clientWidth);
      const h = Math.max(10, el.clientHeight);
      if (w === containerSize.w && h === containerSize.h) return;
      setContainerSize({ w, h });
      try {
        r.resize(w, h);
      } catch {
        // ignore
      }
      try {
        (r as any).fitCamera?.();
      } catch {
        // ignore
      }
    };

    const scheduleResize = () => {
      // In Telegram/mini-app webviews layout can settle a bit later.
      // Do a couple of deferred passes to ensure camera fits final size.
      requestAnimationFrame(() => onResize());
      setTimeout(() => onResize(), 50);
      setTimeout(() => onResize(), 250);
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      setReady(false);
      setUserInteracted(false);

      try {
        const res = await fetch(
          `/api/gcode/${printerId}?filename=${encodeURIComponent(filename)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(
            `Failed to load G-code: ${res.status} ${t.slice(0, 120)}`,
          );
        }

        const gcodeStringRaw = await res.text();
        if (disposed) return;

        const gcodeString = sanitizeGCode(gcodeStringRaw);

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

        const r = new GCodeRenderer(
          gcodeString,
          width,
          height,
          new Color(0x0b0f14),
        );
        r.radialSegments = lowPoly ? 3 : 6;
        r.travelWidth = lowPoly ? 0.015 : 0.01;

        el.innerHTML = '';
        el.append(r.element());
        rendererRef.current = r;

        // Override fitCamera to properly scale model to viewport
        (r as any).fitCamera = function () {
          const parser = this.parser;
          if (!parser.min || !parser.max) return;

          const sizeX = parser.max.x - parser.min.x;
          const sizeY = parser.max.y - parser.min.y;
          const sizeZ = parser.max.z - parser.min.z;
          const maxDim = Math.max(sizeX, sizeY, sizeZ);

          const fov = this.camera.fov || 75;
          const cameraDistance =
            (maxDim / 2 / Math.tan((fov * Math.PI) / 360)) * 1.3;

          const centerX = (parser.min.x + parser.max.x) / 2;
          const centerY = (parser.min.y + parser.max.y) / 2;
          const centerZ = (parser.min.z + parser.max.z) / 2;

          this.camera.position.x = centerX;
          this.camera.position.y = centerY - cameraDistance * 0.4;
          this.camera.position.z = parser.max.z + cameraDistance * 0.6;

          if (this.cameraControl) {
            this.cameraControl.target.set(centerX, centerY, centerZ);
          }
          this.camera.lookAt(centerX, centerY, centerZ);
          this.draw();
        };

        await r.render();
        if (disposed) return;

        scheduleResize();

        const defs =
          r.getLayerDefinitionsNoCopy?.() ?? r.getLayerDefinitions?.() ?? [];
        const lc = Math.max(
          0,
          r.layerCount?.() ?? (Array.isArray(defs) ? defs.length : 0),
        );
        setLayerCount(lc);
        setSimLayer((x) => {
          if (lc <= 0) return 0;
          return Math.min(userInteracted ? x : derivedLayer, lc - 1);
        });
        setLoading(false);
        setReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    };

    load();

    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    // Telegram Mini App viewport handling
    const tg = (window as any).Telegram?.WebApp;
    const onTgViewport = () => onResize();
    tg?.onEvent?.('viewportChanged', onTgViewport);

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      tg?.offEvent?.('viewportChanged', onTgViewport);
    };
  }, [filename, lowPoly, printerId, token, containerSize.w, containerSize.h]);

  // Apply slicing based on slider state
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (layerCount <= 0) return;

    const pointsCount = r.pointsCount?.() ?? 0;
    if (!Number.isFinite(pointsCount) || pointsCount <= 0) return;

    const maxLayer = Math.max(0, Math.min(simLayer, layerCount - 1));

    try {
      // Compute a safe slice end based on layer definition.
      // gcode-viewer LayerDefinition has { start, end } as point numbers.
      const def = r.getLayerDefinition(maxLayer);
      const layerStart = (def as any)?.start;
      const layerEnd = (def as any)?.end;

      if (!Number.isFinite(layerStart) || !Number.isFinite(layerEnd)) {
        r.slice(0, pointsCount);
        return;
      }

      const start = Math.max(0, Math.min(layerStart, pointsCount));
      const endExclusive = Math.max(start, Math.min(layerEnd + 1, pointsCount));
      const span = Math.max(0, endExclusive - start);
      const pct01 = Math.max(0, Math.min(simLayerPct / 100, 1));
      const until = start + Math.floor(span * pct01);

      if (!Number.isFinite(until)) {
        r.slice(0, endExclusive);
        return;
      }

      const untilClamped = Math.max(0, Math.min(until, pointsCount));
      r.slice(0, untilClamped);
    } catch {
      // ignore
    }
  }, [layerCount, simLayer, simLayerPct, ready]);

  const total = Math.max(1, totalLayers ?? layerCount);
  const displayLayer = Math.min(simLayer, Math.max(0, total - 1));

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />

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
          {/* Vertical layer slider - minimalist */}
          <div className="absolute right-3 top-3 bottom-14 w-1.5 flex flex-col items-center">
            <div className="flex-1 w-full rounded-full bg-surface2/60 relative overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-accentCyan rounded-full transition-all duration-150"
                style={{ height: `${((displayLayer + 1) / total) * 100}%` }}
              />
              <input
                type="range"
                min={0}
                max={Math.max(0, layerCount - 1)}
                value={simLayer}
                onChange={(e) => {
                  setUserInteracted(true);
                  setSimLayer(parseInt(e.target.value));
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-0.5"
                style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              />
            </div>
            <div className="mt-2 text-[10px] font-medium text-textMuted">
              {displayLayer + 1}/{total}
            </div>
          </div>

          {/* Horizontal progress slider - minimalist */}
          <div className="absolute bottom-3 left-3 right-10 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-surface2/60 relative overflow-hidden">
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-accentCyan transition-all duration-150"
                style={{ width: `${simLayerPct}%` }}
              />
              <input
                type="range"
                min={0}
                max={100}
                value={simLayerPct}
                onChange={(e) => {
                  setUserInteracted(true);
                  setSimLayerPct(parseInt(e.target.value));
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
              />
            </div>
            <span className="text-[10px] font-medium text-textMuted min-w-[32px] text-right">
              {simLayerPct}%
            </span>
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
        const gcodeStringRaw = await res.text();
        if (disposed) return;

        const gcodeString = sanitizeGCode(gcodeStringRaw);

        const r = new GCodeRenderer(gcodeString, 120, 120, new Color(0x0b0f14));
        r.radialSegments = 3;
        r.travelWidth = 0;

        el.innerHTML = '';
        el.append(r.element());
        await r.render();
        if (disposed) return;

        try {
          r.resize(120, 120);
        } catch {
          // ignore
        }
        try {
          (r as any).fitCamera?.();
        } catch {
          // ignore
        }
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
