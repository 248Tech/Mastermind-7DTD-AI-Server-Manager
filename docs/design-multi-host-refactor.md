# Multi-Host per Org — Refactor Design

Host as first-class entity, server belongs to host, host health dashboard, agent offline detection, queue isolation per org, rate limiting per host.

---

## 1. Principles

- **Host** is the single unit of “machine running an agent.” One org has many hosts; each host has zero or more server instances.
- **Server instance** always belongs to exactly one host (already in schema). All job dispatch goes through “resolve server → host.”
- **Queue** remains one per org (`jobs:{orgId}`). Jobs in the queue carry `hostId` so only the right agent is given the job.
- **Rate limiting** is applied per host (concurrent runs, optional jobs/minute cap) so one busy host cannot starve others.

---

## 2. Data Model Adjustments

### 2.1 Host (fully separated)

Keep and extend:

| Field | Type | Purpose |
|-------|------|---------|
| id | cuid | PK |
| orgId | FK | Tenant |
| name | text | Display name (user or agent-provided) |
| lastHeartbeatAt | timestamptz | Last successful heartbeat; used for health and offline detection |
| agentVersion | text | From heartbeat |
| agentKeyVersion | int | For JWT rotation |
| **status** | text | **online \| offline \| degraded** — derived or backfilled; updated on heartbeat or by a periodic job that compares lastHeartbeatAt to threshold |
| **lastMetrics** | jsonb | **Optional** — last CPU/RAM/disk from heartbeat for dashboard |
| **labels** | jsonb | **Optional** — e.g. {"env":"prod","region":"us"} for filtering |
| createdAt, updatedAt | timestamptz | |

**Indexes:** orgId, (orgId, status), (lastHeartbeatAt) for offline sweep.

**Derived rule:** `status = 'offline'` when `lastHeartbeatAt < now() - threshold` (e.g. 2 minutes). Can be computed on read or updated by a cron.

### 2.2 ServerInstance

No structural change. Already has:

- **hostId** (required) — server belongs to host. All job dispatch resolves server → host.

### 2.3 Job and JobRun

No schema change. Semantics:

- **Job:** orgId, serverInstanceId (required for server-bound jobs), type, payload. Host is resolved from ServerInstance when enqueuing.
- **JobRun:** jobId, hostId (the host that will run or has run it), status, startedAt, finishedAt, result. Used for concurrency (max running per host) and rate limiting.

### 2.4 Queue (Redis/BullMQ)

- **Single queue per org:** `jobs:{orgId}`. No queue per host; job data includes `hostId` so the agent polling for that host only gets jobs where `data.hostId === myHostId`.
- **Isolation:** All jobs for an org live in one queue; agents filter by hostId when polling. No cross-org data.

---

## 3. Migration Strategy

### 3.1 Assumptions

- Existing data already has Host and ServerInstance with hostId. No “server without host.”
- Pairing already creates one Host per pairing; multiple pairings (or future “add host” flow) yield multiple hosts per org.

### 3.2 Migration Steps (order)

1. **Add Host columns (non-breaking)**  
   Add `status` (default 'unknown'), `lastMetrics`, `labels` (all nullable). Migration: `20250223000006_host_health_multi_host`. Deploy application that still works without them.

2. **Backfill Host.status**  
   One-time script or migration: for each host, set  
   `status = case when last_heartbeat_at >= now() - interval '2 minutes' then 'online' when last_heartbeat_at is not null then 'offline' else 'unknown' end`.  
   Then run a scheduler/cron that periodically sets `status = 'offline'` where `last_heartbeat_at < now() - interval '2 minutes'` and `status != 'offline'`.

3. **Heartbeat handler**  
   On heartbeat receipt: set `lastHeartbeatAt = now()`, `status = 'online'`, optionally `lastMetrics = payload.metrics`. No DB migration, only API change.

4. **Job dispatch and rate limiting**  
   Before enqueuing a job, resolve host from server; check per-host concurrency (and optional rate limit). Use existing JobRun table; optional Redis counters for rate (e.g. `host:{hostId}:jobs_last_minute` with TTL). Deploy behind feature flag if desired.

5. **Dashboard and offline alerts**  
   Host list/dashboard reads Host (with status, lastMetrics, lastHeartbeatAt). Offline detection already supported by status or `lastHeartbeatAt`; wire AGENT_OFFLINE alert to `status = 'offline'` or threshold.

### 3.3 Rollback

- New columns can stay nullable; removing them is a later migration if needed.
- Rate limiting and status updates are additive; disabling them does not require reverting schema.

---

## 4. Updated Job Dispatch Flow

### 4.1 Create job (API)

