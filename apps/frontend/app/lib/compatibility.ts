import type {
  CompatibilityReason,
  PresetCompatibilityRulesDto,
  PrinterDto,
} from './dto';

export function computePresetCompatibilityReasons(input: {
  presetRules: PresetCompatibilityRulesDto;
  printer: Pick<
    PrinterDto,
    'modelId' | 'nozzleDiameter' | 'bedX' | 'bedY' | 'snapshot'
  >;
}): CompatibilityReason[] {
  const { presetRules, printer } = input;
  const reasons: CompatibilityReason[] = [];

  const allowedModelIds = new Set(presetRules.allowedModelIds ?? []);
  const allowedNozzles = presetRules.allowedNozzleDiameters ?? [];

  if (allowedModelIds.size > 0 && !allowedModelIds.has(printer.modelId)) {
    reasons.push('MODEL_NOT_ALLOWED');
  }

  if (
    printer.bedX < presetRules.minBedX ||
    printer.bedY < presetRules.minBedY
  ) {
    reasons.push('BED_TOO_SMALL');
  }

  if (
    allowedNozzles.length > 0 &&
    !allowedNozzles.includes(printer.nozzleDiameter)
  ) {
    reasons.push('NOZZLE_NOT_ALLOWED');
  }

  const state = String(printer.snapshot?.state ?? '');
  if (state === 'offline') {
    reasons.push('OFFLINE');
  } else if (state === 'printing' || state === 'paused') {
    reasons.push('PRINTER_BUSY');
  } else if (state !== 'standby') {
    reasons.push('PRINTER_NOT_READY');
  }

  return reasons;
}
