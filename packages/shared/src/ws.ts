import type { PrinterDto, PrintHistoryDto } from './dto.js';

export type WsRequestBase = {
  requestId: string;
};

export type WsHistoryQuery = {
  status: 'all' | 'completed' | 'error' | 'cancelled' | 'in_progress';
  limit: number;
  offset: number;
};

export type WsReqHistory = {
  type: 'REQ_HISTORY';
  payload: WsRequestBase & WsHistoryQuery;
};

export type WsReqPresets = {
  type: 'REQ_PRESETS';
  payload: WsRequestBase;
};

export type WsReqPrinterModels = {
  type: 'REQ_PRINTER_MODELS';
  payload: WsRequestBase;
};

export type WsClientMessage = WsReqHistory | WsReqPresets | WsReqPrinterModels;

export type WsPrintersSnapshotPayload = {
  printers: PrinterDto[];
};

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

export type WsPresetsSnapshotPayload = {
  presets: Array<{
    id: string;
    title: string;
    plasticType: string;
    colorHex: string;
    description: string | null;
    thumbnailUrl: string | null;
    gcodeMeta: any;
    compatibilityRules: {
      allowedModelIds: string[];
      allowedNozzleDiameters: number[];
      minBedX: number;
      minBedY: number;
    };
  }>;
};

export type WsPrinterModelsSnapshotPayload = {
  models: Array<{ id: string; name: string }>;
};

export type WsHistorySnapshotPayload = {
  query: WsHistoryQuery;
  history: PrintHistoryDto[];
  total: number;
};

export type WsEvent =
  | {
      type: 'PRINTERS_SNAPSHOT';
      payload: WsPrintersSnapshotPayload;
    }
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

export type WsResponse =
  | {
      type: 'PRESETS_SNAPSHOT';
      payload: WsRequestBase & WsPresetsSnapshotPayload;
    }
  | {
      type: 'PRINTER_MODELS_SNAPSHOT';
      payload: WsRequestBase & WsPrinterModelsSnapshotPayload;
    }
  | {
      type: 'HISTORY_SNAPSHOT';
      payload: WsRequestBase & WsHistorySnapshotPayload;
    };

export type WsServerMessage = WsEvent | WsResponse;
