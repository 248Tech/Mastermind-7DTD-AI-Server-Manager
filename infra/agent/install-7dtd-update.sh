#!/bin/bash
set -euo pipefail
sudo install -o root -g root -m 0755 /tmp/mastermind-update-7dtd-stable.sh /usr/local/sbin/mastermind-update-7dtd-stable
sudo install -o root -g root -m 0644 /tmp/7dtd-update.service /etc/systemd/system/7dtd-update.service
sudo install -d -o root -g root -m 0755 /etc/systemd/system/7dtd.service.d
sudo install -o root -g root -m 0644 /tmp/update-on-boot.conf /etc/systemd/system/7dtd.service.d/update-on-boot.conf
sudo tee /etc/sudoers.d/mastermind-agent-7dtd >/dev/null <<'EOF'
mastermind-agent ALL=(root) NOPASSWD: /usr/bin/systemctl start 7dtd.service, /usr/bin/systemctl stop 7dtd.service, /usr/bin/systemctl restart 7dtd.service, /usr/bin/systemctl kill --kill-who=main --signal=SIGKILL 7dtd.service, /usr/bin/systemctl reset-failed 7dtd.service, /usr/local/sbin/mastermind-update-7dtd-stable, /usr/local/sbin/mastermind-wipe-7dtd-save /opt/7dtd/serverconfig.xml /opt/7dtd/userdata/Saves/Rotterdam/Builder, /usr/local/sbin/mastermind-wipe-7dtd-save /opt/7dtd/serverconfig.xml /opt/7dtd/userdata/Saves/Rotterdam/Builder.mastermind-restore-old, /usr/local/sbin/mastermind-fix-7dtd-save-permissions /opt/7dtd/serverconfig.xml /opt/7dtd/userdata/Saves/Rotterdam/Builder, /usr/local/sbin/mastermind-ensure-mod-config-writable /opt/7dtd/server/Mods/*, /usr/local/sbin/mastermind-ensure-mod-config-writable /opt/7dtd/server/Mods/*_Config/*
EOF
sudo chmod 0440 /etc/sudoers.d/mastermind-agent-7dtd
sudo visudo -cf /etc/sudoers.d/mastermind-agent-7dtd
sudo systemctl daemon-reload
sudo systemctl enable 7dtd-update.service
install -o serveradmin -g serveradmin -m 0644 /tmp/mm-agent-update/update.go /opt/mastermind/agent/internal/games/7dtd/update.go
install -o serveradmin -g serveradmin -m 0644 /tmp/mm-agent-update/update_test.go /opt/mastermind/agent/internal/games/7dtd/update_test.go
install -o serveradmin -g serveradmin -m 0644 /tmp/mm-agent-update/adapter.go /opt/mastermind/agent/internal/games/7dtd/adapter.go
install -o serveradmin -g serveradmin -m 0644 /tmp/mm-agent-update/loop.go /opt/mastermind/agent/internal/jobs/loop.go
cd /opt/mastermind/agent
go test ./internal/games/7dtd -count=1 -run 'TestParseSteamUpdate'
sudo go build -o /usr/local/bin/mastermind-agent .
sudo systemctl restart mastermind-agent
sleep 2
systemctl is-active mastermind-agent 7dtd 7dtd-update || true
systemctl is-enabled 7dtd-update.service
echo INSTALL_OK
