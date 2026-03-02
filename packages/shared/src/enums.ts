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

export enum CompatibilityReason {
  MODEL_NOT_ALLOWED = 'MODEL_NOT_ALLOWED',
  NOZZLE_NOT_ALLOWED = 'NOZZLE_NOT_ALLOWED',
  BED_TOO_SMALL = 'BED_TOO_SMALL',
  PRINTER_NOT_READY = 'PRINTER_NOT_READY',
  PRINTER_BUSY = 'PRINTER_BUSY',
  OFFLINE = 'OFFLINE',
}
