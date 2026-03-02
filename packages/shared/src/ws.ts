import type { PrinterDto, PrintHistoryDto } from './dto.js';

export type WsPrinterStatusPayload = {
  printer: PrinterDto;
};

export type WsHistoryEventPayload = {
  printerId: string;
  history: PrintHistoryDto;
};

export type WsPresetUpdatedPayload = {
  presetId: string;
};

export type WsEvent =
  | {
      type: 'PRINTER_STATUS';
      payload: WsPrinterStatusPayload;
    }
  | {
      type: 'HISTORY_EVENT';
      payload: WsHistoryEventPayload;
    }
  | {
      type: 'PRESET_UPDATED';
      payload: WsPresetUpdatedPayload;
    };
