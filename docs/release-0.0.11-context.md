# Mastermind 0.0.11 release context

## Release scope

Version 0.0.11 packages the Kimi Code provider, native chat moderation, secure
mod ZIP ingestion, map-generation and profile-status improvements, job/schedule
recovery, and a comprehensive optimization/hardening pass for the Go host agent.

## User-facing changes

- Settings > AI Mod Editor can select Codex or Kimi Code. Each provider has
  separate encrypted credentials, model configuration, and connection testing.
- AI mod requests still produce proposals only. Users must review the line diff,
  approve it, and explicitly save through the constrained agent job.
- Mods accepts ZIP uploads and always installs them into quarantine first. The
  agent finds each `ModInfo.xml` and removes redundant wrapper or `Mods` folders.
- Chat includes a moderation directory with one action per word/phrase, flood
  thresholds, mute/unmute, audit events, and log/warn/kick behavior.
- Live Map reads world bounds from `map_info.xml`, shows current `visitmap`
  status, supports section generation and a strongly warned full-world action,
  verifies stop requests, supports player name tags, and keeps tiles visible at
  maximum zoom-out.
- Profile Editor shows Not queued, Queued, or Applied injection state with the
  relevant timestamp.

## Agent optimization and resilience

- Persistent log handle instead of repeated open/stat/seek/read/close cycles.
- Initial last-64-KiB behavior retained; appends, truncation, rotation,
  replacement, deletion/recreation, temporary errors, and cancellation covered.
- Ordered log batching at 64 KiB or 350 ms; failed uploads retain the unacknowledged
  bytes for retry. Direct byte uploads remove an avoidable reader/read-all copy.
- Reusable HTTP transport with keepalive/idle pooling, bounded ordinary/log
  deadlines, long-poll deadline plus 10 seconds grace, bounded redacted error
  bodies, and response draining for connection reuse.
- Exponential retry with jitter for job polling, heartbeat, and log failures.
- Read-only work is bounded by `jobs.max_concurrent_reads` (default 8, maximum
  64). Arbitrary RCON and SEND_COMMAND are serialized as mutations.
- Generic host metrics no longer probe hard-coded `127.0.0.1:26900`; the single
  configured/discovered 7DTD endpoint is checked every 15 seconds.
- Static host metadata is cached; agent versions come from linker flags;
  SIGTERM cancels loops cleanly; debug logs expose lightweight operational data.

## Schema and storage changes

- `Org.mod_ai_provider`, default `codex`.
- `Org.kimi_api_key_encrypted`, nullable encrypted Moonshot credential.
- `Org.kimi_model`, default `kimi-for-coding`.
- Added a private Compose volume for short-lived uploaded mod ZIPs.

Migration: `20260814000018_add_kimi_mod_editor`.

## Compatibility and safety

- Existing agent configs remain valid. Omitted `jobs.max_concurrent_reads` uses
  8; excessive values clamp to 64. Long polls clamp to 0–120 seconds.
- The existing log JSON API, pairing, agent keys, host IDs, autodiscovery,
  server registration, jobs, backups/restores, mods, profiles, RegionHealer,
  player controls, and systemd deployment remain compatible.
- The control plane still has one legacy host-level `gameReachable` field. This
  release uses the configured single 7DTD discovery endpoint and deliberately
  does not invent a misleading multi-instance aggregate.
- Disk-backed log spooling is deferred. In-memory outage retries preserve order,
  but a process restart falls back to the last 64 KiB and can duplicate accepted
  lines or miss an outage larger than that window.
- Full-world `visitmap` is intentionally available but clearly warns that it can
  freeze a busy server. Section generation is recommended.
- Do not commit provider keys, encryption/JWT secrets, Discord credentials,
  telnet passwords, agent keys, player/save data, or machine-specific sudoers.

## Validation performed

- `go test -timeout 120s ./...`
- `go vet ./...`
- `go test -race -timeout 180s ./...`
- Control-plane and web production image builds
- Live agent/control-plane/game health verification after deployment
- Secret-pattern scan of release changes and untracked files
- Log handoff benchmark on linux/amd64:
  - legacy reader/read-all: about 76 microseconds, 284,977 B, 17 allocations
  - direct bytes: 0 allocations in the isolated handoff benchmark

The live optimized agent held one descriptor for `server.log`, sampled at 0.0%
CPU and approximately 10 MiB RSS after deployment. The benchmark isolates copy
overhead and is not an end-to-end HTTP latency claim.

## Deployment notes

1. Apply the Prisma schema/migration before enabling Kimi Code.
2. Preserve a stable `OPENAI_KEY_ENCRYPTION_SECRET`; it protects both OpenAI and
   Moonshot credentials. Changing it makes stored credentials unreadable.
3. Rebuild control plane and web, then deploy the versioned Go agent.
4. Ensure the mod-upload private volume is writable by the control plane.
5. Verify the configured 7DTD discovery/telnet endpoint before relying on game
   reachability-gated player polling.
6. Install host-specific sudoers separately; it is intentionally not public.
