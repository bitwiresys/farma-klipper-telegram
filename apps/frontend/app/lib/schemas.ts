import { z } from 'zod';

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
      allowedNozzleDiameters: z.array(z.number()),
      minBedX: z.number(),
      minBedY: z.number(),
    })
    .strict(),
});
