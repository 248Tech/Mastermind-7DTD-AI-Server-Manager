#!/usr/bin/env bash
# Start local dev: infra + optional hints for running control-plane and web in dev mode.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "==> Starting infra (Postgres, Redis)..."
cd infra
docker compose up -d
cd "$ROOT"

echo ""
echo "==> Infra up. Run in separate terminals:"
echo "    Terminal 2: cd control-plane && pnpm dev"
echo "    Terminal 3: cd web && pnpm dev"
echo ""
echo "    Web:        http://localhost:3000"
echo "    Control:    http://localhost:3001"
echo "    Health:     http://localhost:3001/health"
