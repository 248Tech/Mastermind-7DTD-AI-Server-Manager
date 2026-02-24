# Start local dev (Windows PowerShell): infra + hints for control-plane and web.
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

Write-Host "==> Starting infra (Postgres, Redis)..."
Set-Location infra
docker compose up -d
Set-Location $Root

Write-Host ""
Write-Host "==> Infra up. Run in separate terminals:"
Write-Host "    Terminal 2: cd control-plane; pnpm dev"
Write-Host "    Terminal 3: cd web; pnpm dev"
Write-Host ""
Write-Host "    Web:        http://localhost:3000"
Write-Host "    Control:    http://localhost:3001"
Write-Host "    Health:     http://localhost:3001/health"
