# Real-Time Log Streaming Design (7DTD)

End-to-end design: Agent tails 7DTD server log → streams to Control Plane → Control Plane pushes via WebSocket → UI shows live tail. Includes backpressure, size limits, drop strategy, auth, and org isolation.

---

## 1. End-to-End Flow

```
  ┌─────────────────┐       ┌─────────────────────────────────────────────────────────┐       ┌─────────────┐
  │ 7DTD Server     │       │ Control Plane                                            │       │ Web UI      │
  │ (log file)      │       │                                                            │       │             │
  └────────┬────────┘       │  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │       │  ┌───────┐  │
           │                 │  │ HTTP Ingestion│    │ Log Buffer   │    │ WebSocket  │ │       │  │ Tail  │  │
           │ tail            │  │ (agent push)  │───►│ (per stream) │───►│ Gateway    │─┼──WS───┼─►│ View  │  │
           ▼                 │  └──────▲───────┘    └──────▲───────┘    └─────▲──────┘ │       │  └───────┘  │
  ┌─────────────────┐       │         │                    │                   │        │       │             │
  │ Agent           │───────┼─────────┘ chunked POST      │                   │        │       │  • Auth:    │
  │ • FileStreamer  │       │  POST /api/agent/.../log   │  org + streamId   │        │       │    JWT     │
  │ • Backpressure  │       │  (streamId, chunks)          │  • backpressure   │        │       │  • Room:    │
  └─────────────────┘       │                            │  • max size       │        │       │    org      │
                            │                            │  • drop if no WS  │        │       │  • Subscribe│
                            └────────────────────────────┼───────────────────┘        └───────┴─────────────┘
                                                         │
                            Org isolation: stream key = orgId + serverInstanceId (and optionally hostId)
```

- **Agent** tails the log file (e.g. `output_log_*.txt`), sends chunks to CP over HTTP.
- **Control Plane** accepts chunks, optionally buffers per stream, and forwards to WebSocket clients in the same org.
- **UI** connects with JWT, joins org room, subscribes to a stream (serverInstanceId); receives live chunks and appends to tail view.

---

## 2. Agent-Side Design

### 2.1 Responsibilities

- **Tail source:** Resolve log path from server instance config (e.g. `installPath + /7DaysToDie_Data/output_log_*.txt` or configurable path).
- **Read loop:** Open file, seek to end (tail), read new bytes on timer or fsnotify; split into lines or fixed-size chunks.
- **Chunking:** Send logical chunks (e.g. line-by-line or buffer up to N bytes / M lines) to avoid tiny packets. Recommended: **line-based** with max bytes per line (e.g. 4 KB); truncate or split oversize lines.
- **Upload:** POST chunks to Control Plane (see Message schema below). One long-lived HTTP request (chunked transfer) or repeated POSTs per chunk batch. Prefer **chunked POST** (one connection, many chunks) to reduce latency and connection churn.
- **Backpressure:** 
  - **From CP:** HTTP response may be delayed or return 429 / 503 when CP is overloaded; agent backs off (exponential backoff, then resume). If CP closes the stream, agent reconnects after backoff.
  - **From agent:** If local disk read is faster than network, buffer in memory up to a **max agent buffer size** (e.g. 64 KB); if buffer fills, **drop oldest** lines (ring buffer) and optionally emit a “dropped N lines” marker so UI can show a gap.

### 2.2 Configuration (agent)

- `log_path` or derive from server instance (e.g. from job/config).
- `chunk_max_lines` (e.g. 10) or `chunk_max_bytes` (e.g. 8 KB).
- `max_line_length` (e.g. 4096); truncate with a suffix like `"...[truncated]"`.
- `upload_backpressure_buffer_size` (e.g. 64 KB); when exceeded, drop oldest.
- `reconnect_backoff_sec` (e.g. 2, 4, 8… cap at 60).

### 2.3 Stream lifecycle (agent)

- **Start:** When a “stream log” intent is received (e.g. from a job, or from a long-lived “attach log” subscription from CP). Agent opens log file, seeks to end, starts read loop, and begins POSTing to CP with `stream_id` and `server_instance_id`.
- **Stop:** On context cancel or CP 4xx/close: stop reading, close file, stop POST. Optionally CP sends “stop stream” (e.g. DELETE or a control frame) so agent can stop early when no UI is subscribed.

---

## 3. Backend Gateway Structure

### 3.1 Components

