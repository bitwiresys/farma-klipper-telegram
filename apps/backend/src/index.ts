import 'dotenv/config';

import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';

async function main() {
  const app = await buildApp();

  await printerRuntime.initFromDb();

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
