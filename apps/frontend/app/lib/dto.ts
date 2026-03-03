export type PrinterState =
  | 'printing'
  | 'paused'
  | 'error'
  | 'standby'
  | 'offline';

export type PrinterSnapshotDto = {
  state: PrinterState;
  filename: string | null;
  progress: number | null;
  etaSec: number | null;
  temps: {
    extruder: number | null;
    bed: number | null;
  };
  layers: {
    current: number | null;
    total: number | null;
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

export type CompatibilityReason =
  | 'MODEL_NOT_ALLOWED'
  | 'NOZZLE_NOT_ALLOWED'
  | 'BED_TOO_SMALL'
  | 'PRINTER_BUSY'
  | 'PRINTER_NOT_READY'
  | 'OFFLINE';

export type PresetCompatibilityRulesDto = {
  allowedModelIds: string[];
  allowedNozzleDiameters: number[];
  minBedX: number;
  minBedY: number;
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

export type PrintHistoryStatus =
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'error';

export type PrintHistoryDto = {
  id: string;
  printerId: string;
  filename: string;
  status: PrintHistoryStatus;
  startedAt: string;
  endedAt: string | null;
  printDurationSec: number | null;
  totalDurationSec: number | null;
  filamentUsedMm: number | null;
  errorMessage: string | null;
};
