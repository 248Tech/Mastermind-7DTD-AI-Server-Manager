# Observability System — Design

MVP: Postgres-backed structured logs, job telemetry, alert history. Scale-ready: Loki, Prometheus, Grafana.

---

## 1. Log levels

Use a single standard set across control plane and agent.

| Level   | Numeric | Use when |
|--------|---------|----------|
| **error** | 3 | Failure that affects a request or operation; requires attention. |
| **warn**  | 2 | Recoverable or degraded (e.g. rate limit, retry, validation). |
| **info**  | 1 | Normal flow: request completed, job started/finished, batch progress. |
| **debug** | 0 | Development/troubleshooting; avoid in production at high volume. |

- **Default:** `info` in production, `debug` in development (configurable).
- **Structured field:** `level` (string) and optionally `level_num` (number) in every log record.

---

## 2. Structured log format

Every log entry is a single JSON object with a fixed schema plus optional context.

### 2.1 Required fields

| Field       | Type   | Description |
|------------|--------|-------------|
| **ts**     | string | ISO 8601 UTC timestamp. |
| **level**  | string | `error` \| `warn` \| `info` \| `debug`. |
| **message**| string | Human-readable one-line message. |
| **service**| string | Component name: `control-plane`, `agent`, `scheduler`. |

### 2.2 Recommended context (when available)

| Field        | Type   | Description |
|-------------|--------|-------------|
| **org_id**  | string | Tenant; enables org-scoped queries. |
| **request_id** | string | Per-request or per-job correlation. |
| **host_id** | string | Agent/host (agent logs, job execution). |
| **job_id** / **job_run_id** | string | Job telemetry correlation. |
| **batch_id**| string | Bulk operation correlation. |
| **user_id** | string | Actor (control plane only). |
| **error**   | string | Error message or stack (for error level). |
| **duration_ms** | number | Request or job duration. |

### 2.3 Example (control plane)

```json
{
  "ts": "2025-02-23T14:00:00.000Z",
  "level": "info",
  "message": "Batch completed",
  "service": "control-plane",
  "org_id": "org_1",
  "batch_id": "batch_abc",
  "status": "completed_with_failures",
  "success_count": 18,
  "failed_count": 2
}
```

### 2.4 Example (agent)

```json
{
  "ts": "2025-02-23T14:00:01.000Z",
  "level": "info",
  "message": "Job run finished",
  "service": "agent",
  "host_id": "host_xyz",
  "job_id": "job_123",
  "job_run_id": "run_456",
  "status": "success",
  "duration_ms": 45000
}
```

---

## 3. MVP: Store meaningful logs in Postgres

### 3.1 Table: `app_logs`

Store a subset of logs in Postgres for querying and alert history. High-volume debug logs stay out of DB in MVP.

| Column       | Type      | Description |
|-------------|-----------|-------------|
| id          | cuid      | PK. |
| org_id      | FK (nullable) | Org; null for system/agent logs not yet tied to org. |
| ts          | timestamptz | Log timestamp. |
| level       | text      | error, warn, info, debug. |
| message     | text      | Short message (e.g. max 2KB). |
| service     | text      | control-plane, agent, scheduler. |
| request_id  | text (nullable) | Correlation id. |
| host_id     | text (nullable) | For agent/host context. |
| job_id      | text (nullable) | Job correlation. |
| job_run_id  | text (nullable) | Job run correlation. |
| batch_id    | text (nullable) | Batch correlation. |
| meta        | jsonb     | Extra structured context (error, duration_ms, etc.). |
| created_at  | timestamptz | Insert time. |

**Indexes:** `(org_id, ts DESC)`, `(service, ts DESC)`, `(level, ts DESC)` for error dashboards, `(job_run_id)` for job-centric view.

**Prisma (for migration):**
```prisma
model AppLog {
  id         String    @id @default(cuid())
  orgId      String?   @map("org_id")
  ts         DateTime  @map("ts")
  level      String    @map("level")   // error | warn | info | debug
  message    String    @db.VarChar(2048)
  service    String    @map("service")
  requestId  String?   @map("request_id")
  hostId     String?   @map("host_id")
  jobId      String?   @map("job_id")
  jobRunId   String?   @map("job_run_id")
  batchId    String?   @map("batch_id")
  meta       Json?     @map("meta")
  createdAt  DateTime  @default(now()) @map("created_at")

  org Org? @relation(fields: [orgId], references: [id], onDelete: SetNull)

  @@index([orgId, ts(sort: Desc)])
  @@index([service, ts(sort: Desc)])
  @@index([level, ts(sort: Desc)])
  @@index([jobRunId])
}
```

