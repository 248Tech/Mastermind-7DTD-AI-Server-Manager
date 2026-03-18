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
echo "==> Building Go agent binaries..."
if command -v go &>/dev/null && [ -d "agent" ]; then
  AGENTS_OUT="$ROOT/control-plane/public/agents"
  mkdir -p "$AGENTS_OUT"
  HOST_OS="$(go env GOOS 2>/dev/null || echo linux)"
  HOST_ARCH="$(go env GOARCH 2>/dev/null || echo amd64)"
  (cd agent && CGO_ENABLED=0 go build -ldflags="-s -w" -o "$AGENTS_OUT/mastermind-agent-${HOST_OS}-${HOST_ARCH}" ./...) \
    && echo "    Built native agent (${HOST_OS}/${HOST_ARCH})" \
    || echo "    WARNING: agent build failed"
  for row in "linux amd64 mastermind-agent-linux-amd64" "linux arm64 mastermind-agent-linux-arm64" \
             "windows amd64 mastermind-agent-windows-amd64.exe" \
             "darwin amd64 mastermind-agent-darwin-amd64" "darwin arm64 mastermind-agent-darwin-arm64"; do
    set -- $row
    [ "$1/$2" = "$HOST_OS/$HOST_ARCH" ] && continue
    (cd agent && CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -ldflags="-s -w" -o "$AGENTS_OUT/$3" ./...) \
      && echo "    Built $3" || true
  done
else
  echo "    Go not found — skipping agent build (run 'bash scripts/start.sh' once Go is installed)"
fi

echo ""
echo "==> Bootstrap done."
echo ""
echo "    ─────────────────────────────────────────────"
echo "    QUICKSTART (recommended for first-time setup)"
echo "    ─────────────────────────────────────────────"
echo "    One command to start everything:"
echo ""
echo "      bash scripts/start.sh"
echo "      (or: make start)"
echo ""
echo "    Or step-by-step:"
echo "      1. make up                     (start Postgres + Redis)"
echo "      2. make migrate                (run DB migration + seed)"
echo "      3. cd control-plane && pnpm dev   (start API on :3001)"
echo "         cd web && pnpm dev             (start UI on :3000)"
echo ""
echo "    Open http://localhost:3000 and sign in:"
echo "      Email:    admin@mastermind.local"
echo "      Password: changeme"
echo "    ─────────────────────────────────────────────"
