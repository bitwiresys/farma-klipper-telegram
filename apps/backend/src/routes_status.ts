import type { FastifyInstance } from 'fastify';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function getBackendVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as any;
    return typeof parsed?.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function registerStatusRoutes(app: FastifyInstance) {
  app.get('/api/status', async () => {
    return {
      version: getBackendVersion(),
      uptimeSec: Math.floor(process.uptime()),
    };
  });
}
