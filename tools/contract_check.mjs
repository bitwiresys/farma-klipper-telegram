import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`contract_check: ${msg}`);
  process.exit(1);
}

function uniqSorted(arr) {
  return Array.from(new Set(arr)).sort();
}

function diff(a, b) {
  const as = new Set(a);
  const bs = new Set(b);
  const onlyA = a.filter((x) => !bs.has(x));
  const onlyB = b.filter((x) => !as.has(x));
  return { onlyA: uniqSorted(onlyA), onlyB: uniqSorted(onlyB) };
}

function extractStringLiteralsFromArray(source, arrayName) {
  const m = source.match(
    new RegExp(
      `export\\s+const\\s+${arrayName}\\s*=\\s*\\[(\\s*[\\s\\S]*?\\s*)\\]\\s*as\\s+const;`,
      'm',
    ),
  );
  if (!m) fail(`Cannot find ${arrayName} array`);
  const body = m[1];
  const values = [];
  for (const mm of body.matchAll(/'([^']+)'/g)) values.push(mm[1]);
  return uniqSorted(values);
}

function extractUnionStringLiterals(source, typeName) {
  const m = source.match(
    new RegExp(
      `export\\s+type\\s+${typeName}\\s*=\\s*([\\s\\S]*?);\\s*\n`,
      'm',
    ),
  );
  if (!m) fail(`Cannot find type ${typeName}`);
  const rhs = m[1];
  const values = [];
  for (const mm of rhs.matchAll(/\|\s*'([^']+)'/g)) values.push(mm[1]);
  return uniqSorted(values);
}

function extractTypeKeys(source, typeName) {
  const m = source.match(
    new RegExp(
      `export\\s+type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\};`,
      'm',
    ),
  );
  if (!m) fail(`Cannot find object type ${typeName}`);
  const body = m[1];

  const keys = [];
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith('//')) continue;
    if (l.startsWith('}')) continue;
    if (l.startsWith(']')) continue;

    const mm = l.match(/^([a-zA-Z0-9_]+)\s*:\s*/);
    if (mm) keys.push(mm[1]);
  }
  return uniqSorted(keys);
}

async function main() {
  const sharedEnumsPath = path.join(repoRoot, 'packages/shared/src/enums.ts');
  const sharedDtoPath = path.join(repoRoot, 'packages/shared/src/dto.ts');
  const feDtoPath = path.join(repoRoot, 'apps/frontend/app/lib/dto.ts');

  const [sharedEnums, sharedDto, feDto] = await Promise.all([
    fs.readFile(sharedEnumsPath, 'utf8'),
    fs.readFile(sharedDtoPath, 'utf8'),
    fs.readFile(feDtoPath, 'utf8'),
  ]);

  const sharedReasons = extractStringLiteralsFromArray(
    sharedEnums,
    'COMPATIBILITY_REASONS',
  );
  const feReasons = extractUnionStringLiterals(feDto, 'CompatibilityReason');

  {
    const d = diff(sharedReasons, feReasons);
    if (d.onlyA.length || d.onlyB.length) {
      fail(
        `CompatibilityReason mismatch\n` +
          `  only in shared: ${JSON.stringify(d.onlyA)}\n` +
          `  only in frontend: ${JSON.stringify(d.onlyB)}`,
      );
    }
  }

  const typesToCheck = [
    'PrinterSnapshotDto',
    'PrinterDto',
    'PresetDto',
    'PrintHistoryDto',
  ];

  for (const t of typesToCheck) {
    const sharedKeys = extractTypeKeys(sharedDto, t);
    const feKeys = extractTypeKeys(feDto, t);
    const d = diff(sharedKeys, feKeys);
    if (d.onlyA.length || d.onlyB.length) {
      fail(
        `${t} keys mismatch\n` +
          `  only in shared: ${JSON.stringify(d.onlyA)}\n` +
          `  only in frontend: ${JSON.stringify(d.onlyB)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log('contract_check: OK');
}

main().catch((e) => {
  fail(e?.stack || String(e));
});
