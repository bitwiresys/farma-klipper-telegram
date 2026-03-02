import 'dotenv/config';

import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';

const app = await buildApp();

app.listen({ port: env.PORT, host: '0.0.0.0' }, (err: Error | null, address: string) => {
  if (err) {
    logger.error(err, 'failed to start');
    process.exit(1);
  }
  logger.info({ address }, 'listening');
});
