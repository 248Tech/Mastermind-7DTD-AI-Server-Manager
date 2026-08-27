#!/bin/bash
# Apply a 7DTD dedicated-server update from Steam stable (public) if one exists.
# Safe to run as ExecStartPre/boot oneshot while 7dtd.service is still stopped.
# Exit 0: current or updated. Exit 2: game is running. Exit 1: steamcmd failed.
set -u
INSTALL="/opt/7dtd/server"
STEAMCMD="/opt/steamcmd/steamcmd.sh"
APP="294420"
MANIFEST="${INSTALL}/steamapps/appmanifest_${APP}.acf"
LOG="/opt/7dtd/logs/steamcmd-update.log"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

if systemctl is-active --quiet 7dtd.service; then
  echo "MASTERMIND_STATUS=running"
  echo "7DTD is running; stop it before applying a Steam update" >&2
  exit 2
fi

if [[ ! -x "$STEAMCMD" ]]; then
  echo "MASTERMIND_STATUS=failed"
  echo "steamcmd is not installed at $STEAMCMD" >&2
  exit 1
fi

buildid() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  awk -F'"' '/[[:space:]]"buildid"/ { print $4; exit }' "$file"
}

BEFORE="$(buildid "$MANIFEST")"
echo "MASTERMIND_BUILD_BEFORE=${BEFORE:-unknown}"

export HOME=/opt/steamcmd
cd /opt/steamcmd || exit 1
set +e
runuser -u serveradmin -- env HOME=/opt/steamcmd "$STEAMCMD" \
  +@ShutdownOnFailedCommand 1 \
  +@NoPromptForPassword 1 \
  +force_install_dir "$INSTALL" \
  +login anonymous \
  +app_update "$APP" \
  +quit 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[0]}
set -e

AFTER="$(buildid "$MANIFEST")"
echo "MASTERMIND_BUILD_AFTER=${AFTER:-unknown}"

if [[ -n "${AFTER}" && -n "${BEFORE}" && "$BEFORE" != "$AFTER" ]]; then
  echo "MASTERMIND_STATUS=updated"
  exit 0
fi
if [[ "$rc" -eq 0 || "$rc" -eq 6 || "$rc" -eq 7 ]]; then
  echo "MASTERMIND_STATUS=current"
  exit 0
fi
echo "MASTERMIND_STATUS=failed"
echo "steamcmd exited $rc" >&2
exit 1
