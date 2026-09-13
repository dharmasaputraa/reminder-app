# Design Doc: `otorem` — Reminders for Balinese Otonan, Birthdays, & Holidays

Date: 2026-09-12 · Status: awaiting user review · Document language: English

## 1. Summary

A self-hosted app to remind you of **Balinese otonan** (Pawukon birthdays, recurring every 210 days),
**birthdays** (annual), and **anniversaries** (annual), plus **holidays** (Pawukon ones computed locally;
Nyepi/Saka & national holidays via API with caching). Notifications go to **Gotify, Telegram, and Email (SMTP)**
with customizable offsets (default D-7, D-4, D-2, D-1, D). Packaged in **a single Docker container**,
hosted on a local device, exposed via a **cloudflared tunnel**, with auth through **Cloudflare Access**.

Working name: **otorem** (OTOnan REMinder).

## 2. Stack Decisions (final)

| Component | Choice | Rationale |
|---|---|---|
| Backend language | **Go** | User's decision; fast velocity, single binary, low RAM for a home device |
| HTTP framework | **Gin** | User is familiar with it; built on `net/http` → compatible with `go:embed` & standard middleware (Fiber/fasthttp rejected: stdlib deviation, raw speed irrelevant at 1–2 user traffic) |
| Database | **SQLite** via `modernc.org/sqlite` (pure Go, CGO off) | Single node, zero extra services, WAL mode, easy to back up; CGO off → cross-compile & small image |
| Auth | **Cloudflare Access + JWT validation** | User's decision ("so it's not over-engineered"); app without passwords or complex sessions |
| Frontend | **Vite + React + TypeScript + TanStack Router + TanStack Query + Tailwind** | Modern type-safe DX without Next.js/TanStack Start (zero Node runtime in production); static build embedded with `go:embed` |
| Scheduling | In-process ticker (goroutine) | Portable in a container; no dependency on host cron |
| Deploy | Multi-stage Docker + `docker-compose.yml` | As requested; optional `cloudflared`/`gotify`/`litestream` profiles |
| Timezone | Default `Asia/Jakarta`, configurable per instance | Balinese users are generally on WITA — so it **must be configurable**, though the default stays WIB |

## 3. Architecture

Modular monolith, one binary. Date logic is fully separated from I/O so it can be tested in isolation.

```
code/
├── cmd/server/main.go          # wiring: config, db, router, scheduler, notifiers
├── internal/
│   ├── domain/                 # PURE: pawukon, occurrence, pawukon holidays, offsets
│   ├── store/                  # SQLite: embedded migrations, repository per table
│   ├── notify/                 # Notifier interface + gotify.go, telegram.go, smtp.go
│   ├── scheduler/              # ticker, Clock interface, dedupe, catch-up
│   ├── api/                    # Gin handlers, cfaccess middleware, embedded static
│   └── calendarprov/           # HolidayProvider interface + computed/remote impls
├── scripts/fetch_fixtures.go   # kalenderbali.org scraper → testdata/*.csv
├── web/                        # SPA (Vite); build output → internal/api/webroot (embed)
├── deploy/                     # Dockerfile, docker-compose.yml, example config
├── migrations/                 # SQL migrations (embedded via store)
├── testdata/                   # pawukon CSV fixtures (from kalenderbali.org)
└── docs/superpowers/specs/     # this document
```

Reminder data flow: `ticker (every minute) → scheduler computes due reminders (domain, pure) →
compares against notification_log (dedupe) → sends via Notifier (retry) → records status`.

## 4. Data Model (SQLite)

```sql
users            (id, email UNIQUE, name, role CHECK(admin|member), created_at)
                 -- auto-provisioned from Cloudflare Access email claim; ADMIN_EMAILS env → admin
contacts         (id, owner_id→users, name, nickname, notes, created_at)
occasions        (id, contact_id→contacts, type CHECK(birthday|otongan|anniversary),
                  base_date DATE, label TEXT, created_at)
                 -- birthday/otongan: base_date = date of birth; anniversary: arbitrary date
reminder_prefs   (id, contact_id UNIQUE→contacts, offsets JSON, channel_ids JSON,
                  enabled BOOL DEFAULT 1)   -- per-contact override; NULL = use global default
channels         (id, owner_id→users, type CHECK(gotify|telegram|email), name,
                  config_enc BLOB, enabled, created_at)
                 -- JSON config encrypted with AES-256-GCM using APP_SECRET (env)
notification_log (id, occasion_id NULLABLE, holiday_key TEXT NULLABLE,
                  occurrence_date DATE, offset_days INT, channel_id→channels,
                  status CHECK(sent|failed|missed), error TEXT, sent_at)
                 -- UNIQUE(occasion_id, occurrence_date, offset_days, channel_id)
                 -- UNIQUE(holiday_key, occurrence_date, offset_days, channel_id)
                 -- unique constraint = dedupe against double sends
settings         (key PK, value JSON)  -- timezone, send_time, catch_up_hours,
                                       -- default_offsets, registration info, active holiday categories
holiday_cache    (year INT, source TEXT, payload JSON, fetched_at, UNIQUE(year, source))
```

