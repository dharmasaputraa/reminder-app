# ---- 1: build SPA ----
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2: build binary (embed SPA) ----
FROM golang:1.25-alpine AS build
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
