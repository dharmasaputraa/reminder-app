# wiminder

**wiminder** is a self-hosted reminder service for Balinese otonan based on the 210-day Pawukon cycle, birthdays, anniversaries, and holidays — computed automatically and delivered via Gotify, Telegram, or email. Everything runs from a single container: the SPA is embedded in the Go binary, the SQLite database lives on a volume, and access is secured through Cloudflare Access with no additional password.

## Features

- **Otonan & pawukon** — the 210-day otonan cycle is computed from the date of birth; labels include saptawara, pancawara, and wuku.
- **Other event types** — birthdays (including Feb 29), anniversaries, and standard Pawukon holidays (Galungan, Kuningan, Saraswati, Pagerwesi).
- **National & Saka holidays** — categories can be toggled; remote data is cached in SQLite.
- **Customizable offsets** — defaults are D-7, D-4, D-2, D-1, D+0; each contact can have its own offsets.
- **Deduplication** — a unique constraint in the notification log guarantees each reminder is sent once per event/date/offset/channel.
- **Catch-up** — reminders missed while the container was down are still sent (default window: 24 hours) and labeled "late".
- **Multi-channel** — Gotify (self-hosted), Telegram, and SMTP/email; channel configs are encrypted with AES-256-GCM using `APP_SECRET`.
- **Test send** — a per-channel test button on the Channels page.
- **PWA** — manifest + service worker, installable from a phone.
- **Cross-year calendar** — ±1 year navigation arrows in the calendar; data is fetched per year (`/upcoming?from=&to=`, max 400 days) and the surrounding ±1 year is prefetched.
- **Observability** — `/healthz`, `/readyz`, and `/metrics` (Prometheus).
- **Send time & timezone** — defaults to 08:00 and `Asia/Makassar` (WITA), configurable in the Settings UI (e.g. `Asia/Jakarta` for WIB).

## Quickstart

You need Docker (+ Compose) **or** Podman (+ podman-compose), and a domain pointed at Cloudflare (for the tunnel).

```bash
git clone <your-repo> wiminder && cd wiminder
cp .env.example .env   # set APP_SECRET, CF_ACCESS_*, ADMIN_EMAILS
podman-compose up -d                 # app only; no profile needed if cloudflared already runs on the host
# (Docker users: docker compose up -d --build; need an in-container tunnel: add --profile cloudflared)
```

The application only listens on the internal compose network; public access goes through the Cloudflare tunnel. Open `https://wiminder.your-domain.com`.

Compose profiles (all optional, `app` is always included):

| Profile | Contents | Command |
|---|---|---|
| `cloudflared` | in-container tunnel (requires `TUNNEL_TOKEN`) — **skip if cloudflared already runs on the host** | `docker compose --profile cloudflared up -d` |
| `gotify` | self-hosted Gotify (`http://gotify:80`) | `docker compose --profile gotify up -d` |
| `litestream` | SQLite replication to S3/R2 | `docker compose --profile litestream up -d` |

Profiles can be combined, e.g. `docker compose --profile cloudflared --profile gotify --profile litestream up -d`.

**Cloudflared on the host (common setup):** the app publishes port `APP_PORT` (default `8080`) to the host — point your cloudflared tunnel at `http://localhost:8080` (adjust `APP_PORT` in `.env` if the port is taken). Authentication still comes from **Cloudflare Access** on the Cloudflare side (team domain + email policy), not from the container.

> **v0.x breaking change:** IDs are now UUIDv7 and occasions gained recurrence — delete your old `data/wimember.db` (schema is incompatible); take a backup first if needed.

### Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_SECRET` | yes | — | AES-256-GCM key for channel configs, at least 16 characters |
| `AUTH_MODE` | yes | `cfaccess` | `cfaccess` (production) or `dev` (no tunnel) |
| `CF_ACCESS_TEAM_DOMAIN` | cfaccess mode | — | `your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | cfaccess mode | — | Application Audience tag from Access |
| `ADMIN_EMAILS` | recommended | — | Admin emails, comma-separated; admins can see all contacts and run the scheduler manually |
| `TZ` | no | `Asia/Makassar` | Container process timezone (logs). **The schedule timezone and reminder send time are configured in the Settings UI** (default `Asia/Makassar`; change to `Asia/Jakarta` for WIB) |
| `DATA_DIR` | no | `/data` (image) | SQLite file location |
| `ADDR` | no | `:8080` | Listen address |
| `TUNNEL_TOKEN` | cloudflared profile | — | Cloudflare tunnel token |

## Cloudflare Access setup

1. Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Domain: `wiminder.your-domain.com` (the subdomain used by the tunnel).
3. Add a policy: Action **Allow**, Include **Emails** → your email (and family members').
4. Note the two values from the Access application:
   - **Team domain**: `your-team.cloudflareaccess.com` → `CF_ACCESS_TEAM_DOMAIN`
   - **Application Audience (AUD) tag** → `CF_ACCESS_AUD`
5. Create the tunnel: Zero Trust → **Networks** → **Tunnels** → **Create a tunnel** (Cloudflared) → copy **TUNNEL_TOKEN** into `.env`.
6. Add a **Public hostname** to the tunnel: `wiminder.your-domain.com` → Service `http://app:8080`.
7. Fill in `.env` (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`) and run `docker compose --profile cloudflared up -d`.

The application validates the Cloudflare Access JWT (JWKS is cached); the email from the JWT claim is used to auto-provision users, and emails listed in `ADMIN_EMAILS` are granted the admin role.

## Dev mode (no tunnel)

To try it locally without Cloudflare Access:

```bash
AUTH_MODE=dev make run
```

Open `http://localhost:8080`; when prompted, enter any email (e.g. `admin@local.test`). Technically, dev mode reads the `X-Dev-Email` header — handy for curl:

```bash
curl -H 'X-Dev-Email: admin@local.test' http://localhost:8080/api/v1/upcoming
```

Do not use `AUTH_MODE=dev` on a publicly exposed instance.

## Notifications

Channels are managed from the **Channels** page in the UI (configs are stored encrypted). Each channel can be tested with the **Test send** button.

- **Gotify** — create an application in the Gotify UI → copy the **token**. Fill in the Base URL (`http://gotify:80` when using the `gotify` profile, or your own Gotify URL) and the token. Priority is optional (default 5).
- **Telegram** — chat with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the bot token. Send a message to the bot, then get the `chat_id` from `https://api.telegram.org/bot<TOKEN>/getUpdates` (or via @userinfobot). Fill in the bot token + chat_id.
- **Email (SMTP)** — a Gmail app password is recommended (`smtp.gmail.com:587`, user = Gmail address, password = 16-character app password), or a transactional SMTP relay. Fill in host, port, username, password, from, and the recipient list. Note: sending email directly from a home IP (port 25) almost always lands in spam or gets blocked — always use a relay.

## Backup & restore

The main data is a single file: `./data/wimember.db` (SQLite in WAL mode). While the container is running, copy the `./data` volume consistently, or use Litestream for continuous replication.

**Litestream (optional, recommended):**

1. Fill in `deploy/litestream.yml` (DB path + S3/R2 bucket URL).
2. Fill in credentials in `.env`: `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, and `LITESTREAM_ENDPOINT` (for R2; can be left empty for S3). The `litestream` container reads `.env` via `env_file`.
3. Run `docker compose --profile litestream up -d`.

**Restore:**

```bash
docker compose stop app
docker compose --profile litestream run --rm litestream \
  restore -o /data/wimember.db s3://your-bucket/wiminder/wimember.db
docker compose start app
```

For a one-off restore without filling in `.env`, pass the credentials directly to `docker compose run`, e.g. `docker compose --profile litestream run --rm -e LITESTREAM_ACCESS_KEY_ID=… -e LITESTREAM_SECRET_ACCESS_KEY=… litestream restore -o /data/wimember.db s3://your-bucket/wiminder/wimember.db`.

Alternative without Litestream: stop the app, copy `wimember.db` back, start the app.

## Development

```bash
make test    # CGO_ENABLED=0 go test ./... -count=1
make dev     # backend with hot reload (air): rebuild + restart on .go changes
make web     # pnpm install --frozen-lockfile + build SPA → internal/api/webroot (embed)
make build   # build SPA + binary to bin/wiminder
make run     # build + run dev mode on :8080 (without hot reload)
make e2e     # build + run the Playwright e2e suite (web/e2e, chromium)
make container  # docker compose build, podman-compose fallback (Makefile)
```

The e2e suite spawns a real `bin/wiminder` per worker (`AUTH_MODE=dev`, fresh SQLite under a temp `DATA_DIR`) and asserts against the database file directly. First run needs `cd web && pnpm exec playwright install chromium`; debug a failure with `E2E_KEEP_DATA=1 make e2e` (keeps the temp dir + server log) and `cd web && pnpm run test:e2e:report`.

Full-stack dev flow (two terminals): `make dev` for the backend (air, ~1s auto-rebuild) and `cd web && pnpm run dev` for the frontend (Vite HMR, proxying `/api` to `:8080`). Air is pinned via the `tool` directive in go.mod — no manual install needed, just `go tool air`. Configuration lives in `.air.toml` (only non-test `.go` files trigger a rebuild; the SPA still goes through Vite).

**Landing page (`site/`)** — the public marketing page deployed to GitHub Pages at `https://dharmasaputraa.github.io/wiminder/`. Standalone Vite + React + Tailwind package with its own lockfile (not a workspace with `web/`, and not embedded in the binary):

```bash
cd site
pnpm install
pnpm dev       # dev server at http://localhost:5173/wiminder/ (HMR)
pnpm lint      # oxlint
pnpm build     # tsc --noEmit + vite build → site/dist
pnpm preview   # serve site/dist at http://localhost:4173/wiminder/
```

Deploy is automatic via `.github/workflows/pages.yml` on pushes that touch `site/**`. One-time repo setup: Settings → Pages → Source: **GitHub Actions**.

Pawukon fixtures are scraped once at dev time (not at runtime) with a separate module:

```bash
cd scripts/fetch_fixtures && go run . -year 2026 -out ../../testdata
```

Fixture data © [kalenderbali.org](https://kalenderbali.org) (I Wayan Nuarsa, Universitas Udayana) — used as personal test fixtures with attribution; **do not redistribute**. wiminder at runtime never depends on third-party sites.

**Remote holiday provider note:** the `dayoffapi` and `kresnasatya` providers use cache-first with a 10-minute negative cache — if the remote service is down, wiminder stops trying temporarily and uses the existing cache. Local Pawukon/otonan calculation keeps working in full; only national holidays are temporarily empty.

## Container verification

**Verified with Podman 6.0.2 + podman-compose 1.6.0** on the developer's machine: `podman build -t wiminder:latest .` succeeds (39.7 MB image), smoke containers pass (healthz, SPA, deep-link, scheduler-run). Podman note: HEALTHCHECK is ignored with the OCI format — add `--format docker` to `podman build` if you want the healthcheck. The following steps remain relevant for Docker users:

The current development environment has no Docker, so the following steps must be run manually on a machine that does:

```bash
cp .env.example .env   # set at least APP_SECRET
docker compose config                        # validate compose, no errors
docker compose build app                     # image builds
docker run --rm -d --name wiminder-smoke -p 8081:8080 \
  -e APP_SECRET=dev-secret-long-16 -e AUTH_MODE=dev -e ADMIN_EMAILS=a@b.c wiminder-app:latest
sleep 2
curl -s localhost:8081/healthz               # expect: {"ok":true}
curl -s localhost:8081/ | head -c 120        # expect: SPA HTML (<!doctype html> / <div id="root">)
curl -s -o /dev/null -w '%{http_code}\n' localhost:8081/contacts/1   # expect: 200 (SPA deep-link)
curl -s -H 'X-Dev-Email: a@b.c' -X POST localhost:8081/api/v1/scheduler/run   # expect: {"sent":...,"failed":...,"missed":...}
docker rm -f wiminder-smoke
```

Note: `ADMIN_EMAILS` must be included because `/scheduler/run` is admin-only. The image name produced by `docker compose build app` follows the project directory name (e.g. `wiminder-app` if the repo is in a folder named `wiminder`); if it differs, adjust the tag or build with `docker build -t wiminder-app .`.

Verification without Docker is still possible via `make test` + `make build` + `make run` (see §Development).

## CI/CD & Deployment (Dokploy)

Images are **built in GitHub Actions and pushed to GHCR** — Dokploy only pulls pre-built images, so versioning happens via image tags (no build load on the server).

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | `go test` + `go vet`, web lint + typecheck/build, full Docker image build (no push) |
| `release.yml` | push tag `v*` (or manual) | `go test`, multi-arch image → `ghcr.io/dharmasaputraa/wiminder`, redeploy via Dokploy API |

### Release flow

```bash
git tag v1.2.3 && git push origin v1.2.3
```

Pushes image tags `1.2.3`, `1.2`, `1`, `latest`, `sha-<sha>` to GHCR (linux/amd64 + linux/arm64), then triggers Dokploy to redeploy.

### One-time Dokploy setup

1. **Registry**: in Dokploy add a registry (GHCR) — username `dharmasaputraa`, password = GitHub PAT with `read:packages`.
2. **Application**: Source Type **Docker**, image `ghcr.io/dharmasaputraa/wiminder:latest`.
3. **Volumes**: mount a volume at `/data` (SQLite lives there — without it, data is lost on redeploy).
4. **Environment**: `APP_SECRET` (≥16 chars), `AUTH_MODE=cfaccess`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`, `TZ`.
5. **Health check**: path `/healthz`, port 8080.
6. **API**: create an API key (Dokploy → Profile → API Keys), copy the application ID from the app's URL.
7. **GitHub secrets** (repo → Settings → Secrets → Actions): `DOKPLOY_URL` (e.g. `https://panel.example.com`), `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`. Without them, `release.yml` still builds and pushes images — it only skips the auto-redeploy step.

### Rollback

Point the application's image tag at an older version (e.g. `ghcr.io/dharmasaputraa/wiminder:1.2.2`) in Dokploy → Deploy. Every release stays pullable from GHCR.

> Full step-by-step setup walkthrough (registry, app, volumes, Cloudflare Access, CI wiring, backup, troubleshooting): **[docs/dokploy-setup.md](docs/dokploy-setup.md)**.

## Project structure

```
code/
├── cmd/server/main.go          # wiring: config, db, router, scheduler, notifiers
├── internal/
│   ├── domain/                 # PURE: pawukon, occurrence, pawukon holidays, offsets
│   ├── store/                  # SQLite: embedded migrations, repository per table
│   ├── notify/                 # Notifier + gotify.go, telegram.go, smtp.go
│   ├── scheduler/              # ticker, Clock, dedupe, catch-up
│   ├── api/                    # Gin handlers, cfaccess middleware, embedded static
│   └── calendarprov/           # HolidayProvider + computed/remote impls
├── scripts/fetch_fixtures/     # kalenderbali.org scraper → testdata/*.csv (separate module)
├── web/                        # Vite + React SPA; build output → internal/api/webroot (embed)
├── site/                       # Vite + React landing page → GitHub Pages (separate from web/)
├── deploy/                     # litestream.yml, example deploy config
├── testdata/                   # pawukon CSV fixtures (kalenderbali.org, do not redistribute)
├── Dockerfile                  # multi-stage: node build → go build → alpine (verified with podman)
├── docker-compose.yml          # app + cloudflared/gotify/litestream profiles
└── docs/superpowers/specs/     # design documents
```
