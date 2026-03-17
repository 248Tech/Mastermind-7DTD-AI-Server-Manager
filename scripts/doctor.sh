#!/usr/bin/env bash
# Doctor script: check required tooling and versions for local dev.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

check() {
  if command -v "$1" &>/dev/null; then
    local version
    version=$("$1" "$2" 2>/dev/null | head -1 || true)
    echo -e "${GREEN}✓${NC} $1: ${version:-unknown}"
    return 0
  else
    echo -e "${RED}✗${NC} $1 not found"
    return 1
  fi
}

failed=0
check node --version || failed=1
check pnpm --version || failed=1
check go version || failed=1
check docker --version || failed=1
check docker compose version 2>/dev/null || check docker-compose --version || failed=1

if [ $failed -eq 1 ]; then
  echo ""
  echo "Install missing tools. See README Prerequisites."
  exit 1
fi
echo ""
echo "All required tools found."