1. Input: orgId, type, serverInstanceId, payload (and optional createdById).
2. **Resolve host:** Load ServerInstance(serverInstanceId); verify orgId; get hostId. If server or host missing → 404/400.
3. **Optional — skip if host offline:** If Host.status = 'offline', either reject (e.g. 503) or enqueue anyway and let it run when host comes back. Recommended: enqueue; agent will pick up when online.
4. **Per-host concurrency:** Count JobRun where hostId = X and status = 'running'. If count >= maxConcurrentPerHost (e.g. 1) → return 429 or enqueue and let poll logic delay giving more work. Recommended: enqueue; “get next job for host” already enforces “no job if host has running run.”
5. **Per-host rate limit (optional):** In Redis, increment `host:{hostId}:count` in a 1-minute window; if over limit (e.g. 10/min), return 429. Or enforce only in “get next job” so excess jobs stay queued.
6. **Persist:** Create Job (orgId, serverInstanceId, type, payload, createdById). Create JobRun (jobId, hostId, status = 'pending').
7. **Enqueue:** Add to queue `jobs:{orgId}` with job data `{ jobId, jobRunId, hostId, serverInstanceId, type, payload }`.
8. **Audit and notify:** Audit log job_created; WebSocket job.created.

### 4.2 Agent polls (get next job for host)

1. Input: hostId (from agent auth).
2. **Concurrency:** If there exists a JobRun with this hostId and status = 'running', return empty (no new job).
3. **Poll queue:** Get jobs from `jobs:{orgId}` (e.g. get waiting jobs, filter by data.hostId === hostId). Take one (FIFO or priority).
4. **Claim:** Update that job’s JobRun to status = 'running', startedAt = now(). Return job + jobRunId to agent.
5. **Rate (optional):** Increment Redis counter for this host’s “jobs started this minute”; if over limit, do not return another job until next minute.

### 4.3 Agent reports result

1. Update JobRun (status, finishedAt, result).  
2. Remove or ack job in queue.  
3. WebSocket job_run.done.  
4. (Optional) Decrement or expire Redis rate counter if used.

---

## 5. Host Health Dashboard

- **List hosts:** GET `/api/orgs/:orgId/hosts` — return id, name, status, lastHeartbeatAt, agentVersion, lastMetrics (and labels). Filter by status or labels if needed.
- **Single host:** GET `/api/orgs/:orgId/hosts/:hostId` — same fields plus list of server instances and recent job runs.
- **Status:** `online` (recent heartbeat), `offline` (no heartbeat within threshold), `degraded` (optional: e.g. high failure rate or manual flag).
- **Metrics:** From lastMetrics (CPU, RAM, disk) last sent by agent; display in dashboard.

---

## 6. Agent Offline Detection

- **Threshold:** e.g. 2 minutes without heartbeat → consider host offline.
- **Option A — computed:** Dashboard and alerts compute `lastHeartbeatAt < now() - 2min` as “offline.” No Host.status column.
- **Option B — stored:** Periodic job (e.g. every 1 min) sets `Host.status = 'offline'` where `lastHeartbeatAt < now() - 2min`. Heartbeat handler sets `status = 'online'`. Alerts and dashboard read status.
- **Alert:** Existing AGENT_OFFLINE alert: trigger when status becomes offline or when computed offline. Emit to Discord/webhook.

---

## 7. Queue Isolation per Org

- **Single queue per org:** `jobs:{orgId}`. All jobs for that org go into this queue.
- **Isolation:** No shared queue across orgs. Agent authenticates as a host; host belongs to one org; poll only returns jobs from that org’s queue whose hostId matches. No cross-org visibility.

---

## 8. Rate Limiting per Host

| Limit | Where enforced | Implementation |
|-------|----------------|----------------|
| **Concurrent runs** | Get-next-job (and optionally create-job) | Count JobRun where hostId = X and status = 'running'. Max e.g. 1 (or N). Do not return another job if at cap. |
| **Jobs per minute** | Create-job or get-next-job | Redis key `host:{hostId}:jobs_minute:{minute}` increment + TTL 60s; if value > cap (e.g. 10), reject or do not return job. |

---

## 9. Summary

- **Host** is first-class: add status, lastMetrics, labels; heartbeat updates lastHeartbeatAt and status.
- **Server** belongs to host (unchanged).
- **Host health:** Dashboard reads Host + status + lastMetrics; offline = no heartbeat within threshold.
- **Offline detection:** Stored (status) or computed; alert on offline.
- **Queue:** One per org; job data includes hostId; agents filter by hostId when polling.
- **Rate limiting:** Per-host concurrency via JobRun running count; optional per-host jobs/minute via Redis.
- **Migration:** Add nullable Host columns → backfill status → heartbeat writes status → deploy dispatch and poll with concurrency and optional rate limit.
