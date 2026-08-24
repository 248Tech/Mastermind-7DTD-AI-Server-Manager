#!/bin/sh
# Restrict 7DTD Allocs (:8080) and PrismaCore (:11111) to private sources.
# Does not change INPUT policy. Game ports (26900+) and SSH are untouched.
set -eu

ALLOW_V4='10.78.0.0/16 10.77.0.0/16 172.16.0.0/12 127.0.0.1'

ensure_v4() {
  port=$1
  for src in $ALLOW_V4; do
    iptables -C INPUT -s "$src" -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -s "$src" -p tcp --dport "$port" -j ACCEPT
  done
  iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null \
    || iptables -A INPUT -p tcp --dport "$port" -j DROP
}

ensure_v6() {
  port=$1
  ip6tables -C INPUT -s ::1 -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || ip6tables -I INPUT 1 -s ::1 -p tcp --dport "$port" -j ACCEPT
  ip6tables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null \
    || ip6tables -A INPUT -p tcp --dport "$port" -j DROP
}

ensure_v4 8080
ensure_v4 11111
if command -v ip6tables >/dev/null 2>&1; then
  ensure_v6 8080
  ensure_v6 11111
fi
