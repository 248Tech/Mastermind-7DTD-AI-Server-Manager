# Pending Push and Live Deployment Inventory

Updated: 2026-08-20

## Scope

This document records work that still needs an intentional commit, push, review, and production deployment. The last dashboard deployment we can identify in the local release history is `60c3e0f` (`Expand mod editor in focus mode`). The live containers have since been rebuilt from a source tree whose Git provenance does not exactly match this worktree, so verify the production diff before release.

## Committed after the last known dashboard deployment

These commits are on `agent/release-0.0.12` and GitHub, but the 7DTD agent host has not received the agent changes:

- `dd1c22e` — Fix stale queued mod restart status with explicit activation markers.
- `66a08cb` — Add writable permissions and config-write fallback for read-only mod directories.
- `175391e` — Avoid the temporary filesystem for the mod-config fallback.

The game host is still reporting the old `.mastermind-config-* permission denied` error, proving that the running `mastermind-agent` binary predates these fixes.

## Uncommitted agent changes

- `agent/internal/games/7dtd/adapter.go`
  - Permission repair before config writes.
  - Direct writable-file fallback and safer mod config replacement.
  - Related item catalog and player-death integration changes in the current worktree.
- `agent/internal/games/7dtd/adapter_modconfig_test.go`
- `agent/internal/games/7dtd/adapter_setdeaths_test.go`
- `agent/internal/games/7dtd/item_catalog.go`
- `agent/internal/games/7dtd/item_catalog_test.go`
- `agent/internal/jobs/loop.go`
- `agent/internal/jobs/loop_test.go`
- `deploy-agent.sh`
- `infra/agent/mastermind-ensure-mod-config-writable.sh`

These require Go tests, an agent build, installation on `10.78.0.2`, and an agent service restart. They must not be considered live until the game-host binary is replaced.

## Uncommitted control-plane changes

- `control-plane/prisma/schema.prisma` — schema additions for the current feature work.
- `control-plane/src/allocs/allocs.normalize.ts`
- `control-plane/src/allocs/allocs.service.ts`
- `control-plane/src/donations/donations.service.ts`
- `control-plane/src/donations/item-catalog.ts`
- `control-plane/src/donations/item-catalog.test.ts`
- `control-plane/src/donations/shop-grants.ts`
- `control-plane/src/donations/shop-grants.test.ts`
- `control-plane/src/donations/shop-items.controller.ts`
- `control-plane/src/donations/shop-items.service.ts`
- `control-plane/src/jobs/constants.ts`
- `control-plane/src/jobs/jobs-queue.service.ts`
- `control-plane/src/jobs/jobs.controller.ts`
- `control-plane/src/jobs/jobs.service.ts`
- `control-plane/src/players/player-roster.test.mjs`
- `control-plane/src/players/player-roster.ts`
- `control-plane/src/players/players.service.ts`
- `control-plane/src/prismacore/prismacore.normalize.ts`
- `control-plane/src/prismacore/prismacore.test.mjs`

These need focused control-plane tests, Prisma migration review, and a database backup before production deployment.

## Uncommitted web changes

- `web/src/app/(dashboard)/donator-shop/page.tsx` — donor-shop UI changes.
- `web/src/app/(dashboard)/live-map/LiveMapClient.tsx` — live-map tracking, trails, entity, and control changes.
- `web/src/app/(dashboard)/players/page.tsx` — player list and statistics UI changes.
- `web/src/app/(dashboard)/profile-editor/page.tsx` — profile editor UI changes.
- `web/src/app/(dashboard)/purchases/page.tsx` — purchase UI changes.
- `web/src/app/api/item-icon/[name]/route.ts`
- `web/src/app/api/item-icons/` — new item-icon API routes.
- `web/src/app/globals.css` — shared UI styling.
- `web/src/app/item-icon/[name]/route.ts`
- `web/src/app/player/shop/[id]/page.tsx`
- `web/src/app/player/shop/cart/page.tsx`
- `web/src/app/player/shop/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/shop-copy.tsx`
- `web/src/lib/shop-player.ts`
- `web/src/lib/shop-ui.css`

These need a production web build and smoke test for dashboard, live map, player portal, shop, item icons, and profile editor.

## Release checklist

1. Review the mixed worktree changes and separate unrelated features into intentional commits.
2. Run agent tests and build the agent binary.
3. Run control-plane tests and create/review the Prisma migration.
4. Run the web production build and smoke tests.
5. Back up PostgreSQL before control-plane deployment.
6. Push commits and create the intended release tag.
7. Deploy control-plane/web containers.
8. Deploy and restart `mastermind-agent` on `10.78.0.2` through the WireGuard tunnel.
9. Verify mod config save, mod inventory, map, players, shop, and `/api/health`.

## Security and operational notes

- Do not commit API keys, database dumps, SSH private keys, or generated secrets.
- Preserve the production `infra/.env` while syncing source.
- Do not overwrite unrelated dirty work without review.
- The 7DTD server process is separate from the DigitalOcean control-plane containers; updating the web image does not update the game-host agent.
