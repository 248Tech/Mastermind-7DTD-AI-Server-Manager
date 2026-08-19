# Infra — Local development

## Services

| Service        | Port | Description                    |
|----------------|------|--------------------------------|
| postgres       | 5432 | PostgreSQL 16 (DB: mastermind) |
| redis          | 6379 | Redis 7                        |
| control-plane  | 3001 | NestJS API + WebSocket (profile: full) |
| web            | 3000 | Next.js frontend (profile: full) |

## Commands

```bash
# Start Postgres + Redis only (default; fastest for first run)
make up
# or
cd infra && docker compose up -d

# Start all four (control-plane + web in Docker)
make up-full
# or
cd infra && docker compose --profile full up -d

# Logs
make logs
# or
cd infra && docker compose logs -f

# Stop
make down
# or
cd infra && docker compose down
```

## First run

1. From repo root: `make bootstrap` (installs deps, copies .env files).
2. Initialize control-plane schema with `cd control-plane && pnpm prisma db push` (or let `make up-full` do it automatically in Docker, including seed).
3. `make up-full` to start Postgres, Redis, Control Plane, and Web.

## Hot reload

Control plane and web source are mounted into the containers. Code changes are picked up by the dev server (NestJS/Next.js). Restart containers if you change `package.json` or Dockerfile.

## Without Docker for CP/Web

To run only Postgres and Redis in Docker and run control-plane and web on the host:

```bash
cd infra && docker compose up -d postgres redis
cd ../control-plane && pnpm dev
cd ../web && pnpm dev
```

Use `DATABASE_URL=postgresql://mastermind:changeme@localhost:5432/mastermind` and `REDIS_HOST=localhost` in your local `.env`.

## Game-host APIs (optional)

Control-plane compose can point at Allocs (`SEVENDTD_WEB_URL`, webtoken) and PrismaCore (`PRISMACORE_WEB_URL`, apiuser). See `infra/.env.example`, `docs/allocs.md`, and `docs/prismacore.md`. Leave them blank for an API-less local UI; maps/inventory then fail closed instead of opening telnet from Next.js.

On the dedicated game host, `infra/game-host/restrict-game-api-ports.sh` (unit `mastermind-game-api-firewall.service`) keeps `:8080` and `:11111` on WireGuard, Docker, and loopback only. It does not change the INPUT policy, so game ports stay reachable.

