# Design Doc: UUIDv7 IDs, Recurrence Engine, & Per-Occasion Reminders

Date: 2026-09-16
Status: approved

## Goals

1. All primary keys become UUIDv7 (TEXT) instead of integer autoincrement.
2. Occasions gain a user-chosen recurrence: `once | yearly | monthly | anniversary | otonan`.
3. Anniversaries notify every month on the same day-of-month, forever, plus the yearly
   anniversary with day-offset reminders; the counter is month-aware ("1 year 2 months").
4. Occasion `type` becomes a free-form string (no DB enum) so users can create custom
   categories, typed free-text with suggestions from previously used types.
5. Reminders are customizable per occasion (offsets, channels, enabled), layered over
   contact-level defaults and settings-level per-recurrence defaults.

Decisions from brainstorming:

- Monthly anniversary notifications run forever (not just year 1), but each occasion can
  be disabled individually.
- Recurrence is chosen by the user per occasion (built-in types default sensibly).
- Offset sets are separate per recurrence kind (monthly marks default `[0]`; yearly marks
  include the 1-month-before reminder: `[30,7,4,2,1,0]`).
- Migration: fresh start — the user backs up and deletes the SQLite file; base migrations
  are rewritten.

## 1. Data model

Fresh schema. New `001_init.sql` replaces the old `001_init.sql` + `002_rename_otongan_type.sql`
(the rename is irrelevant on a fresh database). Every former `INTEGER PRIMARY KEY AUTOINCREMENT`
becomes `TEXT PRIMARY KEY` holding a UUIDv7 (`github.com/google/uuid.NewV7()`, already in go.mod).

```sql
CREATE TABLE occasions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                -- free string, no CHECK: built-ins or custom categories
  recurrence TEXT NOT NULL CHECK (recurrence IN ('once','yearly','monthly','anniversary','otonan')),
  base_date TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_occasions_contact ON occasions(contact_id);

CREATE TABLE occasion_prefs (
  occasion_id TEXT PRIMARY KEY REFERENCES occasions(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,             -- JSON partial map {"yearly":[..],"monthly":[..],..}; {} = inherit all
  channel_ids TEXT NOT NULL,         -- JSON array of channel UUIDs; [] = inherit
  enabled INTEGER NOT NULL DEFAULT 1
);
```

All other tables keep their current shape with `TEXT` UUID keys: `users`, `contacts`,
`reminder_prefs` (its `offsets` column now holds the same JSON partial map),
`channels`, `notification_log`, `settings`, `holiday_cache`. The two partial unique
dedupe indexes on `notification_log` are unchanged — the `(occasion_id, occurrence_date,
offset_days, channel_id)` key is what merges the monthly and yearly stream on the
anniversary date.

Settings gains one key:

- `recurrence_offsets` — JSON map, seeded complete:
  `{"event":[30,7,4,2,1,0], "yearly":[30,7,4,2,1,0], "monthly":[0], "otonan":[7,4,2,1,0]}`.
- `default_offsets` keeps its current role (holiday-category fallback) and stays as the
  package-level last-resort fallback.

Recurrence defaults per type: `birthday`→`yearly`, `otonan`→`otonan`,
`anniversary`→`anniversary`; unknown/custom types default to `yearly` (the UI always
sends an explicit choice). The old one-occasion-per-type restriction is dropped — the UI
no longer disables already-used types; `label` disambiguates multiples.

## 2. Recurrence engine (internal/domain)

Two distinct vocabularies:

- **Recurrence** (what the user picks per occasion): `once | yearly | monthly |
  anniversary | otonan`.
- **Stream** (which offset set applies to one occurrence): `event | yearly | monthly |
  otonan`. `Occurrence` gains a `Stream` field. `event` is the base date itself (k=0) or
  a one-time occasion — it always uses the full D-30…D-0 ramp; `yearly`/`monthly`/
  `otonan` are the recurring marks.

`type` stays `domain.OccurrenceType` (a string alias — no Go-side enum enforcement;
built-in constants remain for defaults; new values only need non-empty, reasonable
length). `OccurrencesBetween(base, recurrence, from, to)` behavior:

