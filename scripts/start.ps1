# Mastermind — Windows one-command start.
# Starts Docker infra, migrates + seeds the DB, launches control plane and web UI.
#
# Usage (from repo root):
#   .\scripts\start.ps1
#   .\scripts\start.ps1 -NoMigrate    # skip DB migrate+seed (already done)
#   .\scripts\start.ps1 -NoBuild      # skip agent cross-compile
#
# First time? Run .\scripts\setup.ps1 first.
param(
    [switch]$NoMigrate,
    [switch]$NoBuild
)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

function Write-Step  { param([string]$msg) Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "    !   $msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$msg) Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── 1. Build Go agent (optional) ─────────────────────────────────────────────
if (-not $NoBuild) {
    Write-Step "Building Go agent binaries..."
    $AgentSrc  = "$Root\agent"
    $PublicDir = "$Root\control-plane\public\agents"
    New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null

    $Platforms = @(
        @{ GOOS = "linux";   GOARCH = "amd64"; Out = "mastermind-agent-linux-amd64" },
        @{ GOOS = "linux";   GOARCH = "arm64"; Out = "mastermind-agent-linux-arm64" },
        @{ GOOS = "darwin";  GOARCH = "amd64"; Out = "mastermind-agent-darwin-amd64" },
        @{ GOOS = "darwin";  GOARCH = "arm64"; Out = "mastermind-agent-darwin-arm64" },
        @{ GOOS = "windows"; GOARCH = "amd64"; Out = "mastermind-agent-windows-amd64.exe" }
    )

    foreach ($p in $Platforms) {
        $env:GOOS   = $p.GOOS
        $env:GOARCH = $p.GOARCH
        $outPath = "$PublicDir\$($p.Out)"
        try {
            go build -o $outPath "$AgentSrc\..." 2>&1 | Out-Null
            Write-Ok "$($p.GOOS)/$($p.GOARCH)"
        } catch {
            Write-Warn "Failed $($p.GOOS)/$($p.GOARCH): $_"
        }
    }
    Remove-Item Env:\GOOS   -ErrorAction SilentlyContinue
    Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
}

# ── 2. Start Docker infra ─────────────────────────────────────────────────────
Write-Step "Starting Docker infra (Postgres + Redis)..."
Set-Location "$Root\infra"
docker compose up -d
Set-Location $Root
Write-Ok "Infra containers started"

# ── 3. Wait for Postgres ──────────────────────────────────────────────────────
Write-Step "Waiting for Postgres on port 5432..."
$maxWait = 30
$waited  = 0
do {
    Start-Sleep -Seconds 1
    $waited++
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect("localhost", 5432)
        $conn.Close()
        break
    } catch { }
} while ($waited -lt $maxWait)

if ($waited -ge $maxWait) {
    Write-Warn "Postgres did not become ready in ${maxWait}s — proceeding anyway"
} else {
    Write-Ok "Postgres ready (${waited}s)"
}

# ── 4. Migrate + seed ─────────────────────────────────────────────────────────
if (-not $NoMigrate) {
    Write-Step "Running database migrations..."
    Set-Location "$Root\control-plane"
    pnpm prisma migrate deploy
    Write-Ok "Migrations applied"

    Write-Step "Seeding database..."
    try {
        npx ts-node prisma/seed.ts
        Write-Ok "Seed complete"
    } catch {
        Write-Warn "Seed failed (may already be seeded): $_"
    }
    Set-Location $Root
}

# ── 5. Find available ports ───────────────────────────────────────────────────
function Find-FreePort {
    param([int]$Start)
    $port = $Start
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
            $listener.Start()
            $listener.Stop()
            return $port
        } catch {
            $port++
        }
    }
    return $Start
}

$CpPort  = Find-FreePort 3001
$WebPort = Find-FreePort 3000

# ── 6. Start control plane ────────────────────────────────────────────────────
Write-Step "Starting control plane on port $CpPort..."
$CpLog = "$Root\cp.log"
$CpEnv = @{} + [System.Environment]::GetEnvironmentVariables()
$CpEnv["PORT"] = "$CpPort"
$CpJob = Start-Job -ScriptBlock {
    param($dir, $port, $logFile)
    Set-Location $dir
    $env:PORT = $port
    pnpm dev *> $logFile 2>&1
} -ArgumentList "$Root\control-plane", "$CpPort", $CpLog
Write-Ok "Control plane starting (PID job $($CpJob.Id)) — logs: cp.log"

# ── 7. Start web UI ───────────────────────────────────────────────────────────
Write-Step "Starting web UI on port $WebPort..."
$WebLog = "$Root\web.log"
$WebJob = Start-Job -ScriptBlock {
    param($dir, $port, $cpPort, $logFile)
    Set-Location $dir
    $env:PORT = $port
    $env:NEXT_PUBLIC_CONTROL_PLANE_URL = "http://localhost:$cpPort"
    pnpm dev *> $logFile 2>&1
} -ArgumentList "$Root\web", "$WebPort", "$CpPort", $WebLog
Write-Ok "Web UI starting (PID job $($WebJob.Id)) — logs: web.log"

# ── 8. Summary ────────────────────────────────────────────────────────────────
Start-Sleep -Seconds 3
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Mastermind is starting up" -ForegroundColor Green
Write-Host ""
Write-Host "  Web UI      : http://localhost:$WebPort"
Write-Host "  Control API : http://localhost:$CpPort"
Write-Host "  Health      : http://localhost:$CpPort/health"
Write-Host ""
Write-Host "  Default login: admin@mastermind.local / changeme"
Write-Host ""
Write-Host "  Logs: .\cp.log   .\web.log"
Write-Host "  Stop: Ctrl+C, then: Stop-Job $($CpJob.Id),$($WebJob.Id)"
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop..." -ForegroundColor Yellow

try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Write-Host ""
    Write-Host "Stopping services..." -ForegroundColor Yellow
    Stop-Job -Id $CpJob.Id  -ErrorAction SilentlyContinue
    Stop-Job -Id $WebJob.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $CpJob.Id  -Force -ErrorAction SilentlyContinue
    Remove-Job -Id $WebJob.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
}
