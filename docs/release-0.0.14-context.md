# Release 0.0.14 context

Release `0.0.14` packages the current multi-server Mastermind work after the `0.0.13` verified player mod-request release. This is a maintainer handoff and release summary. It documents behavior and validation boundaries without secrets, production URLs beyond public documentation, or deployment credentials.

## Scope

- Server-aware navigation persists an explicit selected server across pages such as Mods, Live Map, Players, Logs, Saves, Profile Editor, RegionHealer, Chat, Tools, and the player portal surfaces that need a server context.
- A managed `SERVER_UPDATE` action checks Steam for the stable 7DTD dedicated-server build. When an update is required, it uses the managed save/stop/update/start flow instead of an unmanaged process replacement. Host-start integration can also perform the stable-build check before 7DTD starts.
- Stability restart ownership moved from the VM watcher to Mastermind. The watcher reports the target server and current memory use to an authenticated agent endpoint; Mastermind applies the organisation policy and queues a normal `SERVER_SAFE_RESTART` only when warranted.
- Administrators configure Stability Safe Restart in Settings: enabled state, 4–64 GiB RAM threshold, and 30-minute to 24-hour cooldown. Defaults are enabled, 12 GiB, and four hours.
- After a stability restart reports success, Mastermind marks the nearest enabled restart schedule for that same server to skip exactly once. The server page also exposes **Skip next auto reboot** for an operator to request the same one-time protection manually.
- Player-level automation triggers can grant validated items or land-claim rewards. Vehicle tracking/return workflows and their player-portal views were added for authorised use.
- Mods gained text filtering and safer access to supported runtime `{Mod}_Config` files, including ServerTools configuration files.

## Important behavior

- A stability watcher never directly restarts 7DTD. If it cannot reach Mastermind, it logs the condition and leaves the game service running.
- Stability restarts keep the existing Safe Restart safeguards: countdown, save, backup, kick verification, Blood Moon protection, cooldown, and job history.
- A failed stability Safe Restart does not consume the next scheduled reboot. A successful restart skips only the nearest eligible schedule, then normal cron behavior resumes.
- Existing systemd restart-on-failure behavior is separate from this policy; it remains crash recovery, not a scheduled stability reboot.
- Agent and control-plane authentication remain host- and server-bound. Do not place agent keys, SSH keys, telnet passwords, webhook secrets, Cloudflare tokens, API keys, or `.env` files in the repository.

## Release contents

- Prisma migrations for triggers, bonus land claims, Stability Safe Restart settings, and one-time automatic reboot skip state.
- Go agent support for stable 7DTD updates, validated item grants, land-claim handling, vehicle operations, stronger player/profile handling, and multi-server heartbeat metadata.
- Control-plane routes, queue work, schedules, jobs, org settings, trigger management, vehicle management, and portal updates for the features above.
- Web pages for server selection, Mod filtering, server update/recovery controls, Stability Safe Restart settings, triggers, vehicles, shop/player improvements, and responsive current-server views.

## Validation performed

- `git diff --check` passed before staging.
- `go test ./...` passed for the complete host-agent module in a clean Go 1.22 container.
- Production Docker builds for control-plane and web passed, and the resulting containers reported healthy after deployment of the stability/skip-next work.

## Validation and release checklist

1. Run `git diff --check` and review every staged change for credentials, local save data, generated build output, and unintended deployment files.
2. Run focused Go tests for the agent and production Docker builds for control-plane and web.
3. Confirm package versions, health version, README links, and changelog entries are `0.0.14`.
4. Verify the production control plane exposes the stability evaluation and skip-next-auto-reboot routes, and that the web/control-plane containers are healthy.
5. Tag `v0.0.14`, push `main` and the tag, update the GitHub repository description, and publish release notes derived from this file.

## Operations notes

- Deploy control-plane and web changes without restarting `7dtd.service` unless an explicit game update or game-service action is requested.
- The VM resource watcher is root-owned, reads the Mastermind agent configuration/key locally, and is normally invoked by `7dtd-resource-watch.timer`.
- A release build only reflects the repository. Production VM service configuration, save data, server binaries, keys, and environment files remain out of scope and must not be committed.
