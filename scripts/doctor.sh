#!/usr/bin/env bash
# Doctor script: check required tooling and minimum versions for local dev.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

failed=0

# ── Node 20+ ──────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null | head -1)
  NODE_MAJOR=$(echo "$NODE_VER" | grep -oE '[0-9]+' | head -1 || echo "0")
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    echo -e "${GREEN}✓${NC} node $NODE_VER"
  else
    echo -e "${YELLOW}⚠${NC} node $NODE_VER (need >= 20)"
    failed=1
  fi
else
  echo -e "${RED}✗${NC} node not found"
  failed=1
fi

# ── pnpm 9+ ───────────────────────────────────────────────────────────────────
if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm --version 2>/dev/null | head -1 || echo "0")
  PNPM_MAJOR=$(echo "$PNPM_VER" | cut -d. -f1)
  if [ "${PNPM_MAJOR:-0}" -ge 9 ]; then
    echo -e "${GREEN}✓${NC} pnpm $PNPM_VER"
  else
    echo -e "${YELLOW}⚠${NC} pnpm $PNPM_VER (need >= 9)"
    failed=1
  fi
else
  echo -e "${RED}✗${NC} pnpm not found (install: npm i -g pnpm)"
  failed=1
fi

# ── Go 1.22+ ──────────────────────────────────────────────────────────────────
if command -v go &>/dev/null; then
  GO_RAW=$(go version 2>/dev/null | grep -oE 'go[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  GO_MAJOR=$(echo "$GO_RAW" | grep -oE '[0-9]+' | sed -n '1p' || echo "0")
  GO_MINOR=$(echo "$GO_RAW" | grep -oE '[0-9]+' | sed -n '2p' || echo "0")
  if [ "${GO_MAJOR:-0}" -gt 1 ] || ([ "${GO_MAJOR:-0}" -eq 1 ] && [ "${GO_MINOR:-0}" -ge 22 ]); then
    echo -e "${GREEN}✓${NC} go $(go version | awk '{print $3}')"
  else
    echo -e "${YELLOW}⚠${NC} go $(go version | awk '{print $3}') (need >= go1.22)"
    failed=1
  fi
else
  echo -e "${RED}✗${NC} go not found (https://go.dev/dl/)"
  failed=1
fi

# ── Docker ────────────────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version 2>/dev/null | head -1)
  echo -e "${GREEN}✓${NC} docker: $DOCKER_VER"
else
  echo -e "${RED}✗${NC} docker not found (https://docs.docker.com/get-docker/)"
  failed=1
fi

# ── Docker Compose v2 ─────────────────────────────────────────────────────────
if docker compose version &>/dev/null 2>&1; then
  DC_VER=$(docker compose version 2>/dev/null | head -1)
  echo -e "${GREEN}✓${NC} docker compose: $DC_VER"
else
  echo -e "${RED}✗${NC} docker compose (v2) not found"
  echo "     Install Docker Desktop >= 3.6 or the Compose v2 plugin:"
  echo "     https://docs.docker.com/compose/install/"
  failed=1
fi

# ── Port health checks (informational only, do not fail) ─────────────────────
check_port() {
  local port="$1" label="$2"
  if command -v nc &>/dev/null; then
    if nc -z localhost "$port" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} $label (port $port) reachable"
    else
      echo -e "${YELLOW}⚠${NC} $label (port $port) not reachable — run: docker compose up -d"
    fi
  fi
}
check_port 5432 "postgres"
check_port 6379 "redis"

echo ""
if [ $failed -eq 1 ]; then
  echo "One or more required tools are missing or outdated. See README Prerequisites."
  exit 1
fi
echo "All required tools found."
