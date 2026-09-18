# E2E Playwright Test Suite — Design

Date: 2026-09-18
Branch: `feature/e2e-playwright`

## Problem

wimember has thorough Go unit/integration tests (34 `*_test.go` files, including
API tests against an in-memory store) but **zero end-to-end coverage**: nothing
drives the real SPA against the real Go server against the real SQLite file.
Regressions in the full loop — UI form → API → encrypted row → scheduler run →
notification send → `notification_log` dedupe — are invisible until production.
No Playwright (or any JS test) infrastructure exists anywhere in the repo.

## Scope (decided)

Full e2e suite: happy paths + edge cases across every user flow, with **direct
SQLite assertions after UI actions** (decided: verify DB state after UI actions,
scheduler + dedupe verification, multi-user owner scoping, and channel-config
encryption checks — all four).

Test target (decided: **built binary**): `make build` output `bin/wimember`
serving the embedded production SPA. The Vite-dev-server variant was declined
as less production-faithful.

Out of scope (deliberate): real Cloudflare Access JWT auth, real
Telegram/SMTP/Gotify externals (no test ever hits the internet), Litestream /
backup-restore flows, PWA install / service-worker behavior, load testing,
WebKit/Firefox engines, catch-up windows beyond the default semantics.

## Approach (decided: per-worker real server + node:sqlite + Gotify stub)

### 1. Harness architecture

**Location & tooling**

- Tests in `web/e2e/` (TypeScript); Playwright (`@playwright/test`) becomes a
  devDependency of the existing `web` pnpm package. Config:
  `web/playwright.config.ts`.
- Chromium only; `trace: 'retain-on-failure'`, HTML reporter.
- New Makefile target `make e2e` = `make build` (SPA → `internal/api/webroot`
  → `bin/wimember`) + `cd web && pnpm exec playwright test`. Build stays
  outside Playwright; a `globalSetup` guard fails fast with a clear message if
  `bin/wimember` is missing.

**Server & isolation — one real server per Playwright worker**

- No global `webServer`. A worker-scoped fixture `app` spawns `bin/wimember`:
  - `ADDR=127.0.0.1:<free port>` (port picked in Node by binding port 0 first)
  - `DATA_DIR=<tmpdir>/wimember-e2e/<pid>-<worker-index>` — each parallel
    worker gets a fresh SQLite file with real migrations applied
  - `AUTH_MODE=dev`, `APP_SECRET=<fixed test secret>`, `ADMIN_EMAILS=admin@local.test`
  - stdout/stderr → per-worker log file, attached to failure artifacts
- Worker-scoped = spawned once per worker process, torn down after; tests
  within one spec file run serially against their worker's app; spec files run
  in parallel across workers.
- `APP_SECRET` fixed per run ⇒ encryption checks are deterministic (we can
  AES-256-GCM-decrypt expected values with the known key).

**Auth seeding (multi-user ready)**

- Helper `userPage(email)` creates a browser context whose
  `addInitScript` pre-seeds `localStorage['wimember-dev-email']` — bypasses the
  `window.prompt`. Three identities: `admin@local.test` (admin),
  `member-a@local.test`, `member-b@local.test`.
- One dedicated test exercises the real `window.prompt` flow via Playwright's
  dialog handler.

**Deterministic time for scheduler tests**

- Sends depend on timezone + `send_time` vs "now". Specs that trigger sends
  first PUT settings with `timezone: "UTC"` and
  `send_time = now(UTC) − 2 minutes` (plus a chosen `catch_up_hours`) so
  occasions dated today are deterministically due — no minute-boundary flakes.
  - "Missed" cases: occurrence older than the catch-up window.
  - "Future/skip" cases: `send_time = now + 30 min`.

### 2. DB verification layer

- Driver: **`node:sqlite`** (built into Node ≥ 22.5; repo runs Node 24 LTS —
  stable, zero native deps). Opens the worker's `wimember.db` (normal open;
  WAL allows concurrent access with the Go server) with a busy timeout.
- Helper module `web/e2e/helpers/db.ts`:
  - `row(table, id)` / `rows(sql, params)` — column assertions after UI actions
  - `notificationLog({occasionId?, status?})` — counts + rows for dedupe /
    catch-up / missed assertions
  - `settingsJson()` — decode the single `settings` JSON blob after saves
  - `channelConfigEnc(id)` → Buffer — encryption check: plaintext token is NOT
    a substring of the stored blob; blob length ≥ plaintext + AES-GCM nonce +
    tag; decrypts with the fixed test `APP_SECRET` to the exact config JSON
  - `count(table, where)` — cascade-delete assertions

