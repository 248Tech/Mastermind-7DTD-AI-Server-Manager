# Bulk Server Operations — Design

Batch jobs (restart wave, update wave, bulk mod install) with partial failure tracking, progress aggregation, cancel batch, and audit per server action.

---

## 1. Execution Model

### 1.1 Concepts

- **Batch:** A single user-initiated bulk operation. It has a type (e.g. `restart_wave`, `update_wave`, `bulk_mod_install`), a list of server instances, and a shared payload. One batch produces **N jobs** (one per server).
- **Job:** Unchanged. Each job has optional `batchId`; when set, the job is part of that batch. Each job still has one JobRun (per host); execution is the same as single-job flow.
- **Progress:** Aggregated from the batch’s jobs (or their JobRuns): counts of pending, running, success, failed, cancelled. Batch is **completed** when no run is pending or running (all finished or cancelled).

### 1.2 Batch lifecycle

1. **Create batch**  
   User selects operation type, server list (or filter), and payload.  
   - Create **JobBatch** (orgId, type, status=running, totalCount=N, counts 0).  
   - For each server: create **Job** (orgId, serverInstanceId, type, payload, batchId, createdById); create **JobRun** (jobId, hostId, status=pending); enqueue job to `jobs:{orgId}`.  
   - **Audit:** batch_created (batchId, type, serverCount).  
   - **Audit (per job):** job_created (jobId, batchId, serverInstanceId) so each server action is audited.

2. **Execution**  
   Agents poll and run jobs as today. Each job is independent; no global “batch concurrency” limit beyond existing per-host limits. When a **JobRun** completes (success/failed/cancelled):  
   - Update batch counts (increment success/failed/cancelled).  
   - If no run left pending or running → set batch status = **completed** (or **completed_with_failures** if any failed).  
   - **Audit:** job_run_completed (or keep existing job_created; optional extra audit for run completion).  
   - WebSocket: emit **batch.progress** (batchId, counts, status).

3. **Cancel batch**  
   User clicks “Cancel batch.”  
   - Set batch status = **cancelled**.  
   - For each job in batch whose JobRun is still **pending**: set JobRun status = **cancelled**; remove job from queue (if not yet consumed). Running jobs are left to finish.  
   - **Audit:** batch_cancelled (batchId, remainingPending).  
   - WebSocket: batch.progress (batchId, status=cancelled).

### 1.3 Progress aggregation

- **Source of truth:** Counts can be derived from JobRun status for jobs in the batch, or stored on JobBatch and updated on every run completion (denormalized for fast reads).
- **Counts:** total, pending, running, success, failed, cancelled.  
  `total = pending + running + success + failed + cancelled`.
- **Batch status:** running | completed | completed_with_failures | cancelled.  
  - **running:** at least one pending or running.  
  - **completed:** all success (or success + cancelled with no failed).  
  - **completed_with_failures:** at least one failed.  
  - **cancelled:** user cancelled.

### 1.4 Partial failure tracking

- Each **JobRun** has its own status (success | failed | cancelled). The batch view lists each job/run (e.g. by server instance) with its status and optional error (result.errorMessage).
- **Batch-level:** successCount, failedCount, cancelledCount; optional failedJobIds[] or list failed runs for “retry failed” later.
- No automatic retry of failed jobs within the batch; user can start a new batch for failed servers only if desired.

---

## 2. Data Model

### 2.1 JobBatch (new)

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | PK |
| orgId | FK | Tenant |
| type | text | restart_wave \| update_wave \| bulk_mod_install \| custom |
| status | text | running \| completed \| completed_with_failures \| cancelled |
| totalCount | int | Total servers (jobs) in batch |
| pendingCount | int | Default 0 |
| runningCount | int | Default 0 |
| successCount | int | Default 0 |
| failedCount | int | Default 0 |
| cancelledCount | int | Default 0 |
| createdById | FK nullable | Who started the batch |
| createdAt | timestamptz | |
| completedAt | timestamptz nullable | Set when status becomes completed/cancelled |

**Indexes:** orgId, (orgId, createdAt DESC), status.

### 2.2 Job (adjustment)

- **batchId** (FK nullable → JobBatch). When set, job is part of that batch.

### 2.3 JobRun

- No change. Status (pending | running | success | failed | cancelled) is the per-server outcome.

---

## 3. API (high level)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/orgs/:orgId/batches | Create batch. Body: type, serverInstanceIds[], payload?. Creates JobBatch + N Jobs + N JobRuns, enqueues. Returns batchId. |
| GET | /api/orgs/:orgId/batches | List batches (org-scoped, recent first). |
| GET | /api/orgs/:orgId/batches/:id | Get batch + aggregated counts + list of jobs (with serverInstanceId, run status, error). |
| POST | /api/orgs/:orgId/batches/:id/cancel | Cancel batch (cancel pending runs, set status cancelled). |
| GET | /api/orgs/:orgId/batches/:id/jobs | List jobs in batch (with latest JobRun status per job). |

