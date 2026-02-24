#!/usr/bin/env bash
# Bootstrap: install deps, copy env, (optionally) start compose.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "==> Checking tools..."
"$SCRIPT_DIR/doctor.sh" || true

echo ""
echo "==> Installing dependencies..."
if [ -f "package.json" ]; then
  pnpm install
fi
if [ -d "control-plane" ] && [ -f "control-plane/package.json" ]; then
  (cd control-plane && pnpm install)
fi
if [ -d "web" ] && [ -f "web/package.json" ]; then
  (cd web && pnpm install)
fi

echo ""
echo "==> Env files..."
for f in .env.example control-plane/.env.example web/.env.example; do
  if [ -f "$f" ]; then
    dest="${f%.example}"
    if [ ! -f "$dest" ]; then
      cp "$f" "$dest"
      echo "    Created $dest from $f"
    else
      echo "    $dest already exists"
    fi
  fi
done

echo ""
echo "==> Bootstrap done. Next: make up   (or: cd infra && docker compose up -d)"
echo "    Then open http://localhost:3000 (web) and http://localhost:3001/health (control plane)."