### 3. Coverage matrix (8 spec files)

Happy paths (each: UI assertion **and** DB assertion):

| Spec | Happy flows | DB checks |
|---|---|---|
| `contacts.spec.ts` | create (full-page + docked `?c=new` form), edit, delete with confirm dialog, search filter | row created/updated; delete cascades — occasions, `reminder_prefs`, `occasion_prefs` all gone |
| `occasions.spec.ts` | add birthday/anniversary/otonan occasions, custom type free-text, edit, delete, per-occasion prefs (offsets, custom label) | occasions row fields; `occasion_prefs` row with `custom=1`; reset flips `custom=0` and retains the row |
| `channels.spec.ts` | add Gotify/Telegram/Email channel, enable toggle, set Default, delete | channels row + type; enabled flag; `default_channel_ids` in settings JSON |
| `settings.spec.ts` | save timezone / send-time / catch-up / offsets / holiday toggles | settings JSON blob matches saved values exactly |
| `upcoming.spec.ts` | calendar + agenda render seeded occasions, event detail dialog, Remind Now via stub channel, deep-link `/reminder/contacts/<uuid>` | Remind Now leaves `notification_log` empty (unlogged by design) |
| `scheduler.spec.ts` | admin run with a due occasion | `notification_log` row `status=sent` + stub Gotify received the message |
| `auth.spec.ts` | dev-email prompt flow, account menu shows email + role | user auto-provisioned row with correct role |
| `mobile.spec.ts` | iPhone-viewport smoke: contact detail navigates below `lg` instead of docking | — |

Edge cases (mixed into the same files):

- **Validation**: empty contact name rejected; invalid timezone, bad
  `send_time` format, empty recurrence-offset streams rejected by Settings;
  upcoming range validation → 400 (invalid `from`, `to < from`, range > 400
  days — an out-of-range `days` silently clamps to 30, it is not an error).
- **Routing**: bogus UUID deep-link `/reminder/contacts/not-a-uuid` → graceful
  not-found, no crash.
- **Owner scoping (multi-user)**: member A's contact invisible to member B
  (UI list **and** direct API fetch by ID); admin sees all; member →
  `/api/v1/users` 403, admin → 200.
- **Feb 29 birthday**: renders in upcoming; recurrence handled.
- **Otonan**: `base_date` = today − 210 days → otonan lands today in upcoming.
- **Encryption**: after adding a Telegram channel via UI, `config_enc` blob
  contains no plaintext token and decrypts to the exact config JSON.
- **Scheduler family**:
  - run **twice** → 2nd run `sent=0`; still exactly one `notification_log` row
    per occasion/date/offset/channel (partial-unique-index dedupe)
  - two enabled channels → one row **per channel** for the same occurrence
  - dead channel (email → `127.0.0.1:9`, instant refuse) → `failed ≥ 1` and
    **no** log row (failed sends aren't recorded → retryable), plus the
    15-min in-memory backoff means no retry within the test
  - occurrence older than catch-up window → `status=missed` rows
  - `send_time` in the future → nothing sent, no rows
  - holiday categories disabled in these specs ⇒ occasion-only deterministic
    counts
- **Auth**: API 401 without dev email; prompt flow; admin role in account menu.

### 4. Notification stub (the enabler)

- Worker-scoped fixture `gotifyStub`: plain `node:http` server on an ephemeral
  port recording every `POST /message?token=…` (status, body, token). Channel
  configs point `base_url` at it.
- Verifies the full loop: UI create → encrypted row → scheduler run → real
  HTTP send → stub receipt → `notification_log` row → dedupe on re-run.
- Telegram/SMTP cannot be stubbed (fixed external URLs) — used deliberately
  for **failure paths** (test-send 502 toast, `failed` counts). No test ever
  reaches the real internet.
- `seed()` helper does direct-API seeding (authenticated `page.request`) when a
  test needs existing data without walking the UI; UI walks are reserved for
  the flow under test.

### 5. CI integration

- New `e2e` job in `.github/workflows/ci.yml` (after existing lint/test):
  setup Go + pnpm + Node 24, `make build`,
  `pnpm exec playwright install --with-deps chromium`, run, then upload HTML
  report + traces + per-worker server logs on failure. Pure-Go SQLite
  (`modernc.org/sqlite`) ⇒ no system sqlite dependency.

## Testing the tests

- First run must be green on a clean checkout (`make e2e` from scratch).
- Flake check: run the suite 3× consecutively; zero non-deterministic failures
  accepted before merge.
- The suite must fail when it should: spot-verify one assertion per family
  actually catches a regression (e.g. temporarily break dedupe expectations).
