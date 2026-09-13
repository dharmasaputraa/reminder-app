.PHONY: test web build run docker

test:
	CGO_ENABLED=0 go test ./... -count=1

web:
	cd web && npm ci && npm run build
	rm -rf internal/api/webroot && mkdir -p internal/api/webroot
	cp -R web/dist/. internal/api/webroot/
	touch internal/api/webroot/.gitkeep

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/otorem ./cmd/server

run: build
	APP_SECRET=dev-secret-panjang-16 AUTH_MODE=dev DATA_DIR=./data ./bin/otorem

docker:
	docker compose build
