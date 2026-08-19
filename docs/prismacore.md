# PrismaCore WebAPI

PrismaCore 3.0.0-v2.5 (ClaimCreator WebAPI, default port **11111**) is the read source for live shop status, staff map overlays, and map player positions. Allocs/WebDashboard on **8080** supplies tiles, hostiles, animals, inventory, and allowlisted `visitmap`. See [allocs.md](allocs.md).

## Game host

1. Extract `PrismaCore_2.5.zip` into `/opt/7dtd/server/Mods/PrismaCore` while the dedicated server is **off** if replacing `PrismaCore.dll`. A first-time copy onto a running server only loads after the next restart.
2. Place `ClaimCreator_permissions.xml` in `/opt/7dtd/userdata/Saves/` with a dedicated `apiuser` (template: `infra/prismacore/ClaimCreator_permissions.xml`). Generate the password with `infra/prismacore/stage-apiuser.py` on the game host; do not commit it.
3. Bind/firewall **11111** to loopback, WireGuard (`10.77.0.0/16` / `10.78.0.0/16`), and Docker (`172.16.0.0/12`) only. Do not publish ClaimCreator on the public internet.
4. Confirm with telnet `version` after restart. ClaimCreator should listen on `11111`.

## Mastermind

Control-plane env (never Next public env):

```
PRISMACORE_WEB_URL=http://10.77.0.2:11111
PRISMACORE_API_USER=mastermind
PRISMACORE_API_PASSWORD=...
```

Staff: `GET /api/orgs/:orgId/prismacore/:layer` (dashboard JWT). Layers: `status`, `playersonline`, `landclaims`, `playerhomes`, `vehicles`, `drones`, `traders`, `questpois`, `allpois`, `resetregions`, `advclaims`. `createadvclaims` is rejected.

Public shop: `GET /api/player-auth/shop/status` adds `serverReachable` (boolean) and `playersOnline` (count only).

Map players prefer `getplayersonline`. If PrismaCore is down, Allocs `getplayerslocation` is the fallback. Telnet `lp` still feeds the Players roster (ping/IP/kills) until `getplayersonline` is probed after a 7dtd restart.

## Not in this phase

In-game shop grants, Discord announce, write APIs, replacing telnet `lp`.
