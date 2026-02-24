# Folder Structure

```
Mastermind-7DTD-AI-Server-Manager/
├── control-plane/                 # NestJS
│   └── src/
│       ├── app.module.ts
│       ├── auth/
│       ├── orgs/
│       ├── hosts/
│       ├── jobs/
│       ├── scheduler/
│       ├── events/
│       ├── alerts/
│       ├── game-adapters/
│       ├── websocket/
│       ├── discord-bot/
│       └── api/
├── web/                           # Next.js + Tailwind + shadcn
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── (auth)/login/
│       │   └── (dashboard)/
│       │       ├── dashboard/
│       │       ├── hosts/
│       │       ├── jobs/
│       │       ├── schedules/
│       │       ├── alerts/
│       │       └── settings/
│       ├── components/
│       │   └── ui/
│       ├── hooks/
│       └── lib/
├── agent/                         # Go
│   ├── main.go
│   └── internal/
│       ├── client/
│       ├── runner/
│       ├── policy/
│       ├── heartbeat/
│       ├── jobs/
│       ├── games/
│       └── stream/
├── infra/
│   ├── docker-compose.yml
│   └── agent/
│       └── systemd/
├── docs/
│   ├── prd-lite.md
│   ├── architecture.md
│   ├── module-breakdown.md
│   └── folder-structure.md
└── prompts/                       # AI/ops prompts (optional)
```