| Component | Role |
|-----------|------|
| **HTTP ingestion** | Accepts POST from agent (auth: agent JWT). Body: stream id, server instance id, sequence, chunks[]. Validates host owns server instance; org from host. |
| **Stream registry** | Maps `streamKey = orgId + ':' + serverInstanceId` (and optionally hostId) to an in-memory or Redis-backed buffer. |
| **Buffer per stream** | Bounded buffer (see Max log size). Incoming chunks are appended; if buffer full, apply drop strategy. Chunks are also forwarded to WebSocket subscribers. |
| **WebSocket gateway** | Authenticates connection (user JWT), resolves org, joins room `org:{orgId}`. Client subscribes to stream via message (e.g. `subscribe_log`, `serverInstanceId`). Gateway only emits log events to clients that subscribed to that stream and belong to the org. |

### 3.2 Authentication and org isolation

- **Agent → HTTP:** `Authorization: Bearer <agent_key>`. Verify agent JWT; extract `orgId` and `hostId`. Ensure the `server_instance_id` in the request belongs to a ServerInstance under that org and (optionally) that host. Reject otherwise.
- **UI → WebSocket:** On connection, require query param or first message with token (e.g. `?token=<user_jwt>`). Verify user JWT; load org membership; join room `org:{orgId}`. All log events for that org are emitted to the room; client filters by `serverInstanceId` or server subscribes only to the stream the user requested (see below).
- **Isolation:** Log data is never sent to a different org. Emit only to the room of the org that owns the server instance.

### 3.3 Subscription model (WebSocket)

- **Option A — Room per org, client filter:** Gateway emits to `org:{orgId}` with payload including `serverInstanceId`. All clients in the org receive all log streams; UI filters by `serverInstanceId` for the current view. Simple; no per-stream rooms.
- **Option B — Room per stream:** Client sends `subscribe_log { serverInstanceId }`. Gateway adds socket to a second room `log:{orgId}:{serverInstanceId}`. Ingestion pushes only to that room. Fewer messages per client; slightly more state (subscription list).

Recommendation: **Option B** for scalability and to avoid sending unrelated logs to clients. Gateway maintains: socketId → subscribed stream keys; on ingest, emit only to sockets subscribed to that stream key.

### 3.4 Backpressure (backend)

- **HTTP from agent:** If buffer for that stream is full, return **503** (or 429) so agent backs off; optionally close the request so agent reconnects later.
- **WebSocket to UI:** If a client’s send buffer is full (slow consumer), either drop the oldest buffered chunks for that client only, or close the client connection (drop strategy below). Do not block the ingestion path for other clients.

### 3.5 Max log size limit

- **Per-stream buffer:** Cap total bytes (or chunk count) per `streamKey`. Example: **512 KB** or **2000 lines**. When full:
  - **Drop strategy:** Drop oldest chunks (FIFO); keep a “gap” marker so UI can show “N lines dropped” if desired.
  - New chunks are still accepted (overwrite oldest).
- No persistent storage of full log in this design; buffer is for real-time tail only. Historical log can be a separate feature (e.g. object storage).

### 3.6 Drop strategy when UI disconnects

- **When no WebSocket subscribers** for a stream:
  - **Option 1 — Stop accepting:** Return 503 to agent so it stops sending until someone subscribes again. Agent retries periodically; when a client subscribes, next agent chunk succeeds and streaming resumes.
  - **Option 2 — Keep buffering, drop agent data:** Continue accepting and keep only the last N bytes in the buffer; when a client subscribes, send the tail of the buffer then live chunks. Prefer **Option 1** to avoid wasting agent and CP resources when nobody is watching; buffer can be small (e.g. last 32 KB) for quick “catch-up” when a client reconnects.
- **When a single client is slow:** For that client only, drop oldest chunks (or close connection with a “slow consumer” code). Do not slow down other clients or the ingestion path.

---

## 4. Message Schema

### 4.1 Agent → Control Plane (HTTP)

**Endpoint:** `POST /api/agent/hosts/:hostId/log-stream`  
**Auth:** Bearer agent key.  
**Body (JSON or NDJSON):**

```json
{
  "streamId": "uuid-or-stable-id",
  "serverInstanceId": "cuid",
  "sequence": 1,
  "chunks": [
    { "ts": "2025-02-23T12:00:00.000Z", "line": "Log line one\n" },
    { "ts": "2025-02-23T12:00:00.100Z", "line": "Log line two\n" }
  ]
}
```

- **streamId:** Idempotency / reconnects; CP can dedupe by (streamId, sequence) if needed.
- **sequence:** Monotonic; used for ordering and gap detection.
- **chunks:** Array of lines (or fixed-size blobs). `ts` = agent clock (optional); `line` = raw line, max length enforced by agent (e.g. 4 KB).

**Alternative (chunked binary):** Stream as NDJSON or length-prefixed frames in a single long-lived POST body for lower overhead.

**Response:**
- **200:** Chunks accepted.
- **503 / 429:** Backpressure; agent should back off and retry.
- **4xx:** Auth or validation error; agent should stop and not retry until config changes.

