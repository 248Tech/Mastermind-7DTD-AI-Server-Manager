# Security Review — Threat Model, Mitigations, Refactors, Minimum to Ship

## 1. Threat Model

### 1.1 Assets

| Asset | Description |
|-------|-------------|
| Org data | Server instances, hosts, jobs, batches, schedules, bans, audit logs |
| Agent identity | Pairing tokens (single-use), agent JWTs (long-lived), host registration |
| Execution | Jobs executed on hosts (start/stop, RCON, commands) |
| Secrets | Telnet/RCON passwords, Discord webhook URLs, JWT secrets |

### 1.2 Actors

| Actor | Trust | Capabilities |
|-------|--------|--------------|
| Org admin/operator | Trusted (auth + RBAC) | Create tokens, rotate keys, create jobs, manage instances |
| Org viewer | Trusted read-only | List instances, batches, jobs |
| Agent | Authenticated device | Poll jobs, submit results, heartbeat (when implemented) |
| Unauthenticated | Untrusted | Pair (with token only), public game-types |
| Attacker | Untrusted | Probe APIs, attempt token brute-force, inject inputs |

### 1.3 Threat Summary

| ID | Threat | Likelihood | Impact | Current state |
|----|--------|------------|--------|----------------|
| T1 | Agent endpoints (report result, future poll/heartbeat) accept unauthenticated requests | High | High | **No agent auth guard** on `AgentJobsController`; anyone can submit job results for any host if they guess IDs |
| T2 | Pairing admin endpoints (create token, rotate key) not enforced | High | High | **Stub guards** in `pairing.controller.ts`: `JwtAuthGuard` and `OrgAdminGuard` always return true |
| T3 | Pair endpoint brute-force / DoS | Medium | Medium | No rate limiting on `POST /api/agent/pair` |
| T4 | Cross-org data leak | Medium | High | Mitigated by `OrgMemberGuard` on org-scoped routes; **must ensure every org route uses it** |
| T5 | RBAC bypass (viewer doing operator actions) | Low | High | Mitigated by `RequireOrgRoleGuard` where applied; **pairing uses stubs** |
| T6 | Command injection (start_command, RCON kick/ban) | Medium | High | Adapters use `exec.CommandContext(parts[0], parts[1:]...)` (no shell); **start_command can still be "sh -c '...'"**; RCON **kick/ban concatenate user input** |
| T7 | Log / audit injection | Low | Low | User input in error messages and audit details could inject newlines or control chars; no sanitization |
| T8 | Discord webhook abuse | Low | Low | Outbound only; rate limit per org; webhook URL is secret (org setting) |
| T9 | WebSocket auth / cross-org | N/A | Medium | **No WebSocket gateway implemented yet**; when added, must authenticate and scope by org |
| T10 | Signed jobs / job forgery | Medium | High | Agent trusts job list from control plane; **if poll is unauthenticated or spoofed**, attacker could inject jobs; poll must require agent JWT and return only jobs for that host |

---

## 2. Mitigations (by area)

### 2.1 Agent pairing

| Mitigation | Status | Action |
|------------|--------|--------|
| Token stored as hash only | Done | `PairingService.hashToken` (SHA-256) |
| Single-use + expiry | Done | `usedAt`, `expiresAt` validated |
| Agent JWT separate secret | Done | `JWT_AGENT_SECRET` in PairingModule |
| Verify keyVersion on use | Done | `verifyAgentKey` checks `host.agentKeyVersion` |
| **Create token / rotate key require JWT + org admin** | **Missing** | Replace stub guards with real JWT + org admin check |
| **Rate limit POST /api/agent/pair** | **Missing** | e.g. 10 req/min per IP (or per token hash attempt window) |
| HTTPS only (prod) | Doc | Enforce in deployment; no plaintext token in logs |

### 2.2 Signed jobs / agent auth

| Mitigation | Status | Action |
|------------|--------|--------|
| **All agent routes require agent JWT** | **Missing** | Add `AgentAuthGuard`: extract Bearer token, call `PairingService.verifyAgentKey`, attach `hostId`/`orgId` to request |
| **Validate hostId in URL matches JWT sub** | **Missing** | In guard or service: `req.params.hostId === payload.sub` |
| Poll (when implemented) returns only jobs for this host | Required | Filter by `hostId` from JWT; do not trust `hostId` from path alone for sensitive data |
| Job result: only allow reporting for runs belonging to this host | Done | `JobsService.reportJobResult` checks `run.hostId === hostId`; **but hostId is from URL and unauthenticated** — must derive hostId from JWT |

### 2.3 Discord

