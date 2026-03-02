import { z } from 'zod';

import { CompatibilityReason, HistoryStatus, PrinterState } from './enums.js';

export const AuthTelegramSchema = z.object({
  initData: z.string().min(1),
});

export const CreatePrinterSchema = z.object({
  displayName: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  moonrakerBaseUrl: z.string().url(),
  moonrakerApiKey: z.string().min(1),
});

export const UpdatePrinterSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(100).optional(),
    moonrakerBaseUrl: z.string().url().optional(),
    moonrakerApiKey: z.string().min(1).optional(),
  })
  .strict();

export const CreatePresetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
});

export const UpdatePresetSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional().nullable(),
  })
  .strict();

export const PrintPresetSchema = z.object({
  printerId: z.string().min(1),
  presetId: z.string().min(1),
});

export const PrinterSnapshotSchema = z.object({
  snapshotUrl: z.string().url().nullable(),
  snapshotUpdatedAt: z.string().datetime().nullable(),
});

export const PrinterDtoSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    model: z.string(),
    bedX: z.number(),
    bedY: z.number(),
    bedZ: z.number(),
    nozzleDiameter: z.number(),
    state: z.nativeEnum(PrinterState),
  })
  .and(PrinterSnapshotSchema);

export const PresetCompatibilityDtoSchema = z.object({
  printerId: z.string(),
  isCompatible: z.boolean(),
  reasons: z.array(z.nativeEnum(CompatibilityReason)),
});

export const PresetDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  compatibility: z.array(PresetCompatibilityDtoSchema),
});

export const PrintHistoryDtoSchema = z.object({
  id: z.string(),
  printerId: z.string(),
  filename: z.string(),
  status: z.nativeEnum(HistoryStatus),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  printDurationSec: z.number().nullable(),
  totalDurationSec: z.number().nullable(),
  filamentUsedMm: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export const WsPrinterStatusPayloadSchema = z.object({
  printer: PrinterDtoSchema,
  progress: z.number().min(0).max(1).nullable(),
  etaSec: z.number().int().min(0).nullable(),
});

export const WsHistoryEventPayloadSchema = z.object({
  printerId: z.string(),
  history: PrintHistoryDtoSchema,
});

export const WsPresetUpdatedPayloadSchema = z.object({
  presetId: z.string(),
});

export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PRINTER_STATUS'),
    payload: WsPrinterStatusPayloadSchema,
  }),
  z.object({
    type: z.literal('HISTORY_EVENT'),
    payload: WsHistoryEventPayloadSchema,
  }),
  z.object({
    type: z.literal('PRESET_UPDATED'),
    payload: WsPresetUpdatedPayloadSchema,
  }),
]);
