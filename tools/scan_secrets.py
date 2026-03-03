import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

EXCLUDES = {
    'node_modules',
    '.git',
    '.next',
    'dist',
    'coverage',
    'apps/backend/prisma/migrations',
    'docs',
}

# Heuristic patterns (fail-fast). Keep intentionally broad.
PLACEHOLDERS = {
    '',
    'change_me',
    'change_me_min_16_chars',
    '<change_me>',
    '<redacted>',
    'REDACTED',
}

PATTERNS = [
    (re.compile(r'Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+'), 'JWT bearer token'),
    (re.compile(r'X-Api-Key\s*[:=]\s*[^\s\"\']{8,}', re.IGNORECASE), 'X-Api-Key header/value'),
]

ENV_ASSIGN_RE = re.compile(r'^(TELEGRAM_BOT_TOKEN|MOONRAKER_API_KEY|PRINTER_API_KEY_ENC_KEY|JWT_SECRET)\s*=\s*(.*)$')

# File extensions to scan
SCAN_EXTS = {
    '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.txt', '.env', '.example'
}


def should_exclude(rel_path: str) -> bool:
    # Local env files should never be scanned; they can exist untracked.
    base = os.path.basename(rel_path)
    if base == '.env' or base.startswith('.env.'):
        return True

    parts = rel_path.replace('\\', '/').split('/')
    for p in parts:
        if p in EXCLUDES:
            return True
    for ex in EXCLUDES:
        if rel_path.replace('\\', '/').startswith(ex + '/'):
            return True
    return False


def main() -> int:
    hits = []

    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir == '.':
            rel_dir = ''

        if rel_dir and should_exclude(rel_dir):
            dirnames[:] = []
            continue

        # prune excluded subdirs early
        dirnames[:] = [d for d in dirnames if not should_exclude(os.path.join(rel_dir, d) if rel_dir else d)]

        for fn in filenames:
            rel = os.path.join(rel_dir, fn) if rel_dir else fn
            if should_exclude(rel):
                continue
            _, ext = os.path.splitext(fn)
            if ext and ext not in SCAN_EXTS:
                continue

            abs_path = os.path.join(dirpath, fn)
            try:
                with open(abs_path, 'rb') as f:
                    raw = f.read()
                try:
                    text = raw.decode('utf-8', errors='replace')
                except Exception:
                    continue
            except Exception:
                continue

            for rx, label in PATTERNS:
                if rx.search(text):
                    hits.append((rel.replace('\\', '/'), label))

            # Env-style assignment checks (skip placeholders)
            for line in text.splitlines():
                m = ENV_ASSIGN_RE.match(line.strip())
                if not m:
                    continue
                key = m.group(1)
                val = m.group(2).strip()
                if '#' in val:
                    val = val.split('#', 1)[0].strip()
                if val in PLACEHOLDERS:
                    continue
                # quoted placeholders
                if val.strip('"\'') in PLACEHOLDERS:
                    continue
                hits.append((rel.replace('\\', '/'), f'{key} assignment'))

    if hits:
        sys.stderr.write('Secret scan failed. Potential secrets detected:\n')
        for rel, label in hits:
            sys.stderr.write(f'- {rel}: {label}\n')
        return 1

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
