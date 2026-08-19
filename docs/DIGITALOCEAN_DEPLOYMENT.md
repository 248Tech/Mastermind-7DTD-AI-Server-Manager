# DigitalOcean production deployment

Mastermind's production control plane runs on the DigitalOcean Droplet
`mastermind-prod` (`137.184.53.141`, NYC1). The 7 Days to Die server and
Mastermind agent remain on `7dtd-vm`.

## Traffic and trust boundaries

- `https://mm.mg7d.com` and `/player` enter through Cloudflare Tunnel. The
  Droplet does not expose HTTP, HTTPS, PostgreSQL, Redis, or application ports
  on its public address.
- A dedicated WireGuard link connects the Droplet (`10.78.0.1`) to the game VM
  (`10.78.0.2`) on UDP 51821.
- The Droplet reads the game `userdata` and `logs` trees through read-only
  SSHFS mounts over WireGuard. Mastermind writes and server actions still go
  through the authenticated local agent.
- The 7DTD Allocs WebAPI (`:8080`) and PrismaCore ClaimCreator (`:11111`) are
reachable by the control plane only over WireGuard. They are not public cloud
ports. On the game VM, `mastermind-game-api-firewall.service` ACCEPTs TCP 8080
and 11111 from `10.77.0.0/16`, `10.78.0.0/16`, `172.16.0.0/12`, and loopback,
then DROPs other sources (IPv6 except `::1` included). Telnet remains loopback/relay only.

## Game API env (control-plane)

Set on the Droplet compose env, never in Next public env:

- `PRISMACORE_WEB_URL`, `PRISMACORE_API_USER`, `PRISMACORE_API_PASSWORD`
- `SEVENDTD_WEB_URL`, `SEVENDTD_WEB_API_TOKEN_NAME`, `SEVENDTD_WEB_API_SECRET`

Inventory, location APIs, and `visitmap` require an Allocs webtoken sent as
`X-SDTD-API-TOKENNAME` / `X-SDTD-API-SECRET`. Keep `:8080` and `:11111`
firewalled to loopback, WireGuard, and Docker networks.

See `docs/prismacore.md` and `docs/allocs.md`.

## Services and startup

On the Droplet:

```bash
cd /opt/mastermind/infra
sudo docker compose ps
sudo docker compose logs --tail=100 control-plane web cloudflared
sudo systemctl status wg-quick@wg-mm mastermind-game-mounts docker
```

`docker.service` requires `mastermind-game-mounts.service`, so the read-only
game-data mounts exist before Docker restarts the web container after a reboot.
All production containers use `restart: unless-stopped`.

On the game VM:

```bash
sudo systemctl status 7dtd mastermind-agent wg-quick@wg-mm
sudo docker ps --filter name=mastermind-remote-telnet
```

The agent's control-plane URL is `https://mm.mg7d.com`. The game service does
not depend on the cloud dashboard and remains playable during Mastermind
maintenance.

## Data and recovery

- PostgreSQL data: Docker volume `infra_postgres_data` on the Droplet.
- Redis data: Docker volume `infra_redis_data` on the Droplet.
- Uploaded mod artifacts: Docker volume `infra_mod_uploads` on the Droplet.
- DigitalOcean Droplet backups are enabled.
- The pre-cutover PostgreSQL snapshot is retained on the game VM at
  `/opt/mastermind/backups/control-plane-pre-digitalocean-20260814-194132.dump`.
- The former local Mastermind containers are stopped and their volumes are
  retained for rollback. Do not start the old Cloudflare connector and the new
  production connector at the same time during a rollback.

Integration credentials remain encrypted in PostgreSQL. Runtime secrets are
in `/opt/mastermind/infra/.env`, and the Cloudflare tunnel token is in the
root-restricted, gitignored `infra/secrets` directory. Never commit either.

## Deploying an update

Copy the reviewed source tree to `/opt/mastermind`, then run:

```bash
cd /opt/mastermind/infra
sudo docker compose build --parallel control-plane web profile-editor
sudo docker compose up -d control-plane profile-editor web cloudflared
curl -fsS https://mm.mg7d.com/api/health
```

Database migrations are applied by the control-plane container's existing
startup process. Take a PostgreSQL dump before schema-changing deployments.

After a control-plane/web deploy that includes Allocs live-data, confirm
`SEVENDTD_WEB_*` is present on the **control-plane** service (not only web).
Do not restart 7dtd unless a maintenance window is scheduled.


