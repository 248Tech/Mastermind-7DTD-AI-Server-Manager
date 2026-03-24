param(
  [switch]$SkipGo,
  [switch]$RequireDockerDaemon
)

$ErrorActionPreference = 'Stop'

function Write-Ok([string]$Message) {
  Write-Host ("[ok]   " + $Message) -ForegroundColor Green
}

function Write-Fail([string]$Message) {
  Write-Host ("[fail] " + $Message) -ForegroundColor Red
}

function Check-Tool([string]$Tool, [string[]]$VersionArgs) {
  $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Fail "$Tool not found"
    return $false
  }
  $output = & $Tool @VersionArgs 2>&1
  $version = [string]($output | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
    Write-Fail "$Tool found but version check failed"
    return $false
  }
  Write-Ok ("{0}: {1}" -f $Tool, $version.Trim())
  return $true
}

function Check-DockerDaemon {
  $output = cmd /c 'docker info --format "{{.ServerVersion}}" 2>nul'
  $version = [string]($output | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
    Write-Fail "docker daemon unavailable"
    Write-Host "       Start Docker Desktop (or docker engine) and retry." -ForegroundColor Yellow
    return $false
  }
  Write-Ok ("docker daemon: " + $version.Trim())
  return $true
}

$failed = $false

if (-not (Check-Tool "node" @("--version"))) { $failed = $true }
if (-not (Check-Tool "pnpm" @("--version"))) { $failed = $true }
if (-not $SkipGo -and -not (Check-Tool "go" @("version"))) { $failed = $true }
if (-not (Check-Tool "docker" @("--version"))) { $failed = $true }
if (-not (Check-Tool "docker" @("compose", "version"))) { $failed = $true }
if ($RequireDockerDaemon -and -not $failed -and -not (Check-DockerDaemon)) { $failed = $true }

if ($failed) {
  Write-Host ""
  Write-Host "Fix missing tools and/or Docker daemon availability, then retry." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "All required tools are installed." -ForegroundColor Green
