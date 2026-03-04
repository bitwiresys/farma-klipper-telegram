import { z } from 'zod';

import { COMPATIBILITY_REASONS, HistoryStatus, PrinterState } from './enums.js';

export const AuthTelegramSchema = z.object({
  initData: z.string().min(1),
});

export const CreatePrinterSchema = z.object({
  displayName: z.string().min(1).max(100),
  modelId: z.string().min(1),
  moonrakerBaseUrl: z.string().url(),
  moonrakerApiKey: z.string().min(1),
});

export const UpdatePrinterSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    modelId: z.string().min(1).optional(),
    moonrakerBaseUrl: z.string().url().optional(),
    moonrakerApiKey: z.string().min(1).optional(),
  })
  .strict();

export const CreatePresetSchema = z.object({
  title: z.string().min(1).max(120),
  plasticType: z.string().min(1).max(120),
  colorHex: z.string().min(1).max(16),
  description: z.string().max(2000).optional().nullable(),
  sourcePrinterId: z.string().min(1),
  sourceFilename: z.string().min(1),
  compatibilityRules: z
    .object({
      allowedModelIds: z.array(z.string()),
    })
    .strict(),
});

export const UpdatePresetSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    plasticType: z.string().min(1).max(120).optional(),
    colorHex: z.string().min(1).max(16).optional(),
    description: z.string().max(2000).optional().nullable(),
    compatibilityRules: z
      .object({
        allowedModelIds: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PrintPresetSchema = z.object({
  printerIds: z.array(z.string().min(1)).min(1),
});

export const PrinterSnapshotSchema = z.object({
  state: z.nativeEnum(PrinterState),
  filename: z.string().nullable(),
  jobLabel: z.string().nullable().optional(),
  progress: z.number().min(0).max(1).nullable(),
  etaSec: z.number().int().min(0).nullable(),
  message: z.string().nullable().optional(),
  temps: z.object({
    extruder: z.number().nullable(),
    bed: z.number().nullable(),
    extruderTarget: z.number().nullable().optional(),
    bedTarget: z.number().nullable().optional(),
  }),
  layers: z.object({
    current: z.number().int().min(0).nullable(),
    total: z.number().int().min(0).nullable(),
  }),
  position: z
    .object({
      commanded: z
        .object({
          x: z.number().nullable(),
          y: z.number().nullable(),
          z: z.number().nullable(),
          e: z.number().nullable(),
        })
        .optional(),
      live: z
        .object({
          x: z.number().nullable(),
          y: z.number().nullable(),
          z: z.number().nullable(),
          e: z.number().nullable(),
        })
        .optional(),
      gcode: z
        .object({
          x: z.number().nullable(),
          y: z.number().nullable(),
          z: z.number().nullable(),
          e: z.number().nullable(),
        })
        .optional(),
    })
    .optional(),
  speed: z
    .object({
      liveVelocityMmS: z.number().nullable().optional(),
      liveExtruderVelocityMmS: z.number().nullable().optional(),
      gcodeSpeedMmS: z.number().nullable().optional(),
      speedFactor: z.number().nullable().optional(),
      flowFactor: z.number().nullable().optional(),
    })
    .optional(),
  fans: z
    .object({
      part: z
        .object({
          speed: z.number().nullable().optional(),
          rpm: z.number().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  chamberTemp: z.number().nullable().optional(),
  limits: z
    .object({
      maxVelocity: z.number().nullable().optional(),
      maxAccel: z.number().nullable().optional(),
    })
    .optional(),
});

export const PrinterDtoSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    modelId: z.string(),
    modelName: z.string(),
    bedX: z.number(),
    bedY: z.number(),
    bedZ: z.number(),
    nozzleDiameter: z.number(),
    needsRekey: z.boolean(),
    snapshot: PrinterSnapshotSchema,
  })
  .strict();

export const PresetCompatibilityDtoSchema = z.object({
  printerId: z.string(),
  isCompatible: z.boolean(),
  reasons: z.array(z.enum(COMPATIBILITY_REASONS)),
});

export const PresetCompatibilityRulesDtoSchema = z.object({
  allowedModelIds: z.array(z.string()),
  allowedNozzleDiameters: z.array(z.number()),
  minBedX: z.number(),
  minBedY: z.number(),
});

export const PresetDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  plasticType: z.string(),
  colorHex: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  gcodeMeta: z
    .object({
      estimated_time_sec: z.number().nullable(),
      gcode_nozzle_diameter: z.number().nullable(),
      filament_type: z.string().nullable(),
      filament_name: z.string().nullable(),
    })
    .nullable(),
  compatibilityRules: PresetCompatibilityRulesDtoSchema,
});

export const PrintHistoryDtoSchema = z.object({
  id: z.string(),
  printerId: z.string(),
  filename: z.string(),
  status: z.nativeEnum(HistoryStatus),
  thumbnailUrl: z.string().url().nullable().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  printDurationSec: z.number().nullable(),
  totalDurationSec: z.number().nullable(),
  filamentUsedMm: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export const WsPrinterStatusPayloadSchema = z.object({
  printer: PrinterDtoSchema,
});

export const WsPrintersSnapshotPayloadSchema = z.object({
  printers: z.array(PrinterDtoSchema),
});

export const WsHistoryEventPayloadSchema = z.object({
  printerId: z.string(),
  history: PrintHistoryDtoSchema,
});

export const WsPresetUpdatedPayloadSchema = z.object({
  presetId: z.string(),
});

export const WsHistoryQuerySchema = z.object({
  status: z.enum(['all', 'completed', 'error', 'cancelled', 'in_progress']),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().min(0).max(10_000),
});

export const WsRequestBaseSchema = z.object({
  requestId: z.string().min(1).max(120),
});

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REQ_HISTORY'),
    payload: WsRequestBaseSchema.merge(WsHistoryQuerySchema),
  }),
  z.object({
    type: z.literal('REQ_PRESETS'),
    payload: WsRequestBaseSchema,
  }),
  z.object({
    type: z.literal('REQ_PRINTER_MODELS'),
    payload: WsRequestBaseSchema,
  }),
]);

export const WsPresetsSnapshotPayloadSchema = z.object({
  presets: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      plasticType: z.string(),
      colorHex: z.string(),
      description: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      gcodeMeta: z.any().nullable(),
      compatibilityRules: z.object({
        allowedModelIds: z.array(z.string()),
        allowedNozzleDiameters: z.array(z.number()),
        minBedX: z.number(),
        minBedY: z.number(),
      }),
    }),
  ),
});

export const WsPrinterModelsSnapshotPayloadSchema = z.object({
  models: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const WsHistorySnapshotPayloadSchema = z.object({
  query: WsHistoryQuerySchema,
  history: z.array(PrintHistoryDtoSchema),
  total: z.number().int().min(0),
});

export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PRINTERS_SNAPSHOT'),
    payload: WsPrintersSnapshotPayloadSchema,
  }),
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
  z.object({
    type: z.literal('PRESETS_SNAPSHOT'),
    payload: WsRequestBaseSchema.merge(WsPresetsSnapshotPayloadSchema),
  }),
  z.object({
    type: z.literal('PRINTER_MODELS_SNAPSHOT'),
    payload: WsRequestBaseSchema.merge(WsPrinterModelsSnapshotPayloadSchema),
  }),
  z.object({
    type: z.literal('HISTORY_SNAPSHOT'),
    payload: WsRequestBaseSchema.merge(WsHistorySnapshotPayloadSchema),
  }),
]);
