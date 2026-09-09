#!/bin/bash
set -euo pipefail

target="${1:?mod config file path required}"

case "$target" in
  /opt/7dtd/server/Mods/*) ;;
  *)
    echo "refusing path outside /opt/7dtd/server/Mods" >&2
    exit 1
    ;;
esac

dir="$(dirname "$target")"
group="${MASTERMIND_MODS_GROUP:-serveradmin}"

mkdir -p "$dir"
if [[ ! -e "$target" ]]; then
  # Merge apply may create brand-new template files that did not exist live.
  umask 002
  : > "$target"
fi
if [[ ! -f "$target" ]]; then
  echo "not a regular file: $target" >&2
  exit 1
fi

chgrp "$group" "$dir" "$target"
chmod g+wX "$dir"
chmod g+w "$target"
if [[ -d "$dir" ]]; then
  chmod g+s "$dir" 2>/dev/null || true
fi
