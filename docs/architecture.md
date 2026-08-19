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

## Game live data (2026-08-18)

The Next.js live-map BFF does not open telnet for entity lists. Control plane talks to:

- **Allocs WebAPI (`:8080`)** over the private network: hostiles, animals, player inventory, Players-page roster (`getplayersonline`), allowlisted `visitmap`. Webtoken stays in control-plane env.
- **PrismaCore ClaimCreator (`:11111`)**: map player markers, land claims, vehicles/drones/homes/traders/POIs/reset/adv claims. `apiuser` stays in control-plane env.
- **Telnet `lp`** (agent job `PLAYER_LIST_SYNC`): roster fallback when Allocs `getplayersonline` is unconfigured, unreachable, or unusable.

Public shop status may include `serverReachable` and `playersOnline` (count only). Map JSON and shop JSON must not contain webtokens or apiuser passwords.

