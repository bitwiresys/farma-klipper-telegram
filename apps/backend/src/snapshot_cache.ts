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
  position: {
    commanded: { x: null, y: null, z: null, e: null },
    live: { x: null, y: null, z: null, e: null },
    gcode: { x: null, y: null, z: null, e: null },
  },
  speed: {
    liveVelocityMmS: null,
    gcodeSpeedMmS: null,
    speedFactor: null,
    flowFactor: null,
  },
  fans: {
    part: {
      speed: null,
      rpm: null,
    },
  },
  chamberTemp: null,
  limits: {
    maxVelocity: null,
    maxAccel: null,
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
