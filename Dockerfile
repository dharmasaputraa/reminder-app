# ---- 1: build SPA ----
FROM node:22-alpine AS web
WORKDIR /src/web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

# ---- 2: build binary (embed SPA) ----
# Must be >= the `go` directive in go.mod (1.26), else the build breaks or
# GOTOOLCHAIN silently downloads a second toolchain inside the image build.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN rm -rf internal/api/webroot
COPY --from=web /src/web/dist internal/api/webroot
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/wimember ./cmd/server

# ---- 3: image final ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget
COPY --from=build /out/wimember /usr/local/bin/wimember
ENV ADDR=:8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["wimember"]
