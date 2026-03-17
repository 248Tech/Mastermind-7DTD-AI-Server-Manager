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
  (cd control-plane && pnpm install && pnpm prisma generate)
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
echo "==> Bootstrap done."
echo ""
echo "    ─────────────────────────────────────────────"
echo "    QUICKSTART (recommended for first-time setup)"
echo "    ─────────────────────────────────────────────"
echo "    Run the one-command setup (starts Docker + migrates + seeds):"
echo ""
echo "      make setup"
echo ""
echo "    Or manually:"
echo "      1. make up                     (start Postgres + Redis)"
echo "      2. make migrate                (run DB migration + seed)"
echo "      3. cd control-plane && pnpm dev   (start API on :3001)"
echo "         cd web && pnpm dev             (start UI on :3000)"
echo ""
echo "    Open http://localhost:3000 and sign in:"
echo "      Email:    admin@mastermind.local"
echo "      Password: changeme"
echo "    ─────────────────────────────────────────────"
