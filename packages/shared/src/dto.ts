import type {
  CompatibilityReason,
  HistoryStatus,
  PrinterState,
} from './enums.js';

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

export type PresetDto = {
  id: string;
  title: string;
  plasticType: string;
  colorHex: string;
  description: string | null;
  thumbnailUrl: string | null;
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
  startedAt: string;
  endedAt: string | null;
  printDurationSec: number | null;
  totalDurationSec: number | null;
  filamentUsedMm: number | null;
  errorMessage: string | null;
};