### 4.2 Control Plane → UI (WebSocket)

**Event name:** `log.chunk` (or `server_log`).

**Payload:**

```json
{
  "serverInstanceId": "cuid",
  "streamId": "uuid",
  "sequence": 1,
  "chunks": [
    { "ts": "2025-02-23T12:00:00.000Z", "line": "Log line one\n" },
    { "ts": "2025-02-23T12:00:00.100Z", "line": "Log line two\n" }
  ]
}
```

**Control / system events (optional):**
- `log.dropped`: `{ serverInstanceId, count, reason: "buffer_full" | "slow_consumer" }` so UI can show “N lines dropped”.
- `log.started` / `log.stopped`: Stream started or stopped for that server instance.

### 4.3 UI → Control Plane (WebSocket)

**Subscribe:**
- Send once after connection: `{ type: "subscribe_log", serverInstanceId: "cuid" }`. Gateway adds client to `log:{orgId}:{serverInstanceId}` (or records subscription and filters on emit).
- **Unsubscribe:** `{ type: "unsubscribe_log", serverInstanceId: "cuid" }`.

**Auth:** Connection established with `?token=<user_jwt>`; gateway validates and joins `org:{orgId}`. Only then accept subscribe; reject subscribe for server instances not in that org.

---

## 5. UI Consumption Pattern

### 5.1 Connection and auth

- Open WebSocket to `wss://cp.example.com/ws?token=<user_jwt>` (or send token in first message). On open, send current org context if needed (or derive from JWT).
- On **401/403**, clear token and redirect to login.

### 5.2 Subscribe to a stream

- When user opens “Live log” for a server instance, send `subscribe_log` with that `serverInstanceId`.
- Store `serverInstanceId` in component state; on subsequent `log.chunk` events, only append if `event.serverInstanceId === subscribedId`.

### 5.3 Rendering and backpressure

- **Append-only tail:** Append each `chunk.line` to a virtualized or plain scroll container. Auto-scroll to bottom only if user is already near bottom (do not steal scroll when user is reading above).
- **Max lines in UI:** Cap displayed lines (e.g. last 1000). When cap exceeded, remove oldest from DOM (or from virtual list data). Prevents memory growth and keeps DOM responsive.
- **Backpressure:** UI cannot backpressure the WebSocket directly; if the server detects a slow consumer it may drop or close. So: keep UI fast (virtualize, cap lines, debounce heavy work). If you receive `log.dropped`, show a banner: “N lines dropped” and optionally a “Load older” if you add history later.

### 5.4 Reconnect and resume

- On **close/error:** Reconnect with exponential backoff (e.g. 1s, 2s, 4s… max 30s). After reconnect, re-send `subscribe_log` for the current `serverInstanceId`. Server may send a small tail from buffer (if you implement Option 2) then live chunks; or only live chunks (Option 1).
- **Stale data:** If reconnection takes long, show “Reconnected; showing live log from now” so user knows they may have missed lines.

### 5.5 Unsubscribe and cleanup

- When user leaves the log view or switches server instance, send `unsubscribe_log` and clear local line buffer for the previous instance to free memory.

---

## 6. Summary Table

| Concern | Agent | Backend | UI |
|---------|--------|---------|-----|
| **Backpressure** | Back off on 503/429; ring buffer drop oldest if local buffer full | 503 when stream buffer full; drop per-client if slow | Cap displayed lines; virtualize; fast render |
| **Max log size** | Max line length; chunk size limits | Per-stream buffer cap (e.g. 512 KB); FIFO drop | Cap lines in view (e.g. 1000) |
| **Drop if UI disconnected** | N/A | Option 1: 503 agent when no subscribers (recommended) | Re-subscribe on reconnect |
| **Auth** | Agent JWT on POST | Agent JWT (HTTP); User JWT (WS); org from both | Send user JWT on WS connect |
| **Org isolation** | Send hostId + serverInstanceId; CP validates | Emit only to org room / stream room for that org | Receive only streams for org (by subscription) |

---

## 7. File / Code Structure (reference)

- **Agent:** `internal/stream/` (tail loop, chunking, max line length), `internal/client/` (StreamLog or StreamLogChunks POST), optional `internal/logstream/` for 7DTD path resolution and upload loop.
- **Control plane:** `websocket/` — gateway (auth, org room, subscribe_log, emit log.chunk); `log-stream/` or `jobs/` — HTTP ingestion endpoint, stream registry, buffer per stream, drop logic.
- **UI:** Hook `useLogStream(serverInstanceId)` — WS connect, subscribe, append chunks to state, cap lines, return { lines, dropped, reconnect }.