**What to write to `app_logs`:**
- **Control plane:** Batch created/completed/cancelled, job created, pairing, key rotation, schedule fire, alert send (success/failure), and **error**/warn from guards and services (with org_id when available).
- **Agent:** Job run started/finished (info), adapter errors (error), pairing success/failure. Optionally heartbeat failures (warn).
- **Do not** log every HTTP request at info in Postgres in MVP; use stdout for that and optionally ship to Loki later.

### 3.2 Pipeline rule (MVP)

- **Emit:** All services emit structured JSON to **stdout** (one JSON object per line).
- **Persist to Postgres:** A logging middleware or dedicated logger in the control plane (and agent, if it pushes to an API) writes only **info** and **error** (and optionally **warn**) that match a small set of **event types** (e.g. `batch.completed`, `job_run.finished`, `alert.sent`, `pairing.completed`, `error`) into `app_logs`. No need to persist every debug or every generic info line.
- **Rule:** If `level === 'error'` → always persist. If `level === 'info'` and `event_type` in allowlist → persist. Otherwise → stdout only.

---

## 4. Job telemetry

### 4.1 Existing data (JobRun)

- `status`, `startedAt`, `finishedAt`, `result` (JSON: durationMs, errorMessage, output), `logRef`.
- **Schedule:** `lastRunAt`, `lastRunStatus`, `lastRunJobId`, `runCount`, `failureCount`.

### 4.2 Enrichment for telemetry

- **Compute duration:** `finishedAt - startedAt` (or from `result.durationMs` if agent reports it).
- **Store in result or meta:** `durationMs`, `exitCode` (if applicable), `adapter` (e.g. 7dtd, minecraft).
- **Emit one structured log per run:** `job_run.started`, `job_run.finished` (with status, duration_ms, job_id, job_run_id, host_id, batch_id, org_id) so Loki/Postgres can index them.

### 4.3 Optional: `job_telemetry` table (MVP or scale)

If you want fast aggregates without scanning JobRun:

| Column       | Type        | Description |
|-------------|-------------|-------------|
| id          | cuid        | PK. |
| org_id      | FK          | Org. |
| job_id      | FK          | Job. |
| job_run_id  | FK          | JobRun. |
| host_id     | FK          | Host. |
| batch_id    | text (nullable) | Batch. |
| job_type    | text        | SERVER_RESTART, RCON, etc. |
| status      | text        | success, failed, cancelled. |
| started_at  | timestamptz | When run started. |
| finished_at | timestamptz | When run finished. |
| duration_ms | int (nullable) | Finished - started or from result. |
| server_instance_id | text (nullable) | Server. |

**Indexes:** `(org_id, finished_at DESC)`, `(batch_id, finished_at)`, `(host_id, finished_at DESC)`.

Either:
- **Option A (MVP):** No separate table; use JobRun + `app_logs` for “job telemetry” (query JobRun for lists, use logs for traces), or  
- **Option B:** Add `job_telemetry` and write one row per JobRun completion (denormalized for dashboards).

---

## 5. Alert history

### 5.1 Current state

- Alerts are sent via `AlertsService.sendAlert` and recorded in **AuditLog** (`action: alert_sent`, resourceType: discord, details: alertType, success, error, serverInstanceId, hostId).

### 5.2 Dedicated `alert_history` table (recommended)

Makes “alert history” queries and Grafana dashboards straightforward without scanning AuditLog.

| Column       | Type        | Description |
|-------------|-------------|-------------|
| id          | cuid        | PK. |
| org_id      | FK          | Org. |
| alert_type  | text        | SERVER_DOWN, SERVER_RESTART, AGENT_OFFLINE, etc. |
| channel_type| text        | discord, slack, etc. |
| status      | text        | sent, failed, rate_limited. |
| context     | jsonb       | serverInstanceId, hostId, hostName, etc. (AlertContext). |
| error       | text (nullable) | Delivery error if status = failed. |
| created_at  | timestamptz | When the alert was fired. |

**Indexes:** `(org_id, created_at DESC)`, `(alert_type, created_at DESC)`.

