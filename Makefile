.PHONY: check-storage test typecheck docker-storage-guard

check-storage:
	node scripts/check-storage-profile.mjs

test:
	node --test tests/**/*.test.mjs

typecheck:
	corepack pnpm install --frozen-lockfile=false
	corepack pnpm typecheck

docker-storage-guard:
	docker compose up --build storage-guard
