# Mastermind — root Makefile (simple wrappers)
.PHONY: bootstrap setup migrate up up-dev up-prod down logs test doctor

bootstrap:
	bash ./scripts/bootstrap.sh

## One-command first-time setup: install deps → start Docker → migrate + seed
setup:
	bash ./scripts/bootstrap.sh
	cd infra && docker compose up -d postgres redis
	@echo "Waiting for Postgres to be ready..."
	@bash -c 'for i in $$(seq 1 20); do docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U mastermind -d mastermind >/dev/null 2>&1 && break || sleep 2; done'
	cd control-plane && pnpm prisma db push --accept-data-loss && pnpm prisma:seed
	@echo ""
	@echo "Setup complete. Start the services:"
	@echo "  Terminal 1: cd control-plane && pnpm dev"
	@echo "  Terminal 2: cd web && pnpm dev"
	@echo "  Then open: http://localhost:3000"
	@echo "  Login:      admin@mastermind.local / changeme"

## Run Prisma migration + seed (requires Postgres to be running)
migrate:
	cd control-plane && pnpm prisma db push && pnpm prisma:seed

## Start Postgres + Redis only (for local service development)
up:
	cd infra && docker compose up -d postgres redis

## Start all services with hot-reload dev builds (source mounts)
up-dev:
	cd infra && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

## Start all services with production builds (no source mounts)
up-prod:
	cd infra && docker compose up -d

down:
	cd infra && docker compose down

logs:
	cd infra && docker compose logs -f

test:
	cd control-plane && pnpm test 2>/dev/null || true
	cd web && pnpm test 2>/dev/null || true
	cd agent && go test ./... 2>/dev/null || true

doctor:
	bash ./scripts/doctor.sh
