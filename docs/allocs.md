# Allocs WebAPI

Allocs Server Fixes / WebMap on **:8080** is the live source for hostiles, animals, player inventory, the Players-page roster (`getplayersonline`), and allowlisted `visitmap` console commands. PrismaCore **:11111** remains the source for map player markers (with Allocs `getplayerslocation` fallback) plus claims/vehicles/overlays.

The Next.js live-map BFF no longer opens telnet for `le`. Inventory snapshots no longer queue `st-pil` RCON jobs.

## Control plane

Env (never Next public env):

```
SEVENDTD_WEB_URL=http://10.78.0.2:8080
SEVENDTD_WEB_API_TOKEN_NAME=mastermind
SEVENDTD_WEB_API_SECRET=...
```

Requests use Allocs webtoken HTTP headers `X-SDTD-API-TOKENNAME` / `X-SDTD-API-SECRET` (Allocs Webinterface 52 on TFP's webserver). Query-string `adminuser` / `admintoken` is ignored and returns 403. **Location reads, inventory, roster (`getplayersonline`), and `executeconsolecommand` all require the webtoken** on this host.

Staff:

- `GET /api/orgs/:orgId/allocs/entities` (dashboard JWT) — players + hostiles + animals. Allocs failures return empty arrays and `errors`, never telnet.
- `POST /api/orgs/:orgId/allocs/console` (admin/operator) — **only** `visitmap <x1> <z1> <x2> <z2>` or `visitmap stop`.
- `GET /api/orgs/:orgId/players/:id/inventory` (dashboard JWT) — Allocs `getplayerinventory?userid=Steam_…` or `EOS_…` (one player, including offline).
- Background roster snapshots use Allocs `getplayerinventories` (all online bags in one call). HTTP/JSON failure falls back to two `getplayerinventory` requests per poll. Empty `[]` is success. Snapshots still skip empty bags and do not store Steam/EOS/IP.

Probed 2026-08-19: `getplayerinventories` is a JSON array of the same objects as `getplayerinventory` (`bag`, `belt`, `equipment`, `userid`, `crossplatformid`, `entityid`, `playername`). Matching uses Steam/EOS from `userid` / `crossplatformid` only, never display name.

Player portal: `GET /api/player-auth/map/entities` includes hostiles/animals for everyone; player markers only for a Steam session (`auth !== 'name'`).

`visitmap` progress still comes from `/7dtd-logs/server.log` via the live-map BFF. Shop status stays count-only (`serverReachable`, `playersOnline`). Webtokens never appear in shop or map JSON.

## Player roster

Control-plane `pollPlayers` calls Allocs `getplayersonline` first (webtoken required). Usable JSON applies the same upsert/session/disconnect/protection path as telnet `lp`. Fallback to agent job `PLAYER_LIST_SYNC` (`lp`) when Allocs is unconfigured, the HTTP call fails, or the JSON is not a player list. An empty array is success and marks everyone offline.

Probed 2026-08-19: Allocs `getplayersonline` includes `entityid`, `health`, `ip`, `level`, `name`, `ping`, `playerdeaths`, `playerkills`, `position`, `stamina`, `steamid`, `crossplatformid`, `zombiekills`. PrismaCore `getplayersonline` is still map-only (`name`, `position`, `steamid`). Do not copy Allocs `totalplaytime` into Mastermind `lifetimeSeconds`.

## Still telnet

`lp` / `PLAYER_LIST_SYNC` (roster fallback), kick/ban, admin add/remove, `quit`/restart, logs console, ServerTools-only commands.

## Ops

Confirm an Allocs webtoken exists (`webtokens list` on telnet). Set `SEVENDTD_WEB_API_*` on production control-plane if empty. Bind/firewall **8080** like PrismaCore **11111**: ACCEPT from WireGuard (`10.77.0.0/16`, `10.78.0.0/16`), Docker (`172.16.0.0/12`), and loopback; DROP everything else, including IPv6 except `::1`. Game-host helper: `infra/game-host/restrict-game-api-ports.sh` (systemd unit `mastermind-game-api-firewall.service`). Do not publish `:8080` on the public internet.
