import 'dotenv/config';

import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';
import { startTelegramBot } from './telegram_bot.js';
import {
  NotificationService,
  PrismaNotificationRepo,
  getPrinterDisplayNameFromDb,
  listNotificationUsersFromDb,
} from './notification_service.js';

async function main() {
  const app = await buildApp();

  const bot = startTelegramBot();

  const notificationService = new NotificationService({
    sender: {
      sendMessage: async (chatId, text) => {
        await bot.telegram.sendMessage(chatId, text);
      },
    },
    repo: new PrismaNotificationRepo(),
    getSnapshot: (printerId) => printerRuntime.getSnapshot(printerId),
    getOrCreatePrintSessionId: ({ printerId, filename, state }) =>
      printerRuntime.getOrCreatePrintSessionId(printerId, { filename, state }),
    clearPrintSession: (printerId) =>
      printerRuntime.clearPrintSession(printerId),
    listUsers: () => listNotificationUsersFromDb(),
    getPrinterDisplayName: (printerId) =>
      getPrinterDisplayNameFromDb(printerId),
  });

  printerRuntime.setOnRawStatusUpdate((printerId, rawStatus) => {
    void notificationService.onStatusUpdate(printerId, rawStatus);
  });

  printerRuntime.setOnGcodeResponse((printerId, line) => {
    notificationService.onGcodeResponse(printerId, line);
  });

  await printerRuntime.initFromDb();

  // Iteration 4: periodic history backfill in case realtime events were missed
  setInterval(() => {
    void printerRuntime.backfillHistoryForAllPrinters({ limit: 50 });
  }, 5 * 60_000);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  try {
    await app.listen(
      { port: env.PORT, host: '0.0.0.0' },
      (err: Error | null, address: string) => {
        if (err) {
          logger.error(err, 'failed to start');
          process.exit(1);
        }
        logger.info({ address }, 'listening');
      },
    );
  } catch (e) {
    logger.error(e);
    process.exit(1);
  }
}

main();