- `once` — the base date itself if `from ≤ base ≤ to`; stream `event`. No count.
- `yearly` — existing logic unchanged (Feb 29 → Mar 1 in non-leap years); the base
  event (#0) is stream `event`, later anniversaries stream `yearly` — so a future
  base date still gets D-30…D-0 reminders.
- `monthly` — mark *k* = whole months after base, computed by new `AddMonths(base, k)`
  with day clamping (31st → Feb 28/29 as needed). k=0 is the base event (stream
  `event`, no count); k≥1 marks are stream `monthly` with month-aware counts.
- `anniversary` — union of the monthly marks and the yearly marks: every 12th monthly
  mark coincides with the yearly date and is instead tagged stream `yearly` with label
  "N years" (vs "N months" for the monthly marks). On that date both streams would emit
  an offset-0 entry; the notification_log unique key dedupes them into one push.
- `otonan` — unchanged 210-day pawukon cycle; stream `otonan`.

Month-aware numbering: `MonthsLabel(m)` → `"5 months"` for m < 12, `"1 year 2 months"`
for m ≥ 12 (years only when m is a multiple of 12). Notification copy: birthday unchanged;
`🎊 {name} — anniversary 1 year 2 months, in 3 days` (monthly), `🎊 {name} — anniversary
2 years, in 3 days` (yearly); custom types substitute their type string for "anniversary";
`once` shows just the date. Labels for calendar/upcoming use the same formatting.

## 3. Reminders & scheduler

Offset resolution per stream, first hit wins:

```
occasion_prefs.offsets[stream] → reminder_prefs.offsets[stream]
  → settings.recurrence_offsets[stream] → domain.DefaultOffsets
```

Channels: `occasion_prefs.channel_ids` (non-empty) → contact `reminder_prefs.channel_ids`
→ system defaults (existing `targetChannels` cascade). Skipping: `occasion_prefs.enabled
== 0` excludes that occasion entirely; contact-level `enabled == 0` still gates all of a
contact's occasions. The per-occasion scan window is derived from the max offset across
its resolved streams (monthly `[0]` doesn't widen it; yearly `30` does). Catch-up, "late"
labeling, pre-send dedupe, and per-channel failure backoff are unchanged — in particular,
a monthly mark missed by more than the catch-up window is marked `missed` exactly like
any other reminder (no special monthly grace).

## 4. API

- Path IDs are UUID strings; `uuid.Parse` failure → 404 (matches the existing
  not-found routing).
- `POST /contacts/{id}/occasions` accepts `{type, date, recurrence?, label?}` —
  recurrence defaults per §1 when omitted; custom types allowed; optional `label`.
- New `GET/PUT/DELETE /occasions/{id}/prefs` — owner-scoped sparse override. `PUT` is a
  full replace of the override row (payload: `offsets` map, `channel_ids` array,
  `enabled` bool — absent keys are not a thing at this endpoint); `{}` / `[]` values
  mean inherit for that field. `DELETE` removes the row = full inherit.
- New `GET /occasions/types` — distinct `type` strings across the caller's contacts
  (suggestions for the free-text combobox).
- `PUT /contacts/{id}/prefs` and `GET/PUT /settings` switch `offsets` to the map form.
- Upcoming/calendar payloads gain `recurrence` and stream-aware `number`/labels; monthly
  marks appear as their own items (≈12 + 1 per anniversary per 400-day window).
- Owner scoping switches from `Sprintf`-formatted integer comparisons (`ownerFilter`)
  to bound TEXT parameters — required by UUID keys and removes the latent injection
  pattern.

## 5. Frontend

- Occasion add form: type combobox (three built-ins + free text; suggestions from
  `GET /occasions/types`), recurrence select (auto-set from built-in type, editable for
  custom types), optional label. The "only one of each type" restriction and its warning
  are removed.
- Occasion rows: type + recurrence badges; per-occasion reminder editor — enabled switch,
  offsets editor per emitted stream (a `once` occasion shows the `event` list; `yearly`
  shows `event` + `yearly`; `monthly` shows `event` + `monthly`; `anniversary` shows
  `event` + `yearly` + `monthly`; `otonan` shows `otonan`), channel multiselect,
  "reset to inherit".
- Contact reminder section: offsets editor becomes the map form — the "yearly/event"
  list writes both the `event` and `yearly` keys, plus a `monthly` list — channels,
  enabled; the contact-level default layer.
- All API client IDs become strings; agenda/day-events/event-detail render the new
  month-aware labels and recurrence badges.

## 6. Reset & rollout

- Rewrite `internal/store/migrations/001_init.sql` with the new schema; delete
  `002_rename_otongan_type.sql`.
- Breaking change: existing databases must be deleted (user has a backup). README gets a
  one-line upgrade note ("v0.x: delete data/wimember.db").
- `devseed.go` generates UUIDv7 identifiers.

## 7. Testing

- domain: `AddMonths` (clamping, year rollover, k=0), each recurrence's
  `OccurrencesBetween` boundaries, Feb 29, stream tagging (k=0 → `event`, anniversary
  12th mark → `yearly`), `MonthsLabel` formatting.
- scheduler: offset precedence chain (all four layers), occasion-disabled skip,
  per-occasion channel override, monthly+yearly same-date dedupe merge, window sizing.
- store: `occasion_prefs` CRUD + JSON map round-trip; contact prefs map form.
- api: UUID path parsing (invalid → 404), occasion payload validation, prefs endpoints,
  types suggestions endpoint.
- Existing tests are ported to UUID fixtures.

## Non-goals

- No managed category list / settings page for custom types (free text + suggestions).
- No RRULE-style arbitrary recurrence patterns.
- No data migration from integer IDs (fresh start).
