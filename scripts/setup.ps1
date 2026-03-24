# Mastermind — Windows bootstrap / first-run setup.
# Installs Node deps, copies .env files, builds Go agent for all platforms.
#
# Usage (from repo root):
#   .\scripts\setup.ps1
#
# Prerequisites: Node 20+, pnpm 9+, Go 1.22+, Docker Desktop
#
# After setup, run:
#   .\scripts\start.ps1
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

function Write-Step  { param([string]$msg) Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "    !   $msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$msg) Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── 1. Check required tools ───────────────────────────────────────────────────
Write-Step "Checking required tools..."

function Require-Tool {
    param([string]$Tool, [string]$MinVersion, [string]$InstallUrl)
    if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
        Write-Fail "$Tool not found. Install from: $InstallUrl"
    }
    Write-Ok "$Tool found"
}

Require-Tool "node"   "20" "https://nodejs.org/"
Require-Tool "pnpm"   "9"  "https://pnpm.io/installation"
Require-Tool "go"     "1.22" "https://go.dev/dl/"
Require-Tool "docker" ""   "https://docs.docker.com/get-docker/"

# docker compose v2 check
try {
    docker compose version | Out-Null
    Write-Ok "docker compose (v2) found"
} catch {
    Write-Fail "docker compose (v2) not found. Install Docker Desktop >= 3.6."
}

# Node version check
$nodeVer = (node --version) -replace 'v',''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 20) { Write-Warn "node $nodeVer is below recommended 20.x" }

# pnpm version check
$pnpmVer = pnpm --version
$pnpmMajor = [int]($pnpmVer.Split('.')[0])
if ($pnpmMajor -lt 9) { Write-Warn "pnpm $pnpmVer is below recommended 9.x" }

# Go version check
$goVerLine = go version
if ($goVerLine -match 'go(\d+)\.(\d+)') {
    $goMajor = [int]$Matches[1]; $goMinor = [int]$Matches[2]
    if ($goMajor -lt 1 -or ($goMajor -eq 1 -and $goMinor -lt 22)) {
        Write-Warn "go $goMajor.$goMinor is below required 1.22"
    }
}

# ── 2. Copy .env files ────────────────────────────────────────────────────────
Write-Step "Setting up environment files..."

function Copy-EnvIfMissing {
    param([string]$Src, [string]$Dst)
    if (-not (Test-Path $Dst)) {
        if (Test-Path $Src) {
            Copy-Item $Src $Dst
            Write-Ok "Created $Dst from $Src"
        } else {
            Write-Warn "$Src not found — skipping"
        }
    } else {
        Write-Ok "$Dst already exists"
    }
}

Copy-EnvIfMissing "control-plane\.env.example" "control-plane\.env"
Copy-EnvIfMissing "web\.env.example"            "web\.env.local"

# ── 3. Install Node dependencies ─────────────────────────────────────────────
Write-Step "Installing Node dependencies..."
pnpm install
Set-Location "$Root\control-plane"
pnpm install
pnpm prisma generate
Set-Location $Root
Set-Location "$Root\web"
pnpm install
Set-Location $Root
Write-Ok "Node dependencies installed"

# ── 4. Build Go agent (all platforms) ────────────────────────────────────────
Write-Step "Building Go agent binaries..."

$AgentSrc   = "$Root\agent"
$PublicDir  = "$Root\control-plane\public\agents"
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
        Write-Ok "$($p.GOOS)/$($p.GOARCH) → $($p.Out)"
    } catch {
        Write-Warn "Failed to build $($p.GOOS)/$($p.GOARCH): $_"
    }
}

Remove-Item Env:\GOOS   -ErrorAction SilentlyContinue
Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit control-plane\.env  (set DB/Redis/JWT secrets if needed)"
Write-Host "  2. Run: .\scripts\start.ps1"
Write-Host ""
