#!/usr/bin/env bash
# Doctor script: check required tooling and versions for local dev.
set -e

REQUIRE_DOCKER_DAEMON=0
for arg in "$@"; do
  case "$arg" in
    --require-docker-daemon) REQUIRE_DOCKER_DAEMON=1 ;;
  esac
done

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

if [ $REQUIRE_DOCKER_DAEMON -eq 1 ] && [ $failed -eq 0 ]; then
  daemon_version="$(docker info --format '{{.ServerVersion}}' 2>/dev/null || true)"
  if [ -n "$daemon_version" ]; then
    echo -e "${GREEN}✓${NC} docker daemon: $daemon_version"
  else
    echo -e "${RED}✗${NC} docker daemon unavailable"
    echo "    Start Docker Desktop (or docker engine) and retry."
    failed=1
  fi
fi

if [ $failed -eq 1 ]; then
  echo ""
  echo "Fix missing tools and/or Docker daemon availability. See README Prerequisites."
  exit 1
fi
echo ""
echo "All required tools found."
