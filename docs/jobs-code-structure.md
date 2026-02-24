# Job System — Code Structure

## Control plane (NestJS)

```
control-plane/src/
├── jobs/
│   ├── jobs.module.ts              # Imports BullModule, QueueModule; registers providers/controllers
│   ├── jobs.service.ts             # createJob(), getNextJobForHost(), reportJobResult(); queue per org
│   ├── jobs.controller.ts          # POST /api/orgs/:orgId/jobs (create); GET /api/orgs/:orgId/jobs (list)
│   ├── jobs-queue.service.ts       # getQueue(orgId), addJob(orgId, data), getNextJobForHost(orgId, hostId)
│   ├── agent-jobs.controller.ts    # GET /api/agent/hosts/:hostId/jobs (poll), POST .../jobs/:jobRunId/result (report)
│   ├── constants.ts                # JOB_TYPES = ['SERVER_START','SERVER_STOP','SERVER_RESTART'], MAX_RETRIES = 2
│   ├── dto/
│   │   ├── create-job.dto.ts       # type, serverInstanceId, payload?; validation (enum type)
│   │   ├── job-response.dto.ts     # id, type, status (derived), createdAt, jobRuns[]
│   │   ├── job-run-response.dto.ts # id, jobId, hostId, status, startedAt, finishedAt, result (durationMs, errorMessage)
│   │   └── report-result.dto.ts    # status (success|failed), durationMs?, errorMessage?, output?
│   └── guards/                     # Reuse JwtAuthGuard (user) and AgentAuthGuard (Bearer agent key) for agent routes
│
├── queue/                          # Optional: shared BullMQ config and queue factory
│   ├── queue.module.ts             # BullModule.forRoot(Redis), register Queue('jobs:{orgId}')
│   └── queue.service.ts            # createOrgQueue(orgId): Queue; used by jobs-queue.service
│
├── websocket/
│   ├── websocket.gateway.ts        # handleConnection (join org room), emit job.created / job_run.started / job_run.done
│   ├── websocket.module.ts
│   └── events.ts                   # JOB_CREATED = 'job.created', JOB_RUN_STARTED = 'job_run.started', JOB_RUN_DONE = 'job_run.done'
│
└── prisma.service.ts               # (existing) Job, JobRun persistence
```

## Responsibilities

| File / layer | Responsibility |
|--------------|-----------------|
| **jobs.service** | Create Job (DB) + JobRun (pending), resolve host from serverInstanceId; call jobs-queue.service to add to `jobs:{orgId}`; audit log; call gateway to emit job.created. getNextJobForHost: check no running JobRun for host, get job from queue, update JobRun to running, return job. reportJobResult: update JobRun (status, finishedAt, result), remove/ack from queue, emit job_run.done. |
| **jobs-queue.service** | BullMQ Queue per org (lazy-create or cache). addJob(orgId, jobData, opts: { attempts: 3, backoff }). getNextJobForHost: fetch waiting jobs for org, filter by data.hostId, return one and move to active (or use BullMQ getJob with custom logic). |
| **jobs.controller** | User-facing: create job (body: type, serverInstanceId), list jobs (org-scoped, with latest JobRun). Guards: JwtAuthGuard, OrgMemberGuard, RequireOrgRoles for create. |
| **agent-jobs.controller** | Agent-facing: poll (GET jobs for host), report result (POST result). Guards: AgentAuthGuard (verify agent JWT, set hostId). |
| **websocket.gateway** | On job created/started/done, emit to room `org:{orgId}` with payload { jobId, jobRunId, status, durationMs?, errorMessage? }. |

## Queue and Redis

- **BullMQ:** Connection from env (REDIS_URL). Queue name pattern `jobs:{orgId}`. Job id can be jobRunId or a BullMQ-generated id; store jobId and jobRunId in job data so agent and backend can correlate.
- **Concurrency:** Enforce “max 1 running per host” in getNextJobForHost (query JobRun where hostId + status=running; if any, return 204 empty). Optionally use BullMQ Worker with concurrency 1 per queue and “agent as worker” pattern via HTTP so no Worker process; only Queue + “get next” API.

## Retries

- When adding job to queue: `opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`. When agent reports failed, BullMQ will retry (re-run job) up to 2 more times. On each run, backend can create a new JobRun or update the same one with attempt index; MVP: single JobRun, store last attempt outcome; on final failure, mark JobRun failed and persist errorMessage in result.

## Agent (Go) — reference only

- **Poll:** GET /api/agent/hosts/:hostId/jobs (long-poll or short poll). Response: { jobId, jobRunId, type, payload } or 204.
- **Report:** POST /api/agent/hosts/:hostId/jobs/:jobRunId/result with body { status, durationMs?, errorMessage?, output? }. Agent gets jobRunId from poll response.

## Summary

- **Queue per org:** `jobs:{orgId}`.
- **Job types:** SERVER_START, SERVER_STOP, SERVER_RESTART.
- **Job + JobRun** stored in DB; status, duration, errorMessage in JobRun (and result JSON).
- **Agent** pulls via GET, reports via POST; concurrency = 1 running per host; retries = 2 (3 attempts total); audit on job creation; WebSocket for UI updates.
