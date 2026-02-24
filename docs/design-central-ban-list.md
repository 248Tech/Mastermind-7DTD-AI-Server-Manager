# Central Ban List — Design

Org-level ban list, sync to game servers, per-server sync status, manual resync, audit. 7DTD first, multi-game ready.

---

## 1. Concepts

- **Central ban (OrgBan):** One row per banned identity in an org. Stores who banned, reason, timestamp. Org-level source of truth.
- **Sync record (BanEntry):** One row per (central ban, server). Tracks whether that ban has been applied on that server (sync status, last sync time, error). Pushing a ban to a server creates or updates a BanEntry linked to the OrgBan.
- **Sync:** Agent runs a job (e.g. RCON/telnet) to add the ban on the game server; outcome updates the BanEntry sync fields.

---

## 2. Schema

### 2.1 OrgBan (new) — central list

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | PK |
| orgId | FK → orgs | Tenant |
| identifierType | text | steam_id \| ip \| name (game-specific; 7DTD: steam_id, ip) |
| identifierValue | text | Value (e.g. Steam ID, IP) |
| reason | text nullable | Ban reason |
| bannedAt | timestamptz | When banned |
| expiresAt | timestamptz nullable | Optional expiry |
| createdById | FK nullable → users | Who banned (audit) |
| createdAt | timestamptz | Record creation |

**Unique:** (orgId, identifierType, identifierValue) so the same identity is not added twice in one org.

**Indexes:** orgId, (orgId, identifierType, identifierValue).

### 2.2 BanEntry (extended) — per-server sync

Keep existing columns; add:

| Column | Type | Description |
|--------|------|-------------|
| orgBanId | FK nullable → org_bans | When set, this row is a sync record for that central ban on this server |
| syncStatus | text | pending \| synced \| failed |
| syncedAt | timestamptz nullable | Last successful sync |
| lastSyncError | text nullable | Last failure message |
| lastSyncJobId | text nullable | Job that last ran sync (for debugging) |

**Semantics:**
- If **orgBanId is set:** BanEntry is the sync record for that OrgBan on **serverInstanceId**. identifierType/identifierValue/reason/bannedAt/expiresAt/createdById can be denormalized from OrgBan or read from it for display.
- If **orgBanId is null:** Legacy “server-only” ban (created directly on that server); no central list involvement.

**Indexes:** orgBanId, (serverInstanceId, syncStatus).

---

## 3. API (high level)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/orgs/:orgId/bans | List **central** bans (OrgBans) with per-server sync status (join BanEntry where orgBanId = id). |
| GET | /api/orgs/:orgId/bans/:id | One OrgBan + list of BanEntries (per-server sync status). |
| POST | /api/orgs/:orgId/bans | Add to **central list**: body identifierType, identifierValue, reason?, expiresAt?, serverInstanceIds? (default: all servers in org). Creates OrgBan and one BanEntry per server with sync_status=pending; enqueues sync jobs. |
| PATCH | /api/orgs/:orgId/bans/:id | Update OrgBan (reason, expiresAt). Optionally “resync” (see below). |
| DELETE | /api/orgs/:orgId/bans/:id | Remove from central list; optionally remove from servers (enqueue unban jobs) and delete BanEntries. |
| POST | /api/orgs/:orgId/bans/:id/sync | **Manual resync:** Enqueue sync job(s) for this ban (all servers or body serverInstanceIds). Updates BanEntry sync_status to pending; when job completes, update syncedAt/lastSyncError. |
| GET | /api/orgs/:orgId/server-instances/:serverId/bans | List bans for one server (BanEntries for that serverInstanceId; include OrgBan when orgBanId set). |

---

## 4. Execution flow

### 4.1 Add ban (central list)

1. Validate body (identifierType, identifierValue, reason?, expiresAt?, serverInstanceIds?).
2. Resolve target servers: body.serverInstanceIds or all server instances in org (for 7DTD: same org).
3. Create **OrgBan** (orgId, identifierType, identifierValue, reason, bannedAt, expiresAt, createdById). Enforce unique (orgId, identifierType, identifierValue); if exists return 409.
4. For each target server: create **BanEntry** (orgBanId, serverInstanceId, orgId, identifierType, identifierValue, reason, bannedAt, expiresAt, createdById, syncStatus=pending).
5. **Audit:** action=ban_created, resourceType=org_ban, resourceId=orgBan.id, details={ identifierType, identifierValue, serverCount }.
6. Enqueue **sync jobs** (one per server): job type e.g. BAN_SYNC, payload { orgBanId, banEntryId, serverInstanceId }. Agent runs game adapter “apply ban”; on success/failure report back and update BanEntry (syncedAt, syncStatus, lastSyncError, lastSyncJobId).

