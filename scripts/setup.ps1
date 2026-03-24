param(
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Set-Location $root

function Step([string]$Message) {
  Write-Host ""
  Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Invoke-OrThrow([string]$Tool, [string[]]$Arguments) {
  & $Tool @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Tool failed with exit code $LASTEXITCODE"
  }
}

Step "Checking required tools"
& "$scriptDir\doctor.ps1" -SkipGo:$NoBuild -RequireDockerDaemon
if ($LASTEXITCODE -ne 0) {
  throw "Tool check failed. Resolve doctor errors and retry."
}

Step "Bootstrapping dependencies"
& "$scriptDir\bootstrap.ps1" -SkipDoctor -SkipBuild:$NoBuild

Step "Starting Postgres + Redis"
Push-Location "$root\infra"
try {
  Invoke-OrThrow "docker" @("compose", "up", "-d", "postgres", "redis")
} finally {
  Pop-Location
}

Step "Waiting for Postgres"
$ready = $false
Push-Location "$root\infra"
try {
  for ($i = 0; $i -lt 30; $i++) {
    & docker compose exec -T postgres pg_isready -U mastermind -d mastermind *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
} finally {
  Pop-Location
}
if (-not $ready) {
  throw "Postgres did not become ready in time."
}

Step "Running Prisma push + seed"
Push-Location "$root\control-plane"
try {
  Invoke-OrThrow "pnpm" @("prisma", "db", "push", "--accept-data-loss")
  Invoke-OrThrow "pnpm" @("prisma:seed")
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start services with either:" -ForegroundColor Green
Write-Host "  make start" -ForegroundColor Green
Write-Host "  or run each service manually (control-plane/web)." -ForegroundColor Green
