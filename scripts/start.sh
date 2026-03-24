#!/usr/bin/env bash
# Mastermind — one-command start.
# Installs deps, builds the Go agent for all platforms, starts Docker infra,
# migrates + seeds the database, then launches the control plane and web UI.
#
# Usage:
#   bash scripts/start.sh           # first run + every subsequent run
#   bash scripts/start.sh --no-build   # skip agent cross-compile (faster restarts)
#   bash scripts/start.sh --no-migrate # skip DB migrate+seed (already done)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ─── Flags ────────────────────────────────────────────────────────────────────
SKIP_BUILD=0; SKIP_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --no-build)   SKIP_BUILD=1 ;;
    --no-migrate) SKIP_MIGRATE=1 ;;
  esac
done

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${CYAN}==>${NC} ${BOLD}$*${NC}"; }
ok()   { echo -e "    ${GREEN}✓${NC} $*"; }
warn() { echo -e "    ${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

# ─── Port helpers ─────────────────────────────────────────────────────────────
port_in_use() {
  if command -v nc &>/dev/null; then
    nc -z 127.0.0.1 "$1" 2>/dev/null; return $?
  elif command -v lsof &>/dev/null; then
    lsof -i "TCP:$1" -sTCP:LISTEN -t >/dev/null 2>&1; return $?
  fi
  return 1  # assume free if we can't check
}

find_port() {
  local port=$1
  local tries=0
  while port_in_use "$port" && [ $tries -lt 20 ]; do
    port=$((port + 1)); tries=$((tries + 1))
  done
  echo "$port"
}

# ─── 1. Doctor check ──────────────────────────────────────────────────────────
info "Checking required tools..."
"$SCRIPT_DIR/doctor.sh" --require-docker-daemon || die "Install missing tools/start Docker and re-run."

# ─── 2. Install JS dependencies ───────────────────────────────────────────────
info "Installing Node dependencies..."
pnpm install --silent 2>/dev/null || pnpm install
(cd control-plane && pnpm install --silent 2>/dev/null || pnpm install)
(cd control-plane && pnpm prisma generate --silent 2>/dev/null || pnpm prisma generate)
(cd web && pnpm install --silent 2>/dev/null || pnpm install)
ok "Node dependencies installed"

# ─── 3. Build Go agent binaries ───────────────────────────────────────────────
AGENTS_OUT="$ROOT/control-plane/public/agents"
mkdir -p "$AGENTS_OUT"

if [ $SKIP_BUILD -eq 0 ]; then
  info "Building Go agent binaries..."

  # Detect host platform for the native build
  HOST_OS="$(go env GOOS 2>/dev/null || echo linux)"
  HOST_ARCH="$(go env GOARCH 2>/dev/null || echo amd64)"

  # Always build native binary first (used by local install.sh)
  (
    cd agent
    CGO_ENABLED=0 go build -ldflags="-s -w" -o "$AGENTS_OUT/mastermind-agent-${HOST_OS}-${HOST_ARCH}" .
  ) && ok "Built native agent (${HOST_OS}/${HOST_ARCH})" || warn "Native agent build failed"

  # Cross-compile for every target; failure is non-fatal
  declare -a TARGETS=(
    "linux   amd64  mastermind-agent-linux-amd64"
    "linux   arm64  mastermind-agent-linux-arm64"
    "windows amd64  mastermind-agent-windows-amd64.exe"
    "darwin  amd64  mastermind-agent-darwin-amd64"
    "darwin  arm64  mastermind-agent-darwin-arm64"
  )
  for row in "${TARGETS[@]}"; do
    # shellcheck disable=SC2086
    set -- $row
    target_os=$1; target_arch=$2; outfile=$3
    # Skip if this is the same as the native build (already done)
    if [ "$target_os/$target_arch" = "$HOST_OS/$HOST_ARCH" ]; then continue; fi
    (
      cd agent
      CGO_ENABLED=0 GOOS="$target_os" GOARCH="$target_arch" \
        go build -ldflags="-s -w" -o "$AGENTS_OUT/$outfile" .
    ) && ok "Built $outfile" \
      || warn "Cross-compile skipped for ${target_os}/${target_arch} (non-fatal)"
  done
  ok "Agent binaries written to control-plane/public/agents/"
else
  warn "Skipping agent build (--no-build)"
fi

# ─── 4. Env files ─────────────────────────────────────────────────────────────
info "Setting up .env files..."
for f in .env.example control-plane/.env.example web/.env.example; do
  [ -f "$f" ] || continue
  dest="${f%.example}"
  if [ ! -f "$dest" ]; then
    cp "$f" "$dest"
    ok "Created $dest from example"
  fi
done

# ─── 5. Start Docker infra ────────────────────────────────────────────────────
info "Starting Postgres + Redis..."
(cd infra && docker compose up -d postgres redis)
ok "Docker infra started"

# ─── 6. Wait for Postgres ─────────────────────────────────────────────────────
info "Waiting for Postgres to accept connections..."
READY=0
for i in $(seq 1 30); do
  if docker compose -f infra/docker-compose.yml exec -T postgres \
       pg_isready -U mastermind -d mastermind >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 2
done
[ $READY -eq 1 ] && ok "Postgres ready" || die "Postgres did not become ready in time"

# ─── 7. Migrate + seed ────────────────────────────────────────────────────────
if [ $SKIP_MIGRATE -eq 0 ]; then
  info "Running database migrations and seed..."
  (cd control-plane && pnpm prisma db push --accept-data-loss 2>&1 | tail -3)
  (cd control-plane && pnpm prisma:seed 2>&1 | tail -5)
  ok "Database migrated and seeded"
else
  warn "Skipping migration (--no-migrate)"
fi

# ─── 8. Find available ports ──────────────────────────────────────────────────
CP_PORT=$(find_port 3001)
WEB_PORT=$(find_port 3000)
if [ "$WEB_PORT" = "$CP_PORT" ]; then
  WEB_PORT=$(find_port $((CP_PORT + 1)))
fi
[ "$CP_PORT" != "3001" ] && warn "Port 3001 in use — control plane will use :$CP_PORT"
[ "$WEB_PORT" != "3000" ] && warn "Port 3000 in use — web UI will use :$WEB_PORT"

# ─── 9. Start control plane ───────────────────────────────────────────────────
LOG_DIR="$ROOT/.logs"; mkdir -p "$LOG_DIR"
info "Starting control plane on :$CP_PORT..."
(
  cd control-plane
  PORT=$CP_PORT pnpm dev
) > "$LOG_DIR/control-plane.log" 2>&1 &
CP_PID=$!
ok "Control plane starting (PID $CP_PID) — log: .logs/control-plane.log"

# ─── 10. Wait for control plane to be ready ───────────────────────────────────
info "Waiting for control plane..."
READY=0
for i in $(seq 1 30); do
  if port_in_use "$CP_PORT"; then READY=1; break; fi
  sleep 2
done
[ $READY -eq 1 ] && ok "Control plane ready at http://localhost:$CP_PORT" \
  || warn "Control plane may still be starting — check .logs/control-plane.log"

# ─── 11. Start web UI ─────────────────────────────────────────────────────────
info "Starting web UI on :$WEB_PORT..."
(
  cd web
  PORT=$WEB_PORT NEXT_PUBLIC_CONTROL_PLANE_URL="http://localhost:$CP_PORT" pnpm dev
) > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
ok "Web UI starting (PID $WEB_PID) — log: .logs/web.log"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}${BOLD}  Mastermind is running!${NC}"
echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "    Web UI          ${CYAN}http://localhost:$WEB_PORT${NC}"
echo -e "    Control Plane   ${CYAN}http://localhost:$CP_PORT${NC}"
echo -e "    Health check    ${CYAN}http://localhost:$CP_PORT/health${NC}"
echo ""
echo -e "    Login           ${YELLOW}admin@mastermind.local${NC} / ${YELLOW}changeme${NC}"
echo ""
echo -e "    Agent downloads ${CYAN}http://localhost:$CP_PORT/agent/download/linux-amd64${NC}"
echo -e "                    ${CYAN}http://localhost:$CP_PORT/agent/download/linux-arm64${NC}"
echo -e "                    ${CYAN}http://localhost:$CP_PORT/agent/download/windows-amd64${NC}"
echo -e "                    ${CYAN}http://localhost:$CP_PORT/agent/download/darwin-arm64${NC}"
echo ""
echo -e "    Logs"
echo -e "      Control plane  .logs/control-plane.log"
echo -e "      Web UI         .logs/web.log"
echo ""
echo -e "    Press ${BOLD}Ctrl+C${NC} to stop all services."
echo ""

# ─── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo -e "${CYAN}==>${NC} Shutting down services..."
  kill "$CP_PID" "$WEB_PID" 2>/dev/null || true
  echo -e "    ${GREEN}✓${NC} Control plane and web UI stopped."
  echo -e "    Run ${BOLD}cd infra && docker compose down${NC} to also stop Postgres + Redis."
  exit 0
}
trap cleanup INT TERM

# Keep script alive so Ctrl+C works
wait
