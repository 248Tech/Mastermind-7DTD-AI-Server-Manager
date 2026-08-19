# Mastermind unreleased context (2026-08-18)

GitHub-facing summary of work after tagged `0.0.11` (2026-08-14). Package versions remain `0.0.11` until an explicit release. Do not treat this file as a version bump.

## Release

- Version: unreleased (post-0.0.11)
- Date: 2026-08-18
- Scope: player portal profile, Stripe donations, donator shop, PrismaCore overlays, Allocs live-data
- Operator/model: implementer session; documentation pass for GitHub review

## User-visible changes

- Steam players can open `/player/profile` for their own stats, last position, last logout, inventory snapshot, and supporter summary.
- Players can donate through Stripe Checkout. Checkout is disabled until an org Stripe secret key and webhook signing secret are stored.
- `/player/shop` is public to browse. Checkout requires Steam or a password on an in-game name already seen on the portal server. Cart lives in browser `localStorage`.
- Admins manage shop items on `/donator-shop` and see completed purchases on `/purchases`.
- Staff Live Map overlays vehicles, drones, beds, traders, POIs, reset regions, and advanced claims from PrismaCore when `:11111` is up.
- Shop status can show server reachability and an online-player **count** (no names or positions).
- Staff and player maps no longer use telnet `le` for zombies/animals. Inventory no longer uses `st-pil`. `visitmap` start/stop no longer queues an RCON job.

## Files and migrations

Major areas (not an exhaustive file list):

- `control-plane/src/player-auth/` — Steam and name sessions, profile, shop live status
- `control-plane/src/donations/` — Stripe checkout, webhook, shop catalog, image normalize
- `control-plane/src/prismacore/` — ClaimCreator read client
- `control-plane/src/allocs/` — Allocs read/allowlisted console client
- `control-plane/src/players/` — inventory GET, JSON parser
- `control-plane/prisma/` — `ShopItem`, `DonationLine`, `Player.portalPasswordHash`, inventory/position columns
- `web/src/app/player/` — portal, profile, shop, cart, map
- `web/src/app/(dashboard)/` — live map, players inventory, donator-shop, purchases, Stripe settings
- `infra/docker-compose.yml` and `infra/.env.example` — `PRISMACORE_*`, `SEVENDTD_WEB_*`, Stripe, `PLAYER_PORTAL_SERVER_ID`
- `docs/prismacore.md`, `docs/allocs.md`

## Verification evidence

- Tests: `node src/prismacore/prismacore.test.mjs`, `node src/allocs/allocs.test.mjs`, `node src/players/player-inventory.test.mjs` in `control-plane`
- Runtime: PrismaCore shop live pipe and shop UI were deployed to production 2026-08-18. Allocs live-data is implemented in this checkout and still needs a production deploy plus an Allocs webtoken on control-plane.
- Game: PrismaCore 2.5 is on disk at `/opt/7dtd/server/Mods/PrismaCore`. **7dtd was not restarted**; ClaimCreator `:11111` stays down until a maintenance restart.

## Deployment

- Target: DigitalOcean `mastermind-prod` / `https://mm.mg7d.com` for Mastermind; game VM over WireGuard.
- Allocs live-data is **not** claimed deployed in this document. After copy + `docker compose build` of control-plane/web, set `SEVENDTD_WEB_*` on control-plane if empty.
- Rollback: production backups under `/opt/mastermind/backups/` from each 2026-08-18 shop/PrismaCore deploy. Do not commit backup archives.
- Do not restart 7dtd as part of a GitHub source push.

## Security review

- Secrets scan: do not commit `infra/.env`, `infra/secrets/`, Stripe keys, PrismaCore apiuser password, Allocs webtoken, agent keys, SSH/WireGuard keys, or player/save data.
- Authorization: shop catalog is public; checkout and profile require a player session. Staff PrismaCore/Allocs routes require dashboard JWT. Allocs console is admin/operator and allowlisted.
- Public exposure: Cloudflare Tunnel only. Allocs `:8080` and PrismaCore `:11111` stay on loopback/WireGuard. Shop status is count-only. Map JSON must not contain webtokens or apiuser passwords.

## Known issues and next steps

- Confirm Allocs webtoken (`webtokens list` on telnet) and set `SEVENDTD_WEB_API_SECRET` on production control-plane before inventory/`visitmap` work there.
- PrismaCore `:11111` is up. Map players stay on PrismaCore `getplayersonline` (map-only keys). Roster ping/IP/kills use Allocs `getplayersonline` with telnet `lp` fallback.
- Out of this slice: shop kit grants, donor chat colors, `createadvclaims`.
- Do not bump `package.json` versions or create a git tag unless the operator asks.

## Do not commit

- `/opt/mastermind/infra/.env` and any copied equivalent
- `infra/secrets/` (Cloudflare tunnel token)
- WireGuard/SSH private keys, agent keys, pairing tokens, JWTs
- Stripe secret/webhook values, PrismaCore password, Allocs webtoken
- Database dumps, save data, `players.xml`, server logs with IPs
- `.claude` debug dumps, VM images
