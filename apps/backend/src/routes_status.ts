import type { FastifyInstance } from 'fastify';

import { execSync } from 'node:child_process';
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

let cachedGitCommit: string | null = null;

function getGitCommit(): string {
  if (cachedGitCommit !== null) return cachedGitCommit;
  try {
    const hash = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    cachedGitCommit = hash.slice(0, 7);
    return cachedGitCommit;
  } catch {
    cachedGitCommit = 'unknown';
    return cachedGitCommit;
  }
}

export async function registerStatusRoutes(app: FastifyInstance) {
  app.get('/api/status', async () => {
    return {
      version: getBackendVersion(),
      gitCommit: getGitCommit(),
      uptimeSec: Math.floor(process.uptime()),
    };
  });
}
