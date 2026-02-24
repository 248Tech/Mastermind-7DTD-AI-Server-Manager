# Scheduled Jobs — Design

Cron schedules stored in DB, BullMQ delayed jobs, execution window, retry policy, telemetry.

---

## Schema (Schedule)

| Field | Type | Description |
|-------|------|-------------|
| id | cuid | PK |
| orgId | FK | Tenant |
| serverInstanceId | FK | Linked server (required) |
| name, description | text | Label and optional description |
| cronExpression | text | 5-field cron (e.g. "0 2 * * *") |
| jobType, payload | text, jsonb | Job type and payload for created jobs |
| enabled | boolean | If false, schedule is not enqueued |
| executionWindowStart, End | text | Optional "HH:mm" – only run within this time of day |
| retryPolicy | jsonb | { maxRetries?, backoffMs?, backoffType? } applied to the created org job |
| lastRunAt, nextRunAt | timestamptz | Telemetry |
| lastRunStatus | text | success \| failed \| skipped \| scheduler_failed |
| lastRunJobId | text | Job id last created by this schedule |
| runCount, failureCount | int | Counters |
| createdById, createdAt, updatedAt | | |

---

## Execution Flow

1. **Bootstrap:** SchedulerService loads all `enabled` schedules, computes `nextRunAt` (cron + execution window), adds a **BullMQ delayed job** to queue `scheduler` with `delay = nextRunAt - now`, and persists `nextRunAt` on the schedule.
2. **When delay expires:** Worker for queue `scheduler` runs. Job data: `{ scheduleId }`.
3. **Process:** Load schedule and server instance (and host). Create **Job** and **JobRun** (pending) in DB. Add a job to queue `jobs:{orgId}` with job data (jobId, jobRunId, hostId, type, payload) and **retry options** from schedule.retryPolicy (attempts, backoff). Update schedule: **lastRunAt**, **lastRunStatus = success**, **lastRunJobId**, **runCount++**, **nextRunAt** = next cron time (clamped to window). Enqueue the **next** delayed job on `scheduler` for that nextRunAt.
4. **Failure (scheduler):** If creating Job, JobRun, or adding to org queue throws: update schedule **failureCount++**, **lastRunStatus = scheduler_failed**, still compute nextRunAt and enqueue next delayed job so the schedule keeps running.
5. **Worker failed event:** If the Worker job fails (unhandled error), handleWorkerFailure updates **lastRunStatus**, **failureCount**; the next run is already scheduled from the previous successful fire or from hydrate.

---

## Failure Handling

| Scenario | Action |
|----------|--------|
| Cron parse error | computeNextRun returns null; no delayed job added for that schedule (hydrate skips). |
| Execution window | nextRun clamped to next time inside [start, end]; if no valid time, skip (MVP: clampToExecutionWindow advances to next day window start). |
| Create Job/JobRun or add to org queue fails | Catch in processScheduleFire; set lastRunStatus = scheduler_failed, failureCount++; schedule next run. |
| Worker process throws | BullMQ marks job failed; handleWorkerFailure updates schedule failureCount and lastRunStatus. |
| Org job fails (agent reports failed) | Retries come from schedule.retryPolicy (maxRetries, backoff). Optional: add scheduleId to Job and on reportJobResult update schedule.lastRunStatus from result (e.g. failed after retries). |

---

## Telemetry Fields

- **lastRunAt** – When the scheduler last fired (created a job).
- **nextRunAt** – When the next delayed job is set to run (updated after each fire).
- **lastRunStatus** – success (enqueued) \| scheduler_failed \| failed (optional, if we update from job result).
- **lastRunJobId** – Id of the Job row created.
- **runCount** – Incremented on each successful fire.
- **failureCount** – Incremented when scheduler fails or worker fails.

---

## Safe Execution Window

- Stored as **executionWindowStart**, **executionWindowEnd** (e.g. "02:00", "06:00").
- After computing next run from cron, **clampToExecutionWindow** ensures the run time falls within that time-of-day range; otherwise advances to the next window start (e.g. next day).

---

## Retry Policy

- Stored on Schedule as **retryPolicy**: `{ maxRetries?: number, backoffMs?: number, backoffType?: 'fixed' | 'exponential' }`.
- When adding the created job to `jobs:{orgId}`, BullMQ options **attempts** = maxRetries + 1 and **backoff** are set so the agent-side job run is retried according to the schedule.