| Mitigation | Status | Action |
|------------|--------|--------|
| Outbound only (no inbound commands in MVP) | Done | Alerts only send to webhook |
| Rate limit per org | Done | DiscordService 10/60s |
| Webhook URL not logged | Review | Ensure audit does not log full URL; only org id / success failure |
| Future: slash commands / buttons | Doc | When adding bot, validate interaction, map to org, use existing CP APIs with auth |

### 2.4 RBAC boundaries

| Mitigation | Status | Action |
|------------|--------|--------|
| Org routes use OrgMemberGuard | Done | server-instances, batches, jobs (user-facing) use JwtAuthGuard + OrgMemberGuard |
| Write routes use RequireOrgRoleGuard | Done | Create/update/delete/cancel require admin or operator |
| **Pairing org routes use real admin check** | **Missing** | Replace OrgAdminGuard with guard that checks `req[ORG_ROLE_KEY] === 'admin'` (and optionally operator for create token) |
| Game-types public by design | Done | GET /api/game-types unauthenticated; no sensitive data |

### 2.5 Cross-org data leaks

| Mitigation | Status | Action |
|------------|--------|--------|
| orgId from URL + UserOrg lookup | Done | OrgMemberGuard loads role by `userId` + `orgId` from params |
| All org-scoped queries filter by orgId | Done | Services use `orgId` from param in Prisma where clauses |
| Batch/job creation scoped to org | Done | BatchesService.createBatch uses orgId from route; server instances validated `id in dto.serverInstanceIds && orgId` |
| Agent cannot access other orgs’ jobs | Required | When poll is implemented, return jobs only for host’s org (from JWT orgId) |

### 2.6 Log / audit injection

| Mitigation | Status | Action |
|------------|--------|--------|
| Sanitize user-controlled strings in audit details | Optional | Replace newlines/control chars in `details` values or truncate; low priority |
| Error messages to client | Review | Avoid reflecting unsanitized input in 4xx/5xx body |

### 2.7 Command injection

| Mitigation | Status | Action |
|------------|--------|--------|
| No shell for start/stop | Done | Adapters use `exec.CommandContext(name, args...)` with `strings.Fields` for start_command |
| **Allowlist executable for start_command** | Recommended | e.g. allow only `java`, `/bin/sh`, explicit script paths; reject `sh -c '...'` or constrain args |
| **RCON kick/ban: sanitize playerID and reason** | **Missing** | Reject or escape `;`, `\n`, `\r`, backslash in playerID and reason before sending to RCON |
| Job payload (command) from control plane | Trusted | Only org admins create jobs; payload is from CP; agent trusts it |

### 2.8 WebSocket auth

| Mitigation | Status | Action |
|------------|--------|--------|
| WS connection authenticated | N/A | No gateway yet |
| Room = org (or batch) | When impl | Join only org (or batch) room; verify JWT and org membership before join |
| Emit only to same org | When impl | batch.progress etc. to org room only |

### 2.9 Rate limiting

| Mitigation | Status | Action |
|------------|--------|--------|
| POST /api/agent/pair | Missing | Per-IP (e.g. 10/min) |
| User API (optional) | Missing | Per-user or per-org limits on write endpoints to reduce abuse |
| Discord outbound | Done | Per-org in DiscordService |

---

## 3. Required refactors

### 3.1 Critical (before production)

1. **Agent auth guard**
   - Create `AgentAuthGuard`: read `Authorization: Bearer <token>`, call `PairingService.verifyAgentKey(token)`, ensure `req.params.hostId === payload.sub`, attach `payload` to request.
   - Apply to all agent routes: `POST .../result`, and when added: `GET .../jobs/poll`, `POST .../heartbeat`, any other `/api/agent/hosts/:hostId/*`.
   - In `reportJobResult`, use `hostId` from the authenticated payload, not from URL (or keep URL but guard already enforced match).
   - **Implementation sketch:** New guard in e.g. `control-plane/src/agent/guards/agent-auth.guard.ts`; inject `PairingService`; in `canActivate` get `req.params.hostId`, extract Bearer token, call `verifyAgentKey`, throw `UnauthorizedException` if invalid or if `payload.sub !== req.params.hostId`; attach `req.agent = payload`. Register guard on `AgentJobsController` and any future agent controllers. JobsModule must import PairingModule (for PairingService).

