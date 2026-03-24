param(
  [switch]$NoBuild,
  [switch]$NoMigrate
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Set-Location $root

function Step([string]$Message) {
  Write-Host ""
  Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Note([string]$Message) {
  Write-Host ("    " + $Message) -ForegroundColor Gray
}

function Invoke-OrThrow([string]$Tool, [string[]]$Arguments) {
  & $Tool @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Tool failed with exit code $LASTEXITCODE"
  }
}

function Test-PortOpen([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(250)
    if (-not $ok) { return $false }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Find-AvailablePort([int]$Preferred) {
  $port = $Preferred
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Test-PortOpen $port)) {
      return $port
    }
    $port++
  }
  throw "No free port found near $Preferred"
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

if (-not $NoMigrate) {
  Step "Running Prisma push + seed"
  Push-Location "$root\control-plane"
  try {
    Invoke-OrThrow "pnpm" @("prisma", "db", "push", "--accept-data-loss")
    Invoke-OrThrow "pnpm" @("prisma:seed")
  } finally {
    Pop-Location
  }
} else {
  Step "Skipping migration (--NoMigrate)"
}

$cpPort = Find-AvailablePort 3001
$webPort = Find-AvailablePort 3000
if ($webPort -eq $cpPort) {
  $webPort = Find-AvailablePort ($cpPort + 1)
}
if ($cpPort -ne 3001) { Note "Port 3001 in use; control plane will use $cpPort" }
if ($webPort -ne 3000) { Note "Port 3000 in use; web will use $webPort" }

$logDir = Join-Path $root ".logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$cpLog = Join-Path $logDir "control-plane.log"
$webLog = Join-Path $logDir "web.log"

if (Test-Path $cpLog) { Remove-Item $cpLog -Force }
if (Test-Path $webLog) { Remove-Item $webLog -Force }

Step "Starting control plane"
$cpDir = (Join-Path $root "control-plane").Replace("'", "''")
$cpLogEsc = $cpLog.Replace("'", "''")
$cpCmd = "`$env:PORT='$cpPort'; Set-Location '$cpDir'; pnpm dev *> '$cpLogEsc'"
$cpProc = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $cpCmd -PassThru
Note ("Control plane PID " + $cpProc.Id)

Step "Waiting for control plane"
for ($i = 0; $i -lt 30; $i++) {
  if (Test-PortOpen $cpPort) { break }
  Start-Sleep -Seconds 1
}

Step "Starting web UI"
$webDir = (Join-Path $root "web").Replace("'", "''")
$webLogEsc = $webLog.Replace("'", "''")
$cpUrl = "http://localhost:$cpPort"
$webCmd = "`$env:PORT='$webPort'; `$env:NEXT_PUBLIC_CONTROL_PLANE_URL='$cpUrl'; Set-Location '$webDir'; pnpm dev *> '$webLogEsc'"
$webProc = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $webCmd -PassThru
Note ("Web PID " + $webProc.Id)

Write-Host ""
Write-Host "Mastermind is running." -ForegroundColor Green
Write-Host ("  Web:          http://localhost:{0}" -f $webPort)
Write-Host ("  Control plane http://localhost:{0}" -f $cpPort)
Write-Host ("  Health:       http://localhost:{0}/health" -f $cpPort)
Write-Host "  Login:        admin@mastermind.local / changeme"
Write-Host ""
Write-Host ("  Logs: " + $cpLog)
Write-Host ("        " + $webLog)
Write-Host ""
Write-Host "Press Ctrl+C to stop control-plane and web." -ForegroundColor Yellow

try {
  while ($true) {
    Start-Sleep -Seconds 1
  }
} finally {
  Write-Host ""
  Write-Host "Shutting down app processes..." -ForegroundColor Cyan
  if ($cpProc -and -not $cpProc.HasExited) {
    Stop-Process -Id $cpProc.Id -Force
  }
  if ($webProc -and -not $webProc.HasExited) {
    Stop-Process -Id $webProc.Id -Force
  }
  Write-Host "Control-plane and web stopped. Postgres/Redis remain running." -ForegroundColor Green
}
