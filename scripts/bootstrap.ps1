param(
  [switch]$SkipDoctor,
  [switch]$SkipBuild
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

function Remove-NodeModules {
  foreach ($path in @(
    (Join-Path $root "node_modules"),
    (Join-Path $root "control-plane\node_modules"),
    (Join-Path $root "web\node_modules")
  )) {
    if (Test-Path $path) {
      Note ("Removing " + $path)
      cmd /c "rmdir /s /q `"$path`"" *> $null
    }
  }
}

if (-not $SkipDoctor) {
  Step "Checking required tools"
  & "$scriptDir\doctor.ps1" -SkipGo:$SkipBuild
  if ($LASTEXITCODE -ne 0) {
    throw "Tool check failed. Resolve doctor errors and retry."
  }
}

Step "Installing Node dependencies"
try {
  Invoke-OrThrow "pnpm" @("install")
} catch {
  Note "Initial pnpm install failed. Retrying after node_modules cleanup..."
  Remove-NodeModules
  Invoke-OrThrow "pnpm" @("install")
}

Push-Location "$root\control-plane"
try {
  Invoke-OrThrow "pnpm" @("prisma:generate")
} finally {
  Pop-Location
}

Step "Ensuring env files exist"
foreach ($example in @(".env.example", "control-plane/.env.example", "web/.env.example", "infra/.env.example")) {
  $src = Join-Path $root $example
  if (-not (Test-Path $src)) { continue }
  $dest = $src -replace "\.example$", ""
  if (-not (Test-Path $dest)) {
    Copy-Item $src $dest
    Note ("Created " + (Resolve-Path $dest))
  } else {
    Note ((Split-Path $dest -Leaf) + " already exists")
  }
}

if (-not $SkipBuild) {
  Step "Building agent binaries"
  $go = Get-Command go -ErrorAction SilentlyContinue
  if (-not $go) {
    throw "Go is required to build the agent binaries. Install Go 1.22+ or run with -SkipBuild."
  }

  $agentsOut = Join-Path $root "control-plane\public\agents"
  New-Item -ItemType Directory -Path $agentsOut -Force | Out-Null

  $hostOs = (& go env GOOS).Trim()
  $hostArch = (& go env GOARCH).Trim()
  Push-Location "$root\agent"
  try {
    Invoke-OrThrow "go" @("build", "-ldflags=-s -w", "-o", (Join-Path $agentsOut "mastermind-agent-$hostOs-$hostArch"), ".")

    $targets = @(
      @{ os = "linux"; arch = "amd64"; out = "mastermind-agent-linux-amd64" },
      @{ os = "linux"; arch = "arm64"; out = "mastermind-agent-linux-arm64" },
      @{ os = "windows"; arch = "amd64"; out = "mastermind-agent-windows-amd64.exe" },
      @{ os = "darwin"; arch = "amd64"; out = "mastermind-agent-darwin-amd64" },
      @{ os = "darwin"; arch = "arm64"; out = "mastermind-agent-darwin-arm64" }
    )

    foreach ($t in $targets) {
      if ($t.os -eq $hostOs -and $t.arch -eq $hostArch) { continue }
      try {
        $env:CGO_ENABLED = "0"
        $env:GOOS = $t.os
        $env:GOARCH = $t.arch
        Invoke-OrThrow "go" @("build", "-ldflags=-s -w", "-o", (Join-Path $agentsOut $t.out), ".")
        Note ("Built " + $t.out)
      } catch {
        Note ("Skipped " + $t.os + "/" + $t.arch + " (non-fatal)")
      } finally {
        Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
        Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
        Remove-Item Env:\CGO_ENABLED -ErrorAction SilentlyContinue
      }
    }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
