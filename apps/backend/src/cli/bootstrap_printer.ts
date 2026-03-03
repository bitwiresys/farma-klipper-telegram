import 'dotenv/config';

import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { encryptApiKey } from '../crypto_api_key.js';
import { MoonrakerHttp } from '../moonraker_http.js';

async function main() {
  const baseUrl = process.env.MOONRAKER_BASE_URL_BOOTSTRAP ?? 'http://192.168.0.45:7125';
  const apiKey = process.env.MOONRAKER_API_KEY_BOOTSTRAP;
  if (!apiKey) {
    throw new Error('MOONRAKER_API_KEY_BOOTSTRAP is required');
  }

  const existingModel = await prisma.printerModel.findFirst({ where: { name: 'Test Model' } });
  const model =
    existingModel ??
    (await prisma.printerModel.create({
      data: { name: 'Test Model' },
    }));

  const http = new MoonrakerHttp({ baseUrl, apiKey });

  const toolheadResp = (await http.queryObjects(['toolhead'])) as any;
  const configResp = (await http.queryObjects(['configfile'])) as any;

  const toolhead = toolheadResp?.result?.status?.toolhead ?? toolheadResp?.status?.toolhead;
  const axisMin = toolhead?.axis_minimum;
  const axisMax = toolhead?.axis_maximum;

  const bedX = Array.isArray(axisMin) && Array.isArray(axisMax) ? Number(axisMax[0]) - Number(axisMin[0]) : 0;
  const bedY = Array.isArray(axisMin) && Array.isArray(axisMax) ? Number(axisMax[1]) - Number(axisMin[1]) : 0;
  const bedZ = Array.isArray(axisMin) && Array.isArray(axisMax) ? Number(axisMax[2]) - Number(axisMin[2]) : 0;

  const nozzleDiameterRaw =
    configResp?.result?.status?.configfile?.settings?.extruder?.nozzle_diameter ??
    configResp?.status?.configfile?.settings?.extruder?.nozzle_diameter;
  const nozzleDiameter = Number(nozzleDiameterRaw) || 0.4;

  const apiKeyEncrypted = encryptApiKey(apiKey, env.PRINTER_API_KEY_ENC_KEY);

  await prisma.printer.upsert({
    where: { baseUrl },
    create: {
      displayName: 'Test Printer',
      baseUrl,
      apiKeyEncrypted,
      needsRekey: false,
      bedX,
      bedY,
      bedZ,
      nozzleDiameter,
      modelId: model.id,
    },
    update: {
      displayName: 'Test Printer',
      apiKeyEncrypted,
      needsRekey: false,
      bedX,
      bedY,
      bedZ,
      nozzleDiameter,
      modelId: model.id,
    },
  });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
