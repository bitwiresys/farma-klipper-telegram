import type {
  CompatibilityReason,
  HistoryStatus,
  PrinterState,
} from './enums.js';

export type PrinterSnapshotDto = {
  state: PrinterState;
  filename: string | null;
  jobLabel?: string | null;
  progress: number | null;
  etaSec: number | null;
  message?: string | null;
  temps: {
    extruder: number | null;
    bed: number | null;
    extruderTarget?: number | null;
    bedTarget?: number | null;
  };
  layers: {
    current: number | null;
    total: number | null;
  };
  position?: {
    commanded?: {
      x: number | null;
      y: number | null;
      z: number | null;
      e: number | null;
    };
    live?: {
      x: number | null;
      y: number | null;
      z: number | null;
      e: number | null;
    };
    gcode?: {
      x: number | null;
      y: number | null;
      z: number | null;
      e: number | null;
    };
  };
  speed?: {
    liveVelocityMmS?: number | null;
    liveExtruderVelocityMmS?: number | null;
    gcodeSpeedMmS?: number | null;
    speedFactor?: number | null;
    flowFactor?: number | null;
  };
  fans?: {
    part?: {
      speed?: number | null;
      rpm?: number | null;
    };
  };
  chamberTemp?: number | null;
  limits?: {
    maxVelocity?: number | null;
    maxAccel?: number | null;
  };
};

export type PrinterDto = {
  id: string;
  displayName: string;
  modelId: string;
  modelName: string;
  bedX: number;
  bedY: number;
  bedZ: number;
  nozzleDiameter: number;
  needsRekey: boolean;
  snapshot: PrinterSnapshotDto;
};

export type PresetCompatibilityRulesDto = {
  allowedModelIds: string[];
  allowedNozzleDiameters: number[];
  minBedX: number;
  minBedY: number;
};

export type PresetCompatibilityDto = {
  printerId: string;
  isCompatible: boolean;
  reasons: CompatibilityReason[];
};

export type PresetGcodeMetaDto = {
  estimated_time_sec: number | null;
  gcode_nozzle_diameter: number | null;
  filament_type: string | null;
  filament_name: string | null;
};

export type PresetDto = {
  id: string;
  title: string;
  plasticType: string;
  colorHex: string;
  description: string | null;
  thumbnailUrl: string | null;
  gcodeMeta: PresetGcodeMetaDto | null;
  compatibilityRules: PresetCompatibilityRulesDto;
};

export type PrintPresetBodyDto = {
  printerIds: string[];
};

export type PrintHistoryDto = {
  id: string;
  printerId: string;
  filename: string;
  status: HistoryStatus;
  thumbnailUrl?: string | null;
  startedAt: string;
  endedAt: string | null;
  printDurationSec: number | null;
  totalDurationSec: number | null;
  filamentUsedMm: number | null;
  errorMessage: string | null;
};