## 5. Domain Engine (pure, no I/O)

### 5.1 Pawukon: Gregorian → (saptawara, pancawara, wuku)

The Pawukon cycle is **210 days with no leap days or adjustments** — pure modulo arithmetic.

```
cycleDay(D) = ((JDN(D) − JDN(ANCHOR) + 73) mod 210) + 1
saptawara[cycleDay] = hariMingguan(D)           # Redite=Sunday … Saniscara=Saturday (free consistency check)
pancawara[cycleDay] = PAWUKON5[(cycleDay−1) mod 5]   # [Paing, Pon, Wage, Kliwon, Umanis], day 1 = Paing
wuku[cycleDay]      = WUKU30[ceil(cycleDay/7)]       # 30 names: Sinta, Landep, …, Watugunung
```

- **Initial anchor**: 2026-06-17 is Galungan = **Buda Kliwon, Wuku Dunggulan** = day 74 of the cycle
  (Dunggulan = days 71–77; day 74 = Buda & Kliwon). This anchor is **locked by tests**, not trusted:
  unit tests verify at least 3 published Galungan dates (23 Apr 2025, 19 Nov 2025, 17 Jun 2026), Kuningan
  (Saniscara Kliwon, Wuku Kuningan, Galungan+10), plus daily fixtures from kalenderbali.org.
  A wrong anchor → red tests → the anchor is fixed in a single constant.
- JDN is computed with the standard algorithm (proleptic Gregorian), timezone-div-free (dates only).
- Internal consistency: the `saptawara` result of the mod-7 must match the Gregorian weekday.
- The 10 Pawukon week systems (urip, dasawara, etc.) are **not implemented in v1** — otonan labels only need
  saptawara+pancawara+wuku. The domain structure is prepared so they can be added later.

### 5.2 Occurrence & reminders

- **otongan**: `otonganKeN(birthDate, N) = birthDate + 210·N`. The next one is the smallest N whose
  date is ≥ today. Label: `"{Saptawara} {Pancawara}, Wuku {Wuku}"` + `"Otonan ke-N"`.
  Consistency: pawukon(birthDate) must equal pawukon(otonan date) (asserted in tests).
- **birthday**: annual; **Feb 29 → Mar 1 in non-leap years** (dateutil convention, documented
  in the UI). Age is computed from the actual date.
- **anniversary**: annual on an arbitrary date, no age.
- **Reminder offsets**: global default `[7, 4, 2, 1, 0]` (days before D; 0 = the day itself), send time
  configurable (default 08:00), **per-contact override** (offsets + channel_ids).
- A due reminder on date `T` = `{occasion, occurrence_date = T + offset}` is sent at
  `send_time` on that date (in the instance timezone). All calculations are timezone-aware via `time.Location`.

### 5.3 Holidays

- **Computed locally (Pawukon)**: a table of `{name, saptawara, pancawara, wuku}` — Galungan
  (Buda/Kliwon/Dunggulan), Kuningan (Saniscara/Kliwon/Kuningan), Saraswati, Pagerwesi, Sugihan Jawa/Bali,
  Banyu Pinaruh, Soma Ribek, Sabuh, Penyepahan, the Tumpek series. Well-established definitions (Galungan,
  Kuningan, Saraswati, Pagerwesi) ship in v1; **the remaining table entries are verified against fixtures before being enabled**
  (definitions vary across popular sources — fixtures are the referee).
- **Via API (HolidayProvider interface)**: `ComputedPawukonProvider` (the table above),
  `RemoteProvider` → `kresnasatya/api-harilibur` (Balinese/Saka holidays) + `dayoffapi.vercel.app`
  (national holidays incl. Nyepi). Daily refresh into `holiday_cache`; **if the API fails → use cache/static data**,
  and the scheduler keeps running. Per-category toggles in Settings. Can be disabled entirely without
  touching the core.

