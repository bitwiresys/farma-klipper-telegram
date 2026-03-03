import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const envExamplePath = path.join(root, '.env.example');
const backendEnvTsPath = path.join(root, 'apps', 'backend', 'src', 'env.ts');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function extractBackendEnvKeys(envTs) {
  // heuristic: matches "KEY:" in z.object({ KEY: ... })
  const keys = new Set();
  const re = /\n\s*([A-Z0-9_]+)\s*:\s*/g;
  let m;
  while ((m = re.exec(envTs))) {
    keys.add(m[1]);
  }
  return keys;
}

function extractEnvExampleKeys(envExample) {
  const keys = new Set();
  for (const line of envExample.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key) keys.add(key);
  }
  return keys;
}

if (!fs.existsSync(envExamplePath)) {
  console.error('Missing .env.example');
  process.exit(1);
}

if (!fs.existsSync(backendEnvTsPath)) {
  console.error('Missing apps/backend/src/env.ts');
  process.exit(1);
}

const envTs = readText(backendEnvTsPath);
const envExample = readText(envExamplePath);

const backendKeys = extractBackendEnvKeys(envTs);
const exampleKeys = extractEnvExampleKeys(envExample);

// Only enforce that backend keys exist in example (frontend NEXT_PUBLIC keys are allowed too)
const missing = [...backendKeys].filter((k) => !exampleKeys.has(k));

if (missing.length) {
  console.error('Env sync check failed. Missing keys in .env.example:');
  for (const k of missing) console.error('-', k);
  process.exit(1);
}

process.exit(0);
