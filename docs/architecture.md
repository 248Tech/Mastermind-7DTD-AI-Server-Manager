# High-Level Architecture

```
                    ┌─────────────────────────────────────────────────────────────────┐
                    │                        CONTROL PLANE                             │
                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
                    │  │ Next.js  │  │ NestJS   │  │ Postgres │  │ Redis + BullMQ   │ │
                    │  │ (Web UI) │◄─┤ API +    │◄─┤ (orgs,   │  │ (queues, sessions│ │
                    │  └────┬─────┘  │ WS GW    │  │ hosts,   │  │  job state)       │ │
                    │       │        └────┬─────┘  │ jobs)    │  └────────┬───────────┘ │
                    │       │             │        └──────────┘           │            │
                    │       │        ┌────┴─────┐  ┌──────────┐  ┌─────────┴──────────┐ │
                    │       │        │ Scheduler│  │ Event/   │  │ Game Adapter       │ │
                    │       │        │ + Jobs   │  │ Alert    │  │ Registry           │ │
                    │       │        └────┬─────┘  │ Engine   │  └────────────────────┘ │
                    │       │             │        └────┬─────┘                         │
                    └───────┼─────────────┼─────────────┼───────────────────────────────┘
                            │             │             │
         HTTPS/WS           │             │             │ (e.g. Discord webhook)
                            ▼             ▼             ▼
    ┌─────────────┐   ┌─────────────────────────────────────┐
    │ Discord Bot │   │           Message Bus / Queues       │
    └──────┬──────┘   │  (commands → agents; events → CP)   │
           │          └──────────────────┬──────────────────┘
           │                             │
           └─────────────────────────────┼─────────────────────────────┐
                                         │                             │
                                         ▼                             ▼
                    ┌────────────────────────────────────────────────────────────┐
                    │                      HOST (edge)                             │
                    │  ┌──────────────────────────────────────────────────────┐  │
                    │  │ AGENT (Go, systemd)                                   │  │  ┌──────────────┐
                    │  │  • Heartbeat 5–10s  • Safety policies  • Log stream   │  │  │ Game Server  │
                    │  │  • Job consumer    • RCON/Telnet/API client          │◄─┼──┤ (7DTD, etc.) │
                    │  └──────────────────────────────────────────────────────┘  │  └──────────────┘
                    └────────────────────────────────────────────────────────────┘
```

## Data Flow (summary)

- **Web/Discord → CP:** REST/WS; auth (JWT + org). Commands become jobs in BullMQ.
- **CP → Agent:** Agent polls or long-polls job queue (by host ID); or CP pushes via side-channel (e.g. Redis pub/sub or dedicated queue per host).
- **Agent → CP:** Heartbeat (host id, status, optional metrics); job result; log chunks (WS or HTTP upload).
- **Agent → Game:** RCON/Telnet/HTTP per game adapter; read-only or controlled commands only.