**Prisma (for migration):**
```prisma
model AlertHistory {
  id          String    @id @default(cuid())
  orgId       String    @map("org_id")
  alertType   String    @map("alert_type")
  channelType String    @map("channel_type")
  status      String    @map("status")   // sent | failed | rate_limited
  context     Json?     @map("context")
  error       String?   @map("error")
  createdAt   DateTime  @default(now()) @map("created_at")

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, createdAt(sort: Desc)])
  @@index([alertType, createdAt(sort: Desc)])
}
```

**Pipeline:** When `AlertsService.sendAlert` is called, after sending (and current AuditLog write), also insert one row into `alert_history` with alert_type, channel_type, status, context, error. Keeps AuditLog for audit trail and alert_history for observability.

---

## 6. Log pipeline rules (summary)

| Stage        | Rule | Action |
|-------------|------|--------|
| **Emit**    | All services | Emit one JSON line per log to stdout (ts, level, message, service, + context). |
| **Persist (MVP)** | level === `error` | Always insert into `app_logs` (with org_id, job_run_id, etc. when present). |
| **Persist (MVP)** | level === `info` and event in allowlist | Insert into `app_logs` (e.g. batch.completed, job_run.finished, alert.sent, pairing.*). |
| **Persist (MVP)** | level === `warn` and event in allowlist | Optional: same allowlist as info. |
| **Do not persist** | level === `debug` | Stdout only. |
| **Do not persist** | High-cardinality per-request info | Stdout only; optional Loki later. |
| **Retention (Postgres)** | By age | Delete from `app_logs` where `ts < now() - retention_days` (e.g. 30 days). |
| **Scale (Loki)** | All stdout | Ship stdout to Loki; optional Promtail or sidecar. |

---

## 7. Alert rule engine model

### 7.1 Current schema (AlertRule)

- `condition` (JSON), `channel` (JSON), `enabled`.

### 7.2 Condition model (structured)

Define a small, explicit schema for `condition` so the engine is deterministic and safe.

```ts
// Condition: what triggers the alert
type AlertCondition =
  | { type: 'heartbeat_missed'; hostId: string; windowMinutes?: number }
  | { type: 'job_run_failed'; jobRunId?: string; jobType?: string; serverInstanceId?: string }
  | { type: 'batch_failed'; batchId?: string; minFailedCount?: number }
  | { type: 'schedule_failed'; scheduleId?: string; consecutiveFailures?: number }
  | { type: 'server_down'; serverInstanceId?: string; hostId?: string };
```

- **Evaluation:** A periodic evaluator (cron or worker) runs every 1–5 minutes:
  - Load enabled AlertRules.
  - For each rule, evaluate `condition` against current state (e.g. last heartbeat time, JobRun status, Schedule failureCount, host status).
  - If condition matches and **cooldown** has passed since last fire for that rule (e.g. 15 min), call `AlertsService.sendAlert` with the rule’s channel and context, then record last-fired time (in rule or in alert_history).

### 7.3 Channel model

```ts
type AlertChannel =
  | { type: 'discord'; webhookUrl?: string }  // use org default if omitted
  | { type: 'slack'; webhookUrl: string }
  | { type: 'email'; to: string[] };  // future
```

### 7.4 Rule engine flow

1. **Input:** AlertRule (condition, channel, enabled), current state (heartbeats, JobRuns, Schedules, host status).
2. **Match:** For each rule, evaluate condition type and filters (hostId, scheduleId, etc.).
3. **Dedupe / cooldown:** Same rule + same entity (e.g. same host) not fired again within cooldown window.
4. **Output:** Call sendAlert; write to alert_history (and optionally Event for audit).

---

## 8. Retention strategy

| Data           | MVP (Postgres) | Scale (Loki/Prometheus) |
|----------------|----------------|---------------------------|
| **app_logs**   | 30 days (configurable); delete by `ts`. Optional partition by month. | N/A; use Loki. |
| **alert_history** | 90 days (or 1 year); delete by `created_at`. | Optional export to cold storage. |
| **AuditLog**   | 1 year (compliance); archive or delete older. | N/A. |
| **Event**      | 90 days; delete by `created_at`. | N/A or export. |
| **JobRun / Job** | Keep forever or 1 year; optional archive of old runs. | Metrics from runs → Prometheus. |
| **Stdout (Loki)** | N/A in MVP. | Per-tenant or global retention (e.g. 30 days). |
| **Prometheus**| N/A in MVP. | 15d–30d local; long-term in object storage if needed. |

