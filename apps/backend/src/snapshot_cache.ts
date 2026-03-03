import { PrinterState, type PrinterSnapshotDto } from '@farma/shared';

export type SnapshotInternal = {
  snapshot: PrinterSnapshotDto;
  updatedAtMs: number;
  // ETA smoothing
  lastEtaUpdateAtMs: number;
  etaSecSmoothed: number | null;
};

const DEFAULT_SNAPSHOT: PrinterSnapshotDto = {
  state: PrinterState.offline,
  filename: null,
  progress: null,
  etaSec: null,
  temps: {
    extruder: null,
    bed: null,
  },
  layers: {
    current: null,
    total: null,
  },
};

export class SnapshotCache {
  private map = new Map<string, SnapshotInternal>();

  get(printerId: string): SnapshotInternal {
    const existing = this.map.get(printerId);
    if (existing) return existing;
    const created: SnapshotInternal = {
      snapshot: { ...DEFAULT_SNAPSHOT },
      updatedAtMs: 0,
      lastEtaUpdateAtMs: 0,
      etaSecSmoothed: null,
    };
    this.map.set(printerId, created);
    return created;
  }

  set(printerId: string, next: SnapshotInternal) {
    this.map.set(printerId, next);
  }
}