## 6. Data Sources & Scraping Ethics

| Source | Role | Notes |
|---|---|---|
| Wikipedia "Pawukon calendar" | Structure: 30 wuku, urip, cycles | Static, public knowledge |
| kalenderbali.org (`rerainan.php?bulan=X&tahun=Y`, `alaayu.php?...`) | **Test fixtures** (1–2 years of daily data) | Data © I Wayan Nuarsa/Unud — used as personal fixtures with attribution, **not redistributed**; scraped once at dev time, not at runtime |
| Published Galungan/Kuningan dates (23 Apr 2025, 19 Nov 2025, 17 Jun 2026) | Anchor verification | At least 3 independent sources |
| `asnash9306/balinese-calendar-rust`, `ericwidhiantara/balinese_calendar_project` | Algorithm references | Licenses checked before reading code; if unclear, implement from the definition (the algorithm is trivial) |
| kresnasatya/api-harilibur, dayoffapi.vercel.app | Optional runtime (holidays) | Cache + fallback; the app is offline-safe |

**Principle: at runtime, never depend on third-party websites.** Scraping is only for fixtures
and verification. The scheduler makes no outbound requests to calendar sites.

## 7. Scheduler & Delivery Reliability

- A ticker every minute → collect due reminders → send → record. **Stateless scan**, not a materialized
  queue: idempotent, crash/restart tolerant, automatic recovery.
- **Dedupe**: unique constraint in `notification_log`; retries after failure are safe from double sends.
- **Catch-up window** (default 24 hours, configurable): if the device was off at send time, then once it comes
  back, reminders that are late by ≤ window are sent labeled "late by N hours"; anything beyond that is marked
  `missed` (still recorded in the log, without a burst of spam).
- **Per-channel retry**: 3× exponential backoff (e.g. 5s/25s/125s) — the local Gotify may be restarting.
- **Clock interface** (`Now() time.Time`) is injected → fake clock for deterministic tests
  (simulating a device that was off for 30 hours, etc.).
- Parallel sending per channel (small worker pool), per-HTTP-call timeout.

## 8. Notifier

```go
type Notifier interface {
    Name() string
    Send(ctx context.Context, msg Message) error  // title, body, contact meta, priority
    Test(ctx context.Context) error               // "send test" button in the UI
}
```

- **Gotify**: `POST {url}/message?token=…` (title, message, priority).
- **Telegram**: Bot API `sendMessage` (chat_id, text, parse_mode=HTML).
- **Email**: SMTP (host/port/user/pass/from), HTML template + plain-text alternative.
- Message templates per occasion type, e.g.:
  `🎂 {name}'s birthday #{age} is in 3 days (Monday, 15 Sep)` ·
  `🛕 Otonan #12 — Anggara Kliwon, Wuku Sinta — in 2 days`.
- Channel config (tokens/passwords) is **encrypted with AES-256-GCM** using `APP_SECRET` before entering the DB
  (the DB will be backed up; tokens must not be plaintext).

## 9. Auth: Cloudflare Access