### 8.1 Implementation (MVP)

- **Scheduled job:** Daily (or weekly) delete from `app_logs` where `ts < now() - interval '30 days'`. Same for `alert_history` with 90 days. Use raw SQL or Prisma in a cron/worker.
- **Config:** `LOG_RETENTION_DAYS`, `ALERT_HISTORY_RETENTION_DAYS` in env.

---

## 9. Scale-ready: Loki, Prometheus, Grafana

### 9.1 Loki (logs)

- **Source:** All services emit JSON lines to stdout; no change.
- **Collect:** Promtail or Fluent Bit on each node (or sidecar) reads stdout/files and pushes to Loki.
- **Labels:** At least `service`, `level`; optionally `org_id` (if multi-tenant). Avoid high-cardinality labels (e.g. request_id as label).
- **Query:** LogQL for errors, job_run_id, batch_id, org_id. Use `app_logs` in Postgres for recent, critical events; use Loki for full-text and long retention.
- **Pipeline rule:** Same as MVP: only “meaningful” logs go to Postgres; **all** logs go to Loki (via stdout → Promtail).

### 9.2 Prometheus (metrics)

- **Control plane:** Expose `/metrics` (e.g. NestJS with `@willsoto/nestjs-prometheus` or similar). Key metrics:
  - `http_requests_total`, `http_request_duration_seconds` (by route, method, status).
  - `jobs_created_total`, `job_runs_total` (by status, job_type, org_id if low cardinality).
  - `batches_created_total`, `batches_completed_total`.
  - `alerts_sent_total` (by type, status).
  - `pairing_tokens_created_total`, `agent_pairings_total`.
- **Agent:** Optional: expose `/metrics` (Go prometheus client) — e.g. jobs_executed_total, last_heartbeat_timestamp.
- **Scrape:** Prometheus scrapes control plane (and agents) on an interval. In scale, use Prometheus Operator or Grafana Agent.
- **Job telemetry:** Prefer metrics for counts and latency (e.g. `job_run_duration_seconds`); keep JobRun/Postgres for per-run detail.

### 9.3 Grafana

- **Dashboards:**
  - **Logs:** Loki datasource; panels by service, level, org_id, job_run_id.
  - **Metrics:** Prometheus; request latency, job/batch throughput, alert volume, pairing volume.
  - **Postgres:** Optional datasource for `app_logs`, `alert_history`, JobRun aggregates (if not in Prometheus).
- **Alerts:** Define Grafana alert rules on Prometheus/Loki (e.g. error rate, job failure rate, heartbeat stale). Can mirror or replace part of the in-app AlertRule engine for infra-level alerts.

### 9.4 Migration path (MVP → scale)

1. **MVP:** Structured stdout + Postgres `app_logs` + `alert_history`; job telemetry from JobRun + logs.
2. **Add Loki:** Deploy Promtail (or equivalent), point to Loki; keep writing same stdout; no app code change.
3. **Add Prometheus:** Add `/metrics` to control plane (and optionally agent); configure scrape; add dashboards.
4. **Tune retention:** Reduce Postgres log retention (e.g. 7 days) once Loki is primary for logs; keep alert_history and AuditLog in Postgres.

---

## 10. Summary

| Area | MVP | Scale-ready |
|------|-----|-------------|
| **Log levels** | error, warn, info, debug (standard set). | Same. |
| **Structured format** | JSON with ts, level, message, service + context (org_id, job_run_id, etc.). | Same; emit to stdout. |
| **Postgres logs** | `app_logs` for errors and allowlisted info/warn. | Optional; prefer Loki. |
| **Job telemetry** | JobRun + result; optional `job_telemetry` or just logs. | Prometheus metrics + Loki logs. |
| **Alert history** | `alert_history` table; AlertsService writes after send. | Same; optional export. |
| **Pipeline** | Emit all to stdout; persist subset to `app_logs` by level + event allowlist. | Stdout → Promtail → Loki; Postgres optional. |
| **Alert rule engine** | Condition (typed: heartbeat_missed, job_run_failed, etc.) + channel; evaluator + cooldown. | Same; optional Grafana alerts for infra. |
| **Retention** | app_logs 30d, alert_history 90d, configurable. | Loki/Prometheus retention; Postgres for critical only. |
