param(
  [int]$TimeoutSec = 600,
  [string]$RepoDir = "~/apps/farma-klipper-telegram",
  [string]$ServiceName = "farma-backend.service",
  [switch]$SkipSharedBuild,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipMigrate,
  [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

function Invoke-Remote([string]$Cmd, [switch]$Sudo) {
  $args = @('ssh_exec.py', '--timeout', "$TimeoutSec")
  if ($Sudo) { $args += '--sudo' } else { $args += '--no-root' }
  $args += @('bash', '-lc', $Cmd)
  & python @args
  if ($LASTEXITCODE -ne 0) {
    throw "remote command failed ($LASTEXITCODE): $Cmd"
  }
}

Invoke-Remote "set -e; cd $RepoDir; git rev-parse --is-inside-work-tree >/dev/null" 

# transient GitHub/HTTP errors happen; retry fetch/pull a few times
$maxGitAttempts = 5
for ($i = 1; $i -le $maxGitAttempts; $i++) {
  try {
    Invoke-Remote "set -e; cd $RepoDir; git config http.postBuffer 524288000; git config http.version HTTP/1.1; git fetch --all --prune; git pull --ff-only" 
    break
  } catch {
    if ($i -eq $maxGitAttempts) { throw }
    Start-Sleep -Seconds (3 * $i)
  }
}

if (-not $SkipInstall) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm install" 
}

if (-not $SkipSharedBuild) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm --filter @farma/shared build" 
}

if (-not $SkipBuild) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm --filter @farma/backend build" 
}

if (-not $SkipMigrate) {
  # Reset SQLite DB and recreate schema without migrations.
  # We intentionally avoid `prisma migrate deploy` here.
  $cmd = @'
set -e
cd __REPO__/apps/backend
set -a
[ -f __REPO__/.env ] && . __REPO__/.env || true
[ -f ./.env ] && . ./.env || true
set +a

DBURL="${DATABASE_URL:-file:./dev.db}"
if echo "$DBURL" | grep -q '^file:'; then
  DBPATH="${DBURL#file:}"
  DBPATH="${DBPATH#./}"
  rm -f "$DBPATH"
fi

pnpm prisma db push --force-reset --accept-data-loss
'@

  $cmd = $cmd.Replace('__REPO__', $RepoDir)

  Invoke-Remote $cmd
}

if (-not $SkipRestart) {
  Invoke-Remote "set -e; systemctl restart $ServiceName" -Sudo
  Invoke-Remote "set -e; systemctl --no-pager --full status $ServiceName | head -n 80" -Sudo
}