---

## 4. UI Data Flow

### 4.1 Start bulk operation

1. User selects **operation** (e.g. “Restart wave”), **servers** (multi-select or filter), optional **payload** (e.g. mod IDs for bulk mod install).
2. Frontend calls **POST .../batches** with type, serverInstanceIds, payload.
3. Backend creates batch and N jobs; returns **batchId**.
4. Frontend navigates to **batch detail** (e.g. `/orgs/:orgId/batches/:batchId`) or opens a progress panel with batchId.

### 4.2 Progress view

1. **Initial load:** GET batch by id → show total, counts (pending, running, success, failed, cancelled), status, list of rows (server name, status, error if failed).
2. **Real-time updates:** Subscribe to WebSocket room `org:{orgId}` (or `batch:{batchId}`). On event **batch.progress** with matching batchId:  
   - Payload: batchId, status, counts (pending, running, success, failed, cancelled), optional updated run (jobId, serverInstanceId, status, error).  
   - UI updates: progress bar or summary (e.g. “12/20 done, 2 failed”), and table row for that server.
3. **Polling fallback:** If no WebSocket, poll GET batch every 2–5 s while status is running.

### 4.3 Partial failure display

- Table: one row per server (server name, status badge, “Error” column with result.errorMessage for failed runs).
- Summary: “18 success, 2 failed, 0 cancelled.” Optional “Copy failed server IDs” or “Retry failed” (creates new batch with only failed serverInstanceIds).

### 4.4 Cancel

1. User clicks “Cancel batch.”
2. Frontend calls **POST .../batches/:id/cancel**.
3. Backend cancels pending runs and sets batch status = cancelled.
4. WebSocket (or next poll) delivers batch.progress with status=cancelled; UI shows “Cancelled” and final counts.

### 4.5 Audit

- **Per server action:** Existing **job_created** audit (jobId, serverInstanceId, type); include batchId in details when present. When a run completes, optional **job_run_completed** (jobId, status, serverInstanceId, batchId).
- **Batch-level:** **batch_created** (batchId, type, serverCount, serverInstanceIds); **batch_cancelled** (batchId, remainingPending).

---

## 5. WebSocket Events

| Event | Direction | Payload (example) |
|-------|-----------|-------------------|
| batch.progress | Server → UI | { batchId, status, pending, running, success, failed, cancelled, updatedRun?: { jobId, serverInstanceId, status, error? } } |

Backend emits **batch.progress** when: a JobRun in the batch completes (update counts and optionally updatedRun), or when batch is cancelled. Room: `org:{orgId}` so all org members see progress; client filters by batchId.

---

## 6. Example: Restart wave

- **Type:** restart_wave (or SERVER_RESTART).
- **Payload:** {} or { reason: "maintenance" }.
- **Create batch:** serverInstanceIds = [id1, id2, …]. For each: Job(type=SERVER_RESTART, serverInstanceId, payload, batchId); JobRun(pending); enqueue.
- **Execution:** Agents pull jobs; each restart runs independently. On each run done: update batch counts; emit batch.progress; if all done, set batch completed/completed_with_failures.
- **Cancel:** Remaining pending restarts are cancelled; running ones complete.

---

## 7. Implementation notes

- **On JobRun completion** (in jobs service or agent result handler): if `job.batchId` is set, load JobBatch; decrement pendingCount or runningCount; increment successCount, failedCount, or cancelledCount per run status; set batch status to completed / completed_with_failures when pendingCount + runningCount = 0; set completedAt; emit **batch.progress** to org room.
- **Cancel:** Find all jobs in batch; for each job get latest JobRun; if status = pending, set JobRun.status = cancelled, remove job from BullMQ if still queued, increment batch cancelledCount and decrement pendingCount; set batch status = cancelled and completedAt.

---

## 8. Summary

- **Batch** = N jobs (one per server) grouped by batchId; same queue and execution as today.
- **Progress** = counts on JobBatch (denormalized) or derived from JobRuns; batch status when no run is pending/running.
- **Partial failure** = per-run status and error in list; batch shows failedCount and list of failed runs.
- **Cancel** = set batch cancelled and cancel all pending JobRuns; remove their jobs from queue.
- **Audit** = batch_created, batch_cancelled; job_created (and optional job_run_completed) per server, with batchId in details.
- **UI** = create batch → show progress (table + counts) → subscribe batch.progress → show failures; cancel button → call cancel API.

### Wiring real-time batch.progress

The control-plane uses an optional **IBatchProgressEmitter** (token `BATCH_PROGRESS_EMITTER`). By default a no-op is provided. To emit to the UI: provide a custom implementation that forwards to your WebSocket gateway (e.g. emit to room `org:{orgId}` with event `batch.progress` and the payload from `BatchesService.emitProgress`). Register it in `BatchesModule` by overriding the `BATCH_PROGRESS_EMITTER` provider.
