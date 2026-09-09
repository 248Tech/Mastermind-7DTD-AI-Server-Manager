# Release 0.0.15 context

Release `0.0.15` packages the current Mastermind work after `0.0.14`: selected-server POI discovery, constrained ServerConfig editing, player-portal mod access, safer mod replacement/config migration, and the related agent and portal hardening. This is a maintainer handoff and release summary. It intentionally contains no credentials, save data, host addresses, or private deployment configuration.

## Scope

- **POI Search:** The Go agent indexes safe prefab basenames from the selected 7DTD installation's `Data/Prefabs/POIs` directory. Mastermind stores the compressed catalog in the completed job result, provides searchable dashboard and authorised player-portal views, and fetches a bounded native JPEG preview only after a user selects an entry.
- **ServerConfig editor:** Every server-management page can queue authenticated `SERVER_CONFIG_READ` and `SERVER_CONFIG_WRITE` jobs. The dashboard uses the same focused editor used for mod configuration and tells operators that a restart is required for game configuration changes to take effect.
- **Player portal content:** Supporters and administrators may browse/download active mods and search POIs for the portal's configured server. Pending and quarantined mods, raw server configuration, staff controls, game APIs, and arbitrary host files are not exposed.
- **Mod replacement and configuration migration:** Quarantined updates can be restored under a distinct name or explicitly replace a conflicting active folder. Staff can preview compatible XML/INI/text configuration carry-forward, choose an approved result, and retain visible warnings for files that are unsafe or non-mergeable.
- **Operational hardening:** The agent supports current ServerTools-style sibling runtime config directories, validates config paths and permissions, stages profile edits for the next Mastermind-managed start/reboot, and its container build targets the executable package rather than an ambiguous multi-package Go pattern.
- **Multi-server and restart context:** New pages retain explicit selected-server handling. Mastermind remains the owner of Stability Safe Restart decisions and can skip the next same-server scheduled reboot once after a successful stability restart or operator request.

## Important behavior

- POI catalog entries must be short safe basenames. The agent rejects traversal and unusual characters; the control plane independently rejects malformed catalog entries. Catalogs and requested JPEG previews are size-bounded.
- The agent reads a preview from the installed game directory only after a valid `POI_PREVIEW` job. It does not scan or upload arbitrary host files, and it does not transfer all POI images during indexing.
- ServerConfig and mod configuration reads/writes are normal server-bound, authenticated jobs. Path validation remains in the agent; browser input is never trusted as a filesystem path.
- Replacing a mod is deliberately explicit. A configuration merge preview does not write changes; staff must choose and apply the reviewed outcome. A server restart or the affected mod's reload command may still be needed.
- Player portal mod downloads are an authorised convenience view of active selected-server content, not a mod-management surface. Staff-only dashboard controls remain outside portal APIs.
- Stability watcher processes only report telemetry to Mastermind. They do not directly restart 7DTD. A failed stability restart must not consume the next scheduled-reboot skip.

## Release contents

- Agent jobs and tests for POI catalog/preview, ServerConfig read/write, safer mod folder handling, sibling runtime config paths, config merge behavior, and profile staging.
- Control-plane POI catalog module and protected organization/player APIs, new job classifications, restart-if-down persistence, improved job/service handling, and trigger/land-claim coverage.
- Dashboard POI Search and ServerConfig editor, server-aware page behavior, enhanced Mod filtering/replacement flow, and profile editor integration updates.
- Player-portal Mods and POI pages for authorised supporters and administrators.
- Deployment/service permissions, profile-editor overlay, agent build, README, changelog, and release metadata updates.

## Validation performed

- `git diff --check` was run before release staging; the only earlier detected trailing blank line was removed.
- Focused source-level POI, ServerConfig, config-merge, mod-folder, and profile tests are included with the release. The repository still requires the normal Go 1.22 and Node/pnpm build environment to execute the complete suite.
- Production deployment validation performed during this release work confirmed a healthy control plane/web deployment and active 7DTD host-agent service, with dashboard and player POI pages reachable after the POI module and portal type fixes.

## Release and deployment checklist

1. Review staged files for credentials, game binaries, save data, generated output, and unintended VM-only configuration. Keep agent keys, telnet passwords, Stripe/API secrets, SSH keys, Cloudflare/WireGuard material, and `.env` files out of Git.
2. Run `git diff --check`; run the full Go test suite in Go 1.22+ and production Docker builds for control-plane, web, and agent where available.
3. Apply the Prisma migration `20260904000037_reboot_if_down` before enabling the new restart-if-down setting on an existing database.
4. Confirm package versions, health version, README links, and changelog entries are `0.0.15`; confirm POI Search returns no catalog until an operator indexes the intended server.
5. Verify portal authorisation: a non-supporter cannot access mod/POI content, while an administrator/supporter receives only the configured server's active mods and bounded POI data.
6. Tag `v0.0.15`, push `main` and the tag, update the GitHub description, and publish the release notes from this file.

## Operations notes

- Deploy control-plane/web changes without restarting `7dtd.service` unless a game update, configuration apply, or explicit game-service operation is requested.
- POI source files reside in the 7DTD installation. Index each server independently after upgrading its game files or changing the installed prefab set.
- A ServerConfig save only writes the validated configured file; operators should use an appropriate managed restart to apply it and retain normal backups/change review procedures.
- VM systemd configuration, service account names, saves, game binaries, and production environment files are operational state—not repository content—and must remain outside the release commit.
