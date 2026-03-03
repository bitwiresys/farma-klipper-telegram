param(
  [int]$TimeoutSec = 600,
  [string]$RepoDir = "~/apps/farma-klipper-telegram",
  [string]$ServiceName = "farma-backend.service",
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
Invoke-Remote "set -e; cd $RepoDir; git fetch --all --prune; git pull --ff-only" 

if (-not $SkipInstall) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm install" 
}

if (-not $SkipBuild) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm --filter @farma/backend build" 
}

if (-not $SkipMigrate) {
  Invoke-Remote "set -e; cd $RepoDir; pnpm --filter @farma/backend prisma:deploy" 
}

if (-not $SkipRestart) {
  Invoke-Remote "set -e; systemctl restart $ServiceName" -Sudo
  Invoke-Remote "set -e; systemctl --no-pager --full status $ServiceName | head -n 80" -Sudo
}
