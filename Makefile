.PHONY: install db-up db-down seed dev build typecheck lint test e2e check docker-up docker-down clean

install:
	pnpm install

db-up:
	./scripts/dev-db.sh start

db-down:
	./scripts/dev-db.sh stop

seed:
	pnpm seed

dev:
	pnpm dev

build:
	pnpm build

typecheck:
	pnpm typecheck

lint:
	pnpm lint

test:
	pnpm test

e2e:
	pnpm test:e2e

check: typecheck lint test

docker-up:
	docker compose up --build

docker-down:
	docker compose down

clean:
	rm -rf packages/*/dist apps/server/dist apps/web/.next apps/web/playwright-report apps/web/test-results
