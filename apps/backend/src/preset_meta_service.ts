import fs from 'node:fs';
import path from 'node:path';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { MoonrakerHttp } from './moonraker_http.js';
import { logger } from './logger.js';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function resolveFilesDirSafe(relPath: string): string {
  const abs = path.resolve(env.FILES_DIR, relPath);
  const base = path.resolve(env.FILES_DIR);
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('INVALID_PATH');
  }
  return abs;
}

type ThumbnailDetails = {
  width: number;
  height: number;
  size: number;
  thumbnail_path: string;
  relative_path?: string;
};

type MetadataResponse = {
  estimated_time?: number;
  nozzle_diameter?: number;
  filament_type?: string;
  filament_name?: string;
};

function pickBestThumbnail(
  thumbnails: ThumbnailDetails[],
): ThumbnailDetails | null {
  const pool = thumbnails.filter((t) => {
    const w = Number(t.width);
    const h = Number(t.height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
    return w > 0 && h > 0;
  });
  if (pool.length === 0) return null;

  let best = pool[0];
  let bestArea = Number(best.width) * Number(best.height);

  for (const t of pool.slice(1)) {
    const area = Number(t.width) * Number(t.height);
    if (area > bestArea) {
      best = t;
      bestArea = area;
    }
  }

  return best;
}

function normalizeMoonrakerThumbPath(raw: string): string {
  return String(raw)
    .trim()
    .replace(/^\/+/, '')
    .replace(/^gcodes\/+/, '');
}

export class PresetMetaService {
  async ensureMetaAndThumbnail(input: {
    presetId: string;
    printerId: string;
    remoteFilename: string;
    http: MoonrakerHttp;
  }) {
    const preset = await prisma.preset.findUnique({
      where: { id: input.presetId },
    });
    if (!preset) throw new Error('Preset not found');

    const shouldFetchThumb = (() => {
      if (!preset.thumbnailPath) return true;
      try {
        const abs = resolveFilesDirSafe(preset.thumbnailPath);
        return !fs.existsSync(abs);
      } catch {
        return true;
      }
    })();

    const shouldFetchMeta = preset.gcodeMeta === null;
    if (!shouldFetchThumb && !shouldFetchMeta) return;

    await input.http.post(
      `/server/files/metascan?filename=${encodeURIComponent(input.remoteFilename)}`,
    );

    const meta = (await input.http.get<any>(
      `/server/files/metadata?filename=${encodeURIComponent(input.remoteFilename)}`,
    )) as MetadataResponse;

    const thumbsRaw = await input.http.get<any>(
      `/server/files/thumbnails?filename=${encodeURIComponent(input.remoteFilename)}`,
    );

    const thumbs = Array.isArray(thumbsRaw)
      ? (thumbsRaw as ThumbnailDetails[])
      : Array.isArray((thumbsRaw as any)?.thumbnails)
        ? ((thumbsRaw as any).thumbnails as ThumbnailDetails[])
        : [];

    let thumbRel: string | null = null;

    if (shouldFetchThumb) {
      const best = pickBestThumbnail(thumbs);
      if (!best) {
        logger.warn(
          { presetId: input.presetId, remoteFilename: input.remoteFilename },
          'moonraker thumbnails missing',
        );
      }
      const bestPath = best
        ? typeof (best as any).relative_path === 'string' &&
          String((best as any).relative_path).trim()
          ? String((best as any).relative_path)
          : typeof best.thumbnail_path === 'string' && best.thumbnail_path
            ? best.thumbnail_path
            : null
        : null;

      if (best && bestPath) {
        const thumbPath = normalizeMoonrakerThumbPath(bestPath);
        let bytes: Buffer;
        try {
          bytes = await input.http.downloadFile({
            root: 'gcodes',
            filename: thumbPath,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(
            {
              presetId: input.presetId,
              remoteFilename: input.remoteFilename,
              thumbPath,
              err: msg,
            },
            'moonraker thumbnail download failed',
          );
          bytes = Buffer.from('');
        }

        if (bytes.length === 0) {
          // keep thumbRel null
        } else {
          const outRel = path.posix.join(
            'presets',
            input.presetId,
            'thumb.png',
          );
          const outAbs = resolveFilesDirSafe(outRel);
          ensureDir(path.dirname(outAbs));
          fs.writeFileSync(outAbs, bytes);
          thumbRel = outRel;
        }
      }
    }

    const nextMeta = {
      estimated_time_sec:
        typeof meta.estimated_time === 'number' ? meta.estimated_time : null,
      gcode_nozzle_diameter:
        typeof meta.nozzle_diameter === 'number' ? meta.nozzle_diameter : null,
      filament_type:
        typeof meta.filament_type === 'string' ? meta.filament_type : null,
      filament_name:
        typeof meta.filament_name === 'string' ? meta.filament_name : null,
      remoteFilename: input.remoteFilename,
      printerId: input.printerId,
    };

    await prisma.preset.update({
      where: { id: input.presetId },
      data: {
        thumbnailPath: thumbRel ?? undefined,
        gcodeMeta: shouldFetchMeta ? (nextMeta as any) : undefined,
      },
    });
  }
}

export const presetMetaService = new PresetMetaService();
