# Holiday Dedup — Merge Duplicate Holidays Across Sources

Date: 2026-09-15
Status: Approved (design discussion 2026-09-15)

## Problem

The same Balinese holiday appears twice on the calendar (e.g. pawukon
"Saraswati" and saka "Hari Saraswati" on 2026-10-31), because three providers
are merged:

1. `pawukon-computed` (category `pawukon`) — computed locally: Galungan,
   Kuningan, Saraswati, Pagerwesi (`internal/domain/holidays.go`).
2. `harilibur-national` (category `national`) — `is_national_holiday=true`
   items from api-harilibur (`internal/calendarprov/kresnasatya.go`).
3. `harilibur-saka` (category `saka`) — the `false` remainder of the same API.

The live 2026 API payload confirms the collisions (all also computed by the
pawukon engine on the same dates):

| API name              | Date(s)          | Pawukon twin |
|-----------------------|------------------|--------------|
| Hari Saraswati        | 04-04, 10-31     | Saraswati    |
| Hari Raya Galungan    | 06-17            | Galungan     |
| Hari Raya Kuningan    | 06-27            | Kuningan     |

Both holiday consumers are affected:

- `/upcoming` (`internal/api/upcoming.go:117`) and `upcomingnotify`
  (`internal/api/upcomingnotify.go:55`) via `MultiProvider.HolidaysBetween`
  → duplicated calendar entries.
- The scheduler holiday loop (`internal/scheduler/scheduler.go:224`) iterates
  providers individually → **duplicate reminder notifications** per holiday.

## Decisions (user-approved)

- **Pawukon wins.** When the same holiday comes from two sources, the locally
  computed pawukon entry survives: its name is displayed and its category's
  reminder offsets apply. Rationale: locally computed, always available even
  when the third-party API is down. Among remotes, provider order in
  `main.go` (pawukon → national → saka) is the priority.
- **Strip-prefix + exact matching, not fuzzy word containment.** A regex
  removes honorific prefixes and parentheticals, then normalized names must be
  exactly equal. This deliberately does NOT merge distinct neighboring days:
  "Umanis Galungan" and "Penampahan Galungan" stay (they contain the word
  "Galungan" but are different days), as does "Hari Siwa Ratri" etc.

## Design

### 1. Name normalization — `internal/domain/holidays.go`

New `NormalizeHolidayName(name string) string`:

1. Remove parentheticals: `"Hari Nyepi (Tahun Baru Saka)"` → `"Hari Nyepi"`.
2. Remove a leading case-insensitive `Hari Raya` / `Hari` prefix
   (`"Hari Raya Galungan"` → `"Galungan"`).
3. Lowercase and collapse whitespace → `"galungan"`.

Negative cases pinned by tests: `"Umanis Galungan"` → `"umanis galungan"`,
`"Penampahan Galungan"` → `"penampahan galungan"` (never equal to
`"galungan"`).

### 2. Dedup key + helper

- `domain.Holiday.DedupeKey()` = `<date>|<NormalizeHolidayName(Name)>` — one
  definition of "same holiday", used by every consumer.
- `calendarprov.DeduplicateHolidays([]domain.Holiday) []domain.Holiday`:
  first-wins on input order, preserving each survivor's original name,
  category, and order of first occurrence.
- `MultiProvider.HolidaysBetween` (`internal/calendarprov/calendarprov.go`):
  unchanged enabled-category filtering → collect → return
  `DeduplicateHolidays(out)`. Covers `/upcoming`, the calendar UI, and
  `upcomingnotify` with no call-site changes.

### 3. Scheduler — `internal/scheduler/scheduler.go`

Refactor the holiday section (currently `scheduler.go:223-284`) into two
phases:

- **Gather:** iterate enabled providers as today; on provider error skip that
  provider (computed pawukon keeps working — unchanged); stamp each holiday
  with its category and the category's effective offsets; dedup across
  providers with `Holiday.DedupeKey()`, first-wins → the winner's offsets win.
- **Schedule:** the existing per-offset send loop over the deduped list,
  unchanged.

Notification-history safety: `HolidayKey(category, name)` of the winner
(`pawukon:saraswati`) is identical to the keys already in `notification_log`,
so no re-sends; the dropped saka duplicates (`saka:hari-saraswati`) simply
stop being generated.

### 4. Data & error handling

- The 2026 payloads cached in SQLite `holiday_cache` keep the API spellings;
  dedup happens at read time — **no cache migration**.
- Error behavior unchanged: `MultiProvider` still fails fast (→ 502), the
  scheduler still skips failed providers per provider.
- Empty/degenerate names normalize to `""`; the key remains unique per date,
  so nothing is silently merged beyond the intended rule.

### 5. Testing

- `domain`: table test for `NormalizeHolidayName` including the negative cases
  (Umanis/Penampahan never equal to Galungan) and `DedupeKey` shape.
- `calendarprov`: `DeduplicateHolidays` first-wins + order preservation;
  `MultiProvider` integration with two stub providers emitting a same-day
  collision (pawukon name wins) and no collision when categories are toggled
  (pawukon disabled + saka enabled → saka's copy survives).
- `scheduler`: two providers emitting the same (date, normalized name) with
  different offsets → exactly one notification set, using the winner's
  offsets; a failing remote provider still leaves the others intact.
- All existing tests stay green (`go test ./...`).

## Out of scope

- Fuzzy/word-containment matching (rejected: false-positives on
  Penampahan/Umanis).
- Rewriting cached payloads or backfilling normalized names into
  `holiday_cache`.
- Changes to the saka/national split (`is_national_holiday` filtering).
