import type { CompatibilityReason, PrinterState } from './enums.js';
import type { PresetCompatibilityRulesDto, PrinterDto } from './dto.js';

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

  const state = printer.snapshot?.state as PrinterState | undefined;

  if (state === 'offline') {
    reasons.push('OFFLINE');
  } else if (state === 'printing' || state === 'paused') {
    reasons.push('PRINTER_BUSY');
  } else if (state !== 'standby') {
    reasons.push('PRINTER_NOT_READY');
  }

  return reasons;
}