2. **Pairing controller: real guards**
   - Replace stub `JwtAuthGuard` with the same `JwtAuthGuard` used by server-instances (verify user JWT, set `req.user.id`).
   - Replace stub `OrgAdminGuard` with a guard that runs after `JwtAuthGuard` and `OrgMemberGuard` (pairing routes need `orgId` in path and user in org with role admin). Either add `OrgMemberGuard` to pairing routes and require `orgRole === 'admin'`, or implement `OrgAdminGuard` that loads UserOrg by `userId` + `orgId` and checks role is admin (and optionally operator for create token only).
   - Ensure pairing module has access to Prisma and the same JWT user secret (e.g. import ServerInstancesModule guards or a shared AuthModule).
   - **Implementation sketch:** In `pairing.controller.ts`, remove local stub classes; import `JwtAuthGuard` and `OrgMemberGuard` from server-instances (or auth module), and `RequireOrgRoleGuard` + `@RequireOrgRoles('admin')` for create token and rotate key. PairingModule must import the module that exports these guards (e.g. ServerInstancesModule or a dedicated AuthModule). If ServerInstancesModule does not export guards, create a small AuthModule that exports JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard and is imported by both PairingModule and ServerInstancesModule.

3. **Rate limit POST /api/agent/pair**
   - Use NestJS Throttler or custom middleware: key by IP (from `X-Forwarded-For` or `req.ip`), e.g. 10 requests per 60 seconds per IP. Return 429 when exceeded.

### 3.2 High (strongly recommended)

4. **RCON kick/ban sanitization (agent)**
   - In 7dtd and minecraft adapters, before `SendCommand(ctx, cfg, "kick "+playerID)` (and ban), sanitize `playerID` and `reason`: reject or strip characters that could break or inject (e.g. `;`, `\n`, `\r`, `\`, or allow only alphanumeric + space for reason). Document allowed character set.

5. **start_command allowlist (agent)**
   - In adapters that run `StartCommand` via `exec.CommandContext(parts[0], parts[1:]...)`, allowlist the executable (e.g. `java`, `/bin/sh`, paths under `InstallPath`). Reject or fail if `parts[0]` is not in the list to prevent e.g. `sh -c 'malicious'` from a compromised or misconfigured payload.

### 3.3 Medium (when features land)

6. **Poll / heartbeat**
   - When implementing poll (and heartbeat), protect with `AgentAuthGuard`, and return only jobs (or accept heartbeats) for the host identified by the JWT (`payload.sub`). Do not trust `hostId` from path for authorization; use it only after verifying it matches `payload.sub`.

7. **WebSocket**
   - When implementing the gateway: authenticate connection (e.g. user JWT in query or first message), resolve org, allow join only to that org’s room (and optionally batch room). Emit batch.progress only to the org room.

8. **Audit / log sanitization**
   - Sanitize or truncate user-controlled fields before writing to `AuditLog.details` or log lines (e.g. newlines, control chars) to reduce log injection risk.

---

## 4. Minimum to ship (checklist)

Must-have before treating the system as production-ready:

- [ ] **Agent routes protected by agent JWT**  
  Implement and apply `AgentAuthGuard` to every `/api/agent/hosts/:hostId/*` route (report result now; poll/heartbeat when added). Reject requests without valid agent token; ensure path `hostId` matches token `sub`.

- [ ] **Pairing admin routes protected**  
  Replace stub `JwtAuthGuard` and `OrgAdminGuard` in the pairing controller with real user JWT verification and org admin (or operator) role check. Ensure only org members with the right role can create pairing tokens and rotate agent keys.

- [ ] **Rate limit on POST /api/agent/pair**  
  Apply per-IP rate limit (e.g. 10/min). Prefer integrating with Nest Throttler or equivalent so it’s consistent and easy to tune.

- [ ] **HTTPS in production**  
  Ensure control plane and agent communicate over HTTPS only (no plaintext pairing token or agent key on the wire).

- [ ] **Secrets not default in production**  
  Ensure `JWT_SECRET`, `JWT_AGENT_SECRET`, and any Discord webhook URLs are set from environment (or secret store), not default placeholders, in production.

- [ ] **RCON kick/ban input sanitization**  
  In 7dtd and minecraft adapters, sanitize or restrict character set for `playerID` and `reason` before sending to RCON to prevent command injection in the game server.

Recommended but can follow shortly after ship:

- [ ] start_command executable allowlist in adapters.
- [ ] When poll/heartbeat are implemented: auth + host-scoped responses only.
- [ ] When WebSocket is implemented: auth and org-scoped rooms only.
- [ ] Optional: audit/log sanitization for user-controlled fields.

---

## 5. References

- Agent pairing design: `docs/security-agent-pairing.md`
- Discord alerts: `docs/discord-alerts-architecture.md`
- Pairing service: `control-plane/src/pairing/pairing.service.ts`
- Agent jobs controller: `control-plane/src/jobs/agent-jobs.controller.ts`
- Org guards: `control-plane/src/server-instances/guards/`
