# Holiday Reminders — Fix Dead Providers + Default Reminders UI

Date: 2026-09-14
Status: Approved (design discussion 2026-09-14)

## Problem

Three related issues, verified against the running system:

1. **Both remote holiday providers are dead.**
   - `dayoffapi.vercel.app` returns HTTP 402 "DEPLOYMENT_DISABLED".
   - `artworks.kresna.me/api-harilibur` returns 404 — the project moved to
     `api-harilibur.pages.dev` / `api-harilibur.netlify.app` / `api-harilibur.vercel.app`
     (vercel.app mirror is also 402; pages.dev and netlify.app verified working).
   - Consequence: `holiday_cache` is empty (0 rows), so national and saka holidays
     never appear on the calendar and never get reminders scheduled.
2. **`/upcoming` omits `reminders` for holiday items** (`internal/api/upcoming.go`,
   the holiday loop builds `UpcomingItem` without the `Reminders` field). The UI
   detail therefore shows "—" for every holiday, including pawukon (which does
   appear). The scheduler resolves holiday offsets correctly
   (per-category → default fallback); the API layer just drops that information.
3. **No "Default ({default})" reminders display.** The user wants Google-Calendar-style
   "Default (D-7, D-3, D-1)" in the event detail surfaces (mobile detail dialog and
   the lg agenda right-side detail panel — both render `EventDetailRows` from
   `web/src/components/event-detail.tsx`).

Holiday storage flow (question from the user, answered): remote fetch success →
the full-year payload is upserted into SQLite `holiday_cache` per `(year, source)`
with a 24 h freshness TTL and a 10 min failure backoff
(`internal/calendarprov/cached.go`, `internal/store/holidaycache.go`). Pawukon is
computed locally per scan and never stored. Holidays are not event rows; send
dedupe lives in `notification_log`. The flow already persists to DB in one fetch
per year — the data source was dead, not the flow.

## Goals

- National and saka holidays flow again (calendar + scheduled reminders).
- Holiday detail shows the effective reminders instead of "—".
- Reminders that inherit the global defaults render as `Default (D-7, D-3, D-1)`
  in both detail surfaces; custom offsets render as `D-N` badges.

## Non-goals

- No change to scheduler send logic or dedupe.
- No new holiday data sources beyond replacing the dead ones.
- No reminder editing from the detail surfaces.
- Dashboard list (`reminder.index.tsx`) keeps plain `D-N` badges (now populated
  for holidays too); no "Default" label there — dense list, out of scope.

## Design

### 1. Provider layer (Bug A)

**Single source, two categories.** api-harilibur returns both national holidays
(`is_national_holiday: true`) and Bali/regional ones (`false`) — verified in the
live response.

- `internal/calendarprov/kresnasatya.go`:
  - Default `BaseURL` → `https://api-harilibur.pages.dev`.
  - Add `FallbackBaseURL` → `https://api-harilibur.netlify.app`. A failed fetch
    (network error or non-200) is retried once against the fallback before the
    provider reports failure.
  - Parse the existing-but-ignored `is_national_holiday` JSON field.
  - Keep the response shape handling (bare array or `{"data": [...]}`).
- Provider construction (`cmd/server/main.go`):
  - Remove `DayOffAPI` and delete `internal/calendarprov/dayoffapi.go` (plus its
    tests). The upstream deployment is dead for everyone; keeping it is noise.
  - Two Kresna instances from the same source:
    - category `national`, name `harilibur-national`, filter `is_national_holiday == true`;
    - category `saka`, name `harilibur-saka`, filter `is_national_holiday == false`.
    Filter mode is a constructor option (e.g. `NewKresnaFiltered(baseURL, fallback,
    nationalOnly bool)`); the existing `NewKresna` keeps working for tests/simple use.
  - Each instance is wrapped in `CachedRemote` as today, so the two caches are
    independent entries (`harilibur-national` / `harilibur-saka`) — one HTTP fetch
    per day per category, no shared-fetch optimization (YAGNI).
- **Category tagging:** `domain.Holiday` gains a `Category string` field.
  `MultiProvider.HolidaysBetween` sets `h.Category = p.Category()` when appending.
  Providers that already know their category do not need to set it themselves.
  Existing cached payloads unmarshal fine (new field defaults to "" and is
  re-tagged on the way out; caches are empty anyway today).

**Holiday naming:** api-harilibur names are plain ("Hari Raya Natal",
"Hari Saraswati"); the old dayoff prefix "National Holiday — " disappears.
`notify.HolidayMessage` uses `h.Name` as-is, so messages stay natural. Pawukon
names are unchanged.

### 2. `/upcoming` reminders resolution (Bug B)

`internal/api/upcoming.go`:

- Occasions: `reminders_default = !(`cw.Prefs != nil && cw.Prefs.Enabled &&
  len(cw.Prefs.Offsets) > 0)` — i.e. true when the shown offsets came from the
  global default fallback.
- Holidays: `offs := settings.HolidayOffsets[h.Category]`;
  `reminders_default = len(offs) == 0`; if default, `offs = settings.DefaultOffsets`.
  Set `Reminders: offs` and `RemindersDefault: reminders_default` on the item.
- `UpcomingItem` JSON gains `reminders_default bool` with `omitempty` — the field
  is present only when true; clients treat a missing field as `false`.

Scheduler unchanged: it already resolves the same way, so the UI now shows
exactly what the scheduler will send.

### 3. Frontend display (Bug C)

`web/src/lib/api.ts`: `UpcomingItem` + `reminders_default?: boolean`.

`web/src/components/event-detail.tsx` — `EventDetailRows`, "Reminders" row:

- `item.reminders_default === true` → render `Default (D-7, D-3, D-1)`:
  the word "Default" in `font-medium` plus the resolved offsets in parentheses,
  `text-muted-foreground`, offsets sorted descending, joined with `", "`,
  each formatted `D-{n}`. If the resolved list is empty → render "—" as today.
- Otherwise (custom contact prefs or per-category holiday offsets) → existing
  `D-N` secondary badges.
- Both surfaces (below-lg `EventDetailDialog` via `EventDetailBody`, and the lg
  `AgendaPanel` detail layer via `EventDetailRows`) pick this up automatically —
  they share the component.

### 4. Error handling

- `CachedRemote` degrade behavior unchanged: stale cache served on refresh
  failure; empty set (never 5xx) when there is no cache; 10 min backoff per year.
- New: the provider-level domain fallback (pages.dev → netlify.app) runs before
  a fetch is reported as failed, so a single dead mirror does not blank the
  category for a day.

## Testing

- `calendarprov` unit tests (httptest):
  - flag filtering → national vs saka split from one fixture payload;
  - fallback: primary 500 → netlify-style fallback serves; both fail → error;
  - `MultiProvider` sets `Category` on returned holidays.
- `api` test: `/upcoming` holiday items carry `reminders` = per-category offsets
  when set, `DefaultOffsets` when not, and correct `reminders_default`; occasion
  items with/without prefs set the flag correctly.
- Update/remove `dayoffapi` tests; keep scheduler tests passing (provider
  interface unchanged; fix any fixtures referencing the old provider names).
- Frontend: no test harness in the repo — verify via `pnpm lint`, `tsc -b`, and
  manual check of both detail surfaces with a default-offsets item and a
  per-category-overridden item.
