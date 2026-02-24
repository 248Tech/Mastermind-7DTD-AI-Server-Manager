# Job System Architecture (Redis + BullMQ)

**Code structure:** See [jobs-code-structure.md](./jobs-code-structure.md).

## Overview

- **Queue per org:** One BullMQ queue per org (`jobs:{orgId}`) for isolation and per-org concurrency.
- **Persistent records:** Each enqueued job creates a **Job** (and optionally a **JobRun** when assigned to a host); agent reports completion by updating **JobRun** (status, duration, error).
- **Agent pull:** Agent polls or long-polls an endpoint that returns jobs for its host from the org queue(s) that have work for that host.
- **UI:** WebSocket gateway broadcasts job/job-run lifecycle events so the UI updates in real time.

## Flow

```
  UI / API                    Control Plane                        Agent
     │                              │                                │
     │  POST /jobs (SERVER_START)   │                                │
     │─────────────────────────────►│                                │
     │                              │ 1. Create Job (DB)              │
     │                              │ 2. Resolve host from server    │
     │                              │ 3. Add to queue jobs:{orgId}   │
     │                              │    jobData: { jobId, hostId,   │
     │                              │      serverInstanceId, type,    │
     │                              │      payload }                  │
     │                              │ 4. Create JobRun (pending)     │
     │                              │ 5. Audit log (job_created)      │
     │                              │ 6. WS broadcast (job.created)   │
     │◄─────────────────────────────│                                │
     │                              │                                │
     │                              │     GET /agent/hosts/:id/jobs   │
     │                              │◄────────────────────────────────│
     │                              │ 7. Poll queue for hostId        │
     │                              │    (queue per org; filter by    │
     │                              │     hostId in job data)         │
     │                              │───────────────────────────────►│
     │                              │    return job + jobRunId        │
     │                              │ 8. Move job to "active" (run)   │
     │                              │    Update JobRun status=running │
     │                              │    WS broadcast (job_run.started)│
     │                              │                                │
     │                              │     POST .../jobs/:id/result    │
     │                              │◄────────────────────────────────│
     │                              │ 9. Update JobRun: status,      │
     │                              │    finishedAt, result          │
     │                              │    (duration, errorMessage)     │
     │                              │ 10. Remove from queue / ack     │
     │                              │ 11. WS broadcast (job_run.done) │
     │◄─────────────────────────────│                                │
     │  WS: job_run.done            │                                │
```

## Queue Design

- **Queue name:** `jobs:{orgId}` (e.g. `jobs:org_abc`).
- **Job data (BullMQ job):** `{ jobId, jobRunId, hostId, serverInstanceId, type, payload }`. Worker is “agent pull” — there is no server-side processor; the agent is the consumer. So either:
  - **Option A:** One queue per org; agent polls an API that uses BullMQ’s `getJobFromQueue` / move to “active” by hostId, or
  - **Option B:** One queue per host `jobs:host:{hostId}`; API enqueues to the host queue after resolving host from server instance.
- **MVP recommendation:** Queue per org; API endpoint “get next job for host” uses BullMQ to fetch waiting jobs for that org and return the first that has `hostId` matching the agent. Concurrency: limit active jobs per host (e.g. 1) via a separate “active” set or BullMQ job state.

## Concurrency Control

- **Per host:** Max 1 running job per host at a time. When agent polls, only return a job if that host has no JobRun in status `running`.
- **Per org:** Optional cap (e.g. max N concurrent runs per org) via a counter or BullMQ concurrency in a processor; in “agent pull” model, enforce by not returning a new job to a host that already has a running JobRun.
- **Implementation:** In “get next job for host” logic: (1) Check no JobRun with `hostId` and `status = 'running'`. (2) Get next waiting job from `jobs:{orgId}` whose data.hostId matches. (3) Move to “processing” and create/update JobRun to `running`, then return job to agent.

## Failure and Retries

- **Max 2 retries:** BullMQ job options `attempts: 3` (first try + 2 retries). On each failure agent reports result with `status: 'failed'` and optional `errorMessage`; backend updates JobRun and either retries (re-enqueue same job data) or marks JobRun failed after 3 attempts.
- **Backoff:** `backoff: { type: 'exponential', delay: 2000 }` or fixed delay between retries.
- **Idempotency:** JobRun is created once per “attempt”; or single JobRun with retry count in `result.attempt`. MVP: one JobRun per job; on retry, update same JobRun (e.g. append to result.attempts[]) or create a new JobRun per attempt (schema allows 1:N Job–JobRun). Prefer one JobRun per job and store `result: { attempts: [{ status, error, duration }], finalStatus }` for simplicity.

## Data Model (existing + usage)

- **Job:** id, orgId, serverInstanceId, type (SERVER_START | SERVER_STOP | SERVER_RESTART), payload, createdById, createdAt. Persisted on create.
- **JobRun:** id, jobId, hostId, status (pending | running | success | failed | cancelled), startedAt, finishedAt, result (JSON: durationMs, errorMessage, output), logRef, createdAt. Created when job is assigned to host (or when agent first polls); updated when agent reports completion.
- **Duration:** Computed from startedAt/finishedAt or stored in result.durationMs.
- **Error:** result.errorMessage (or result.error).

## Audit Log

- On **job creation:** `AuditLog`: action `job_created`, resourceType `job`, resourceId `job.id`, details `{ type, serverInstanceId, orgId }`, actorId, ip.

## WebSocket Updates

- **Events to emit (per org or per user):** `job.created`, `job_run.started`, `job_run.progress` (optional), `job_run.completed` / `job_run.failed`. Payload: minimal (jobId, jobRunId, status, duration, error) so UI can refetch or update local state.
- **Room:** Subscribe by org (e.g. `org:{orgId}`) so all members see job updates; optionally filter by serverInstanceId on the client.

## MVP Job Types

| Type            | Description        | Payload (example)     |
|-----------------|--------------------|------------------------|
| SERVER_START    | Start game server  | { serverInstanceId }  |
| SERVER_STOP     | Stop game server   | { serverInstanceId }  |
| SERVER_RESTART  | Restart game server| { serverInstanceId }  |

All require `serverInstanceId`; backend resolves host from ServerInstance and enqueues with that hostId so the correct agent gets the job.
