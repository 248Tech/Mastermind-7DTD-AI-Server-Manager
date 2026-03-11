# Mastermind — AI Build Progress

## Session: 2026-03-10

### Project Status Before This Session
- Control Plane: ~60% — schema complete, pairing/jobs/scheduler/alerts/batches implemented; **missing heartbeat endpoint, job poll endpoint, create-job API, hosts module, auth module**
- Agent (Go): ~80% — pairing, heartbeat, job polling, 7DTD+Minecraft adapters complete; blocked by missing CP endpoints
- Web: ~5% — home page only; all dashboard pages stubbed; no API client, no auth, no components

### MVP Definition (v1)
1. Deploy CP + 1 agent; agent pairs and heartbeats successfully
2. Create a server instance from UI
3. Trigger start/stop/restart job from UI
4. See job status in UI
5. Receive Discord alert on heartbeat failure

---

## Build Plan

### Phase 1 — Control Plane: Critical Missing Endpoints

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Hosts module (service + controller) | `src/hosts/` | ✅ Done |
| 2 | Agent heartbeat endpoint | `src/hosts/agent-hosts.controller.ts` | ✅ Done |
| 3 | JobsQueueService (BullMQ) | `src/jobs/jobs-queue.service.ts` | ✅ Done |
| 4 | Agent job poll endpoint | `src/jobs/agent-jobs.controller.ts` | ✅ Done |
| 5 | Create job endpoint (user-facing) | `src/jobs/jobs.controller.ts` | ✅ Done |
| 6 | Auth module (register/login) | `src/auth/` | ✅ Done |
| 7 | Orgs module (create, list, get) | `src/orgs/` | ✅ Done |
| 8 | WebSocket gateway | `src/websocket/` | ✅ Done |
| 9 | Seed script (game types, default org/user) | `prisma/seed.ts` | ✅ Done |
| 10 | Wire up AppModule | `src/app.module.ts` | ✅ Done |

### Phase 2 — Web Frontend

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 11 | API client lib | `src/lib/api.ts` | ✅ Done |
| 12 | Auth context + localStorage | `src/lib/auth.ts` | ✅ Done |
| 13 | Layout with sidebar + nav | `src/app/layout.tsx` | ✅ Done |
| 14 | Login page | `src/app/(auth)/login/page.tsx` | ✅ Done |
| 15 | Dashboard page | `src/app/(dashboard)/dashboard/page.tsx` | ✅ Done |
| 16 | Hosts page (list + pairing) | `src/app/(dashboard)/hosts/page.tsx` | ✅ Done |
| 17 | Jobs page (list + create) | `src/app/(dashboard)/jobs/page.tsx` | ✅ Done |
| 18 | Schedules page | `src/app/(dashboard)/schedules/page.tsx` | ✅ Done |
| 19 | Alerts page | `src/app/(dashboard)/alerts/page.tsx` | ✅ Done |
| 20 | Settings page | `src/app/(dashboard)/settings/page.tsx` | ✅ Done |

---

## Architecture Decisions

- Auth: JWT for users (JWT_SECRET), separate JWT for agents (JWT_AGENT_SECRET)
- User auth: email + password (bcrypt), no OAuth for MVP
- Org: seeded default org; users register and get assigned to default org
- Job poll: CP queries BullMQ for waiting jobs matching hostId; returns first match; agent marks running, then reports result
- WebSocket: @nestjs/websockets + socket.io; org-scoped rooms
- Web: no external UI lib (minimal deps); plain CSS with inline styles matching existing home page style
- useRealtime: polling-based fallback (no socket.io client added to web pkg for MVP simplicity)

## Files Created

### Control Plane
- `src/hosts/hosts.service.ts`
- `src/hosts/hosts.controller.ts`
- `src/hosts/agent-hosts.controller.ts`
- `src/hosts/hosts.module.ts`
- `src/jobs/jobs-queue.service.ts` (implemented)
- `src/auth/auth.service.ts`
- `src/auth/auth.controller.ts`
- `src/auth/auth.module.ts`
- `src/orgs/orgs.service.ts`
- `src/orgs/orgs.controller.ts`
- `src/orgs/orgs.module.ts`
- `src/websocket/websocket.gateway.ts`
- `src/websocket/websocket.module.ts` (updated)
- `prisma/seed.ts`
- `src/app.module.ts` (updated)
- `src/main.ts` (updated — CORS, validation)
- `src/jobs/agent-jobs.controller.ts` (updated — added poll)
- `src/jobs/jobs.controller.ts` (updated — added create)
- `src/jobs/jobs.service.ts` (updated — createJob method)
- `src/jobs/jobs.module.ts` (updated)
- `src/jobs/dto/create-job.dto.ts` (implemented)

### Web
- `src/lib/api.ts`
- `src/lib/auth.ts`
- `src/app/layout.tsx`
- `src/app/(auth)/login/page.tsx`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/hosts/page.tsx`
- `src/app/(dashboard)/jobs/page.tsx`
- `src/app/(dashboard)/schedules/page.tsx`
- `src/app/(dashboard)/alerts/page.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/hooks/useRealtime.ts` (polling-based)