### 4.2 Manual resync

1. POST .../bans/:id/sync, optional body { serverInstanceIds?: [] }.
2. Load OrgBan; if missing or wrong org → 404.
3. Resolve BanEntries for this OrgBan (and filter by serverInstanceIds if provided). Set syncStatus=pending, clear syncedAt/lastSyncError for those.
4. Enqueue sync jobs (same as above) for each selected BanEntry.
5. **Audit:** action=ban_sync_requested, resourceType=org_ban, resourceId, details={ serverInstanceIds }.

### 4.3 Sync job (agent / game adapter)

1. Agent receives job BAN_SYNC with { orgBanId, banEntryId, serverInstanceId }.
2. Load server instance config (e.g. 7DTD telnet host/port/password).
3. **Game adapter** (7DTD): build “ban” command from identifierType/identifierValue (e.g. ban add steamId \<value\> or equivalent). Send via telnet/RCON; parse response.
4. On success: report job success; backend updates BanEntry (syncStatus=synced, syncedAt=now, lastSyncJobId=jobId).
5. On failure: report job failed; backend updates BanEntry (syncStatus=failed, lastSyncError=message, lastSyncJobId=jobId).
6. **Audit:** optional audit_sync_completed per server (or rely on job run + existing audit).

---

## 5. Track who banned, reason, timestamp

- **Who banned:** OrgBan.createdById (and BanEntry.createdById when denormalized).
- **Reason:** OrgBan.reason (and BanEntry.reason if denormalized).
- **Timestamp:** OrgBan.bannedAt (and BanEntry.bannedAt).

All three are on the central record (OrgBan); per-server BanEntry can mirror them for display or be joined from OrgBan.

---

## 6. Per-server sync status

- **BanEntry** (with orgBanId set) is the per-server row: serverInstanceId, syncStatus (pending | synced | failed), syncedAt, lastSyncError, lastSyncJobId.
- List central bans: for each OrgBan return list of { serverInstanceId, serverName?, syncStatus, syncedAt, lastSyncError } from joined BanEntries.
- “Manual resync” sets those entries back to pending and enqueues jobs; completion updates status.

---

## 7. Audit logs

| Action | resourceType | resourceId | details (example) |
|--------|--------------|------------|-------------------|
| ban_created | org_ban | orgBan.id | identifierType, identifierValue, serverCount |
| ban_updated | org_ban | orgBan.id | reason?, expiresAt? |
| ban_deleted | org_ban | orgBan.id | — |
| ban_sync_requested | org_ban | orgBan.id | serverInstanceIds |

Store actorId and ip on each AuditLog row.

---

## 8. 7DTD first

- **Identifier types:** steam_id, ip (and optionally name for display only; sync may use steam_id when available).
- **Apply ban:** 7DTD typically uses telnet/admin port: e.g. “ban add \<steamId\> \<duration\> \<reason\>” or equivalent. Game adapter implements `applyBan(serverInstance, identifierType, identifierValue, reason?, expiresAt?)` and returns success/error.
- **Unban (on delete):** Optional job type BAN_UNSYNC to remove ban on server; same adapter `removeBan(...)`.

---

## 9. Future multi-game compatibility

- **OrgBan** stays game-agnostic (identifierType, identifierValue, reason, time). identifierType can be game-specific (e.g. steam_id for Steam games, xuid for others) or generic (external_id, ip).
- **Game adapter interface:** e.g. `BanSyncAdapter`: applyBan(serverInstance, banPayload) → { ok, error? }; removeBan(serverInstance, identifier) → { ok, error? }. Each game (7DTD, etc.) implements this; scheduler or job executor selects adapter by server’s gameTypeId.
- **Sync job payload:** Include gameType or serverInstanceId so the backend/agent can resolve the adapter. BanEntry/OrgBan do not need a game type column; the server’s game type drives which adapter runs.

---

## 10. Summary

- **Central list:** OrgBan (org, identifier, reason, who, when). Unique per (org, identifierType, identifierValue).
- **Sync to servers:** BanEntry per (OrgBan, server) with sync status; sync jobs run via agent and game adapter; status updated on job completion.
- **Manual resync:** POST .../bans/:id/sync enqueues sync jobs and sets status to pending.
- **Audit:** ban_created, ban_updated, ban_deleted, ban_sync_requested.
- **7DTD:** First adapter (telnet/RCON ban commands); schema and flow support multiple games via adapters.
