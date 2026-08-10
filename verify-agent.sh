#!/usr/bin/env bash
set -euo pipefail
sudo journalctl -u mastermind-agent --no-pager -n 30
: "${MASTERMIND_ADMIN_EMAIL:?Set MASTERMIND_ADMIN_EMAIL}"
: "${MASTERMIND_ADMIN_PASSWORD:?Set MASTERMIND_ADMIN_PASSWORD}"
login_payload="$(jq -cn --arg email "$MASTERMIND_ADMIN_EMAIL" --arg password "$MASTERMIND_ADMIN_PASSWORD" '{email:$email,password:$password}')"
login="$(curl -fsS -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  --data "$login_payload")"
jwt="$(printf '%s' "$login" | jq -r .access_token)"
org="$(printf '%s' "$login" | jq -r .orgId)"
echo HOSTS
curl -fsS "http://127.0.0.1:3001/api/orgs/$org/hosts" \
  -H "Authorization: Bearer $jwt" |
  jq 'map({id,name,status,lastHeartbeatAt})'
echo SERVERS
curl -fsS "http://127.0.0.1:3001/api/orgs/$org/server-instances" \
  -H "Authorization: Bearer $jwt" |
  jq 'map({id,name,installPath,startCommand,telnetHost,telnetPort})'
echo "GAME=$(systemctl is-active 7dtd)"
printf 'EGRESS='
curl -4 -fsS https://icanhazip.com
