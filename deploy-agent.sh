#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq golang-go jq

cd /opt/mastermind/agent
go build -trimpath -ldflags='-s -w' -o /tmp/mastermind-agent .
sudo install -o root -g root -m 0755 /tmp/mastermind-agent /usr/local/bin/mastermind-agent
sudo install -o root -g root -m 0755 /opt/mastermind/wipe-7dtd-save.py /usr/local/sbin/mastermind-wipe-7dtd-save
rm -f /tmp/mastermind-agent

: "${MASTERMIND_ADMIN_EMAIL:?Set MASTERMIND_ADMIN_EMAIL}"
: "${MASTERMIND_ADMIN_PASSWORD:?Set MASTERMIND_ADMIN_PASSWORD}"
login_payload="$(jq -cn --arg email "$MASTERMIND_ADMIN_EMAIL" --arg password "$MASTERMIND_ADMIN_PASSWORD" '{email:$email,password:$password}')"
login_json="$(curl -fsS -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  --data "$login_payload")"
user_jwt="$(printf '%s' "$login_json" | jq -er '.access_token')"
org_id="$(printf '%s' "$login_json" | jq -er '.orgId')"

pair_json="$(curl -fsS -X POST "http://127.0.0.1:3001/api/orgs/${org_id}/pairing-tokens" \
  -H "Authorization: Bearer ${user_jwt}" \
  -H 'Content-Type: application/json' \
  --data '{"expiresInSec":900}')"
pair_token="$(printf '%s' "$pair_json" | jq -er '.token')"

if ! id mastermind-agent >/dev/null 2>&1; then
  sudo useradd --system --home /var/lib/mastermind-agent --shell /usr/sbin/nologin mastermind-agent
fi
sudo install -d -o mastermind-agent -g mastermind-agent -m 0700 /var/lib/mastermind-agent
sudo install -d -o root -g mastermind-agent -m 0750 /etc/mastermind-agent

temp_config="$(mktemp)"
chmod 0600 "$temp_config"
cat >"$temp_config" <<EOF
control_plane_url: "http://127.0.0.1:3001"
pairing_token: "${pair_token}"
agent_key_path: "/var/lib/mastermind-agent/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "7dtd-vm"
discovery:
  enabled: true
  seven_dtd:
    enabled: true
    name: "Builder Friendly PvE"
    install_path: "/opt/7dtd/server"
    server_config_path: "/opt/7dtd/serverconfig.xml"
    mods_path: "/opt/7dtd/server/Mods"
    saves_path: "/opt/7dtd/userdata/Saves"
    server_admin_xml_path: "/opt/7dtd/userdata/Saves/serveradmin.xml"
    start_command: "/usr/bin/sudo /usr/bin/systemctl start 7dtd.service"
logs:
  enabled: true
  path: "/opt/7dtd/logs/server.log"
  server_instance_id: "cmsl7rpn100077lu0ru61eilk"
  poll_interval_sec: 2
EOF
sudo install -o root -g mastermind-agent -m 0640 "$temp_config" /etc/mastermind-agent/config.yaml
rm -f "$temp_config"

printf '%s\n' 'mastermind-agent ALL=(root) NOPASSWD: /usr/bin/systemctl start 7dtd.service, /usr/bin/systemctl stop 7dtd.service, /usr/bin/systemctl restart 7dtd.service, /usr/local/sbin/mastermind-wipe-7dtd-save /opt/7dtd/serverconfig.xml /opt/7dtd/userdata/Saves/Rotterdam/Builder' |
  sudo tee /etc/sudoers.d/mastermind-agent-7dtd >/dev/null
sudo chmod 0440 /etc/sudoers.d/mastermind-agent-7dtd
sudo visudo -cf /etc/sudoers.d/mastermind-agent-7dtd >/dev/null

sudo install -o root -g root -m 0644 /tmp/mastermind-agent.service /etc/systemd/system/mastermind-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now mastermind-agent.service

for _ in $(seq 1 30); do
  if sudo test -s /var/lib/mastermind-agent/agent.key; then
    break
  fi
  sleep 1
done
sudo test -s /var/lib/mastermind-agent/agent.key
sudo sed -i 's/^pairing_token:.*/pairing_token: ""/' /etc/mastermind-agent/config.yaml
sudo systemctl restart mastermind-agent.service

echo "AGENT_ACTIVE=$(systemctl is-active mastermind-agent.service)"
echo "GAME_ACTIVE=$(systemctl is-active 7dtd.service)"
echo "ORG_ID=${org_id}"
