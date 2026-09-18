.PHONY: test lint web build run dev container

test:
	CGO_ENABLED=0 go test ./... -count=1

lint:
	go tool staticcheck ./...

web:
	cd web && pnpm install --frozen-lockfile && pnpm run build
	rm -rf internal/api/webroot && mkdir -p internal/api/webroot
	cp -R web/dist/. internal/api/webroot/
	touch internal/api/webroot/.gitkeep

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/wimember ./cmd/server

run: build
	APP_SECRET=dev-secret-long-enough-16 AUTH_MODE=dev DATA_DIR=./data ./bin/wimember

# Hot reload: rebuild + restart automatically when .go files change (SPA via npm run dev)
dev:
	APP_SECRET=dev-secret-long-enough-16 AUTH_MODE=dev DATA_DIR=./data go tool air

container:
	docker compose build || podman-compose build
