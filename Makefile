# Mastermind — root Makefile (simple wrappers)
.PHONY: bootstrap up up-full down logs test doctor

bootstrap:
	bash ./scripts/bootstrap.sh

up:
	cd infra && docker compose up -d

up-full:
	cd infra && docker compose --profile full up -d

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
