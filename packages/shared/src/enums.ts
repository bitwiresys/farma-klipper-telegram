export enum PrinterState {
  printing = 'printing',
  paused = 'paused',
  error = 'error',
  standby = 'standby',
  offline = 'offline',
}

export enum HistoryStatus {
  completed = 'completed',
  error = 'error',
  cancelled = 'cancelled',
  in_progress = 'in_progress',
}

export enum NotificationEventType {
  FIRST_LAYER_DONE = 'FIRST_LAYER_DONE',
  PRINT_COMPLETE = 'PRINT_COMPLETE',
  PRINT_ERROR = 'PRINT_ERROR',
}

export const COMPATIBILITY_REASONS = [
  'MODEL_NOT_ALLOWED',
  'NOZZLE_NOT_ALLOWED',
  'BED_TOO_SMALL',
  'PRINTER_BUSY',
  'PRINTER_NOT_READY',
  'OFFLINE',
] as const;

export type CompatibilityReason = (typeof COMPATIBILITY_REASONS)[number];
