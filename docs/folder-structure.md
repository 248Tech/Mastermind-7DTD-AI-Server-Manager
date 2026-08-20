# Folder Structure

As of 2026-08-18. Older design docs may still mention Tailwind/shadcn; the live web UI uses Next.js App Router and inline styles.

```
Mastermind-7DTD-AI-Server-Manager/
├── control-plane/                 # NestJS API
│   └── src/
│       ├── app.module.ts
│       ├── auth/
│       ├── orgs/
│       ├── hosts/
│       ├── jobs/
│       ├── scheduler/
│       ├── alerts/
│       ├── player-auth/
│       ├── donations/
│       ├── prismacore/
│       ├── allocs/
│       ├── players/
│       ├── logs/
│       ├── health-monitor/
│       ├── websocket/
│       └── prisma.service.ts
├── web/                           # Next.js App Router
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── (auth)/login/
│       │   ├── (dashboard)/       # staff: live-map, players, donator-shop, purchases, …
│       │   ├── player/            # portal: map, profile, shop, cart
│       │   └── api/               # BFFs: live-map, player-map, player-auth, donations
│       ├── components/
│       └── lib/
├── agent/                         # Go host agent
├── discord-bot/
├── infra/
│   ├── docker-compose.yml
│   ├── .env.example
│   └── prismacore/
├── docs/
│   ├── architecture.md
│   ├── allocs.md
│   ├── prismacore.md
│   ├── DIGITALOCEAN_DEPLOYMENT.md
│   └── release-unreleased-2026-08-18-context.md
└── human/user-guide.md
```
