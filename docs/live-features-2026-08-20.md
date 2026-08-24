# Live features snapshot (2026-08-20)

Production at `https://mm.mg7d.com` already runs these capabilities. There is **no emergency redeploy** required for the work below. Package metadata remains `0.0.12`; this file records post-tag behavior that is live on the droplet and game-host agent.

Git may still lag a dirty production tree. Prefer committing hygiene (especially agent `item_catalog.go`) over redeploying what is already running.

## Donator shop

- Admin packages store optional In-Game Gifts (item name, quantity, quality) and optional donor chat color — thank-you gifts after a donation, not a sale of in-game items.
- Donations snapshot gift lines at checkout; signed Stripe webhook queues sanitized telnet `giveplus` / `playerchatcolor` (charset-limited item names; never `giveplus all`).
- Offline players retry `giveplus` on the next roster poll; chat color can apply offline.
- Player shop pages show In-Game Gifts with `/item-icon/{name}` icons.
- Admin gift picker: empty click lists ItemIcons A–Z; typing filters (prefix first); infinite scroll (+100). Catalog merges ItemIcons with agent `ITEM_CATALOG`.
- Agent `ITEM_CATALOG` indexes vanilla/mod `items.xml` and `blocks.xml` plus ItemIcons (so blocks such as `keystoneBlock` appear).

## Players

- Responsive card layout (no wide horizontal table scroll).
- Staff can set death count via `PLAYER_SET_DEATHS` → ServerTools `st-SetDeaths` (player must be online). Control plane pins the value briefly after success.

## Server controls

- **Save world** sends telnet `saveworld` only.
- **Save-stop** flushes the world, creates a manual full-world backup (`mastermind_…`), then shuts 7DTD down. Does not restart 7dtd as part of the backup copy.

## Live map

- Staff live map keeps React hooks above early returns so player-track controls do not crash the client.
- Entity feeds remain Allocs + PrismaCore (no telnet `le` for zombies/animals).

## Mods / agent

- Mod pending-restart markers and writable-file mod-config write fallbacks are on the live agent.
- Deploy/restart `mastermind-agent` only when agent binaries change; do **not** restart `7dtd` for app-only releases.

## What is not a deploy gap

| Topic | Status |
|-------|--------|
| Shop In-Game Gifts + delivery status | Live (control-plane + web + DB `grant_items`) |
| Shop grant display / icons / autocomplete | Live (web) |
| Item/block catalog including `keystoneBlock` | Live (agent) |
| Set deaths | Live (CP + web + agent) |
| Players card UI | Live (web) |
| Live-map hooks fix | Live (web) |
| Git commit of untracked `agent/.../item_catalog.go` | Hygiene only — file already on the game host |

## Related docs

- [README current features](../README.md#current-features-v0012)
- [CHANGELOG Unreleased](../CHANGELOG.md)
- [PrismaCore / shop grants](prismacore.md)
- [Release 0.0.12 context](release-0.0.12-context.md)
- [User guide §16](../human/user-guide.md#16-player-portal-shop-and-live-map)