- The Access policy protects the tunnel hostname; the browser receives the `CF_Authorization` cookie.
- Every request through the tunnel carries the `Cf-Access-Jwt-Assertion` header (RS256).
- Gin middleware: verify the signature via JWKS at `https://{team}.cloudflareaccess.com/cdn-cgi/access/certs`,
  check `aud` (the Access app's AUD tag) & `exp`; the `email`/`name` claims → auto-provision `users`.
- Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS` (emails on the list → admin role).
- Stateless per request — **no sessions/passwords table**. Direct LAN access without a JWT → 401.
- `AUTH_MODE=dev` (must be explicit): dummy `X-Dev-Email` identity for development without a tunnel;
  the middleware rejects the dev+public combination unless flagged.
- Rate limiting/brute force is not the app's responsibility (Cloudflare layer).

## 10. API (REST, `/api/v1`)

| Endpoint | Function |
|---|---|
| `GET /me` | Identity from the JWT |
| `GET/POST /contacts`, `PATCH/DELETE /contacts/{id}` | Contact CRUD (+ nested occasions) |
| `GET /upcoming?days=30` | Combined timeline of occasions + active holidays |
| `GET/POST/PATCH/DELETE /channels`, `POST /channels/{id}/test` | Manage notification channels + tests |
| `GET/PUT /settings` | Default offsets, send time, tz, catch-up, holiday categories |
| `GET /users` (admin), `POST /scheduler/run` (admin) | Manage users; trigger a manual scan |
| `GET /healthz`, `/readyz` (DB check), `/metrics` (Prometheus) | Observability |

Gin: recovery middleware + request logging (slog JSON) + cfaccess; SPA static files via `NoRoute` + embed.

## 11. Frontend (SPA)

- **Dashboard**: a "next 30 days" timeline — one card per event (birthday/otonan/holiday) with a
  countdown, pawukon badge, and the offsets that will be sent. A "no channel yet" warning when empty.
- **Contacts**: CRUD + occasion editor (pick type, date) + **instant pawukon preview**
  (compute on the client via WASM? No — v1 just needs a `GET /pawukon?date=…` endpoint; WASM is deferred).
- **Channels**: add/edit/test gotify-telegram-email.
- **Settings**: default offsets, send time, timezone, catch-up, holiday category toggles, user list (admin).
- PWA manifest + icons → installable from a phone. Same-origin with the API (served by the Go binary).

## 12. Deployment

- **Multi-stage Dockerfile**: (1) node build of `web/` → (2) `go build` with CGO off → (3) final
  alpine/distroless image ~20MB. Healthcheck `wget /healthz`.
- **docker-compose.yml**:
  - `app`: `/data` volume (SQLite), env `APP_SECRET`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
    `ADMIN_EMAILS`, `TZ`.
  - `cloudflared` (profile): `TUNNEL_TOKEN`, `depends_on: app`, internal network.
  - `gotify` (profile): in case you don't already have your own Gotify.
  - `litestream` (profile): SQLite replication → R2/S3 (family backups must last).
- **README**: Access setup steps (create the Access app → note the team domain + AUD), SMTP relay
  (Gmail app password / transactional — sending email from a home IP is spam-prone), volume backup,
  and how to restore.

## 13. Testing

1. **Unit (table-driven)**: pawukon vs CSV fixtures (scraped from kalenderbali.org), 3 Galungan anchors + Kuningan,
   a 210-day otonan series, Feb 29 birthdays, offset year rollover (D-7 from Jan 1), DST-free tz.
2. **Property**: pawukon(t) == pawukon(t+210) for hundreds of random dates.
3. **Integration**: httptest + in-memory SQLite: auth middleware (valid/expired/wrong-aud/dev JWT),
   CRUD, upcoming, dedupe (send 2× → 1 log entry).
4. **Scheduler**: fake clock — due on time, 30-hour catch-up (→ `missed`), 5-hour (→ send "late").
5. **Notifier**: httptest mocks of Gotify/Telegram; SMTP via a mock server; retry & backoff.
6. **Smoke**: `docker compose up` → healthz, create a contact, trigger a scheduler run, mock notification arrives.

## 14. Out of Scope for v1 (YAGNI)

Contact photo uploads, multi-owner family sharing, full client-side Pawukon conversion of all 10 wewaran (WASM),
dual i18n, a native mobile app, iCal export (easy to add later), multi-instance DB.

## 15. Implementation Milestones

| # | Milestone | Contents |
|---|---|---|
| 0 | Scaffold + spec | `code/` folder, git, module structure, design doc (this document), user review → writing-plans |
| 1 | Domain engine (TDD) | `domain/`: pawukon + fixture tests, otonan/birthday/anniversary, offsets, standard Pawukon holidays, property tests |
| 2 | Store & API | Migrations + repositories, CRUD, cfaccess middleware (+dev), upcoming, healthz/readyz |
| 3 | Scheduler & Notifier | Ticker + Clock, dedupe, catch-up, retry, 3 notifiers, config encryption, test send |
| 4 | Remote HolidayProvider | kresnasatya + dayoffapi, cache, category toggles (can be skipped without touching the core) |
| 5 | SPA | Dashboard, Contacts, Channels, Settings, PWA, embed |
| 6 | Deploy & verification | Dockerfile, compose + profiles, README, green `go test ./...`, smoke test, visual review |

## 16. Open Assumptions (please confirm during review)

1. The `otongan` type in v1 = **a 210-day cycle from the date of birth** labeled saptawara+pancawara+wuku.
2. The Pawukon anchor is locked via published Galungan dates + kalenderbali.org fixtures (5.1).
3. UI language: a natural mix, in Indonesian (holiday & pawukon labels keep Balinese terms).
4. Lightweight multi-user: can all users see all contacts? **Default: per-user (owner), admin sees everything.**
