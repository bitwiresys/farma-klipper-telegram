import type { PrinterDto } from './dto';

type LabelParts = {
  displayName: string;
  modelName: string;
  nozzleDiameter: number;
  bedX: number;
  bedY: number;
  index: number;
};

function fmtPrinterLabel(parts: LabelParts): string {
  const name = String(parts.displayName ?? '').trim();
  const model = String(parts.modelName ?? '').trim();
  const nozzle = Number(parts.nozzleDiameter);
  const bedX = Math.round(Number(parts.bedX));
  const bedY = Math.round(Number(parts.bedY));

  const nozzleTxt = Number.isFinite(nozzle) ? nozzle.toFixed(1) : '?';
  const bedTxt =
    Number.isFinite(bedX) && Number.isFinite(bedY) ? `${bedX}x${bedY}` : '?x?';

  return `${name}_${model}_${nozzleTxt}_${bedTxt}_#${parts.index}`;
}

export function buildPrinterLabelById(
  printers: PrinterDto[],
): Map<string, string> {
  const sorted = [...printers].sort((a, b) => {
    const am = String(a.modelId ?? '');
    const bm = String(b.modelId ?? '');
    if (am !== bm) return am.localeCompare(bm);
    return String(a.displayName ?? '').localeCompare(
      String(b.displayName ?? ''),
    );
  });

  const idxByModel = new Map<string, number>();
  const labelById = new Map<string, string>();

  for (const p of sorted) {
    const key = String(p.modelId ?? '');
    const nextIdx = (idxByModel.get(key) ?? 0) + 1;
    idxByModel.set(key, nextIdx);

    labelById.set(
      p.id,
      fmtPrinterLabel({
        displayName: p.displayName,
        modelName: p.modelName,
        nozzleDiameter: p.nozzleDiameter,
        bedX: p.bedX,
        bedY: p.bedY,
        index: nextIdx,
      }),
    );
  }

  return labelById;
}
