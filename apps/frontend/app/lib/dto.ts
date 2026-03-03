export type PrinterSnapshotDto = {
  state: 'offline' | 'standby' | 'printing' | 'paused' | 'error';
  progress: number | null;
  etaSec: number | null;
  filename: string | null;
  temps: {
    extruder: number | null;
    bed: number | null;
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

export type PrintHistoryStatus = 'in_progress' | 'completed' | 'cancelled' | 'error';

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
