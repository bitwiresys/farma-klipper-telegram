import type { CompatibilityReason, HistoryStatus, PrinterState } from './enums.js';

export type PrinterSnapshotDto = {
  snapshotUrl: string | null;
  snapshotUpdatedAt: string | null;
};

export type PrinterDto = {
  id: string;
  displayName: string;
  model: string;
  bedX: number;
  bedY: number;
  bedZ: number;
  nozzleDiameter: number;
  state: PrinterState;
} & PrinterSnapshotDto;

export type PresetCompatibilityDto = {
  printerId: string;
  isCompatible: boolean;
  reasons: CompatibilityReason[];
};

export type PresetDto = {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  compatibility: PresetCompatibilityDto[];
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
