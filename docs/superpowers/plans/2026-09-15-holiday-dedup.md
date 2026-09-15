# Holiday Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge duplicate holidays across the three providers (pawukon computed, harilibur national, harilibur saka) so the same holiday never appears twice on the calendar and never triggers two reminder notifications.

**Architecture:** One shared identity primitive — `domain.Holiday.DedupeKey()` = date + normalized name (regex strips the "Hari Raya"/"Hari" honorific and parentheticals, then lowercase). `MultiProvider.HolidaysBetween` dedups its merged output first-wins (provider order = priority, pawukon first). The scheduler's holiday loop is refactored into a gather phase (per-provider, error-tolerant, offsets stamped) followed by a dedup + existing send loop, so the winner's category and offsets drive the reminders.

**Tech Stack:** Go stdlib only (`regexp`, `strings`, `testing`). No new dependencies. Spec: `docs/superpowers/specs/2026-09-15-holiday-dedup-design.md`.

## Global Constraints

- Pawukon wins: the locally computed entry survives a collision; its name is displayed and its category's offsets apply (user decision, spec "Decisions").
- Match rule is strip-prefix + exact: "Umanis Galungan" and "Penampahan Galungan" must NEVER merge with "Galungan" (spec "Decisions").
- No cache migration: dedup happens at read time over whatever `holiday_cache` holds (spec §4).
- Error behavior unchanged: `MultiProvider` fails fast on provider error; the scheduler skips a failed provider and keeps the rest (spec §4).
- TDD throughout: each task writes failing tests first, watches them fail, implements, watches them pass.
- Run tests with `go test ./...` from the repo root (`/Users/taksu/Work/code/otorem`). Module name is `wimember`.

## File Structure

- Modify: `internal/domain/holidays.go` — add `NormalizeHolidayName` + `Holiday.DedupeKey` (identity primitive; lives next to the `Holiday` type).
- Modify: `internal/domain/holidays_test.go` — table test for normalization, key-collision test.
- Modify: `internal/calendarprov/calendarprov.go` — add `DeduplicateHolidays`; `MultiProvider.HolidaysBetween` returns deduped output.
- Modify: `internal/calendarprov/calendarprov_test.go` — dedup unit test + MultiProvider cross-source test (reuses existing `stubProvider`).
- Modify: `internal/scheduler/scheduler.go` — holiday section (`// ---- holidays ----` through the end of the providers loop, currently lines 223-284) becomes gather → dedup → send.
- Modify: `internal/scheduler/scheduler_test.go` — existing `stubProvider` gains an optional `cat` field; new `failProvider`; two new tests.

No new files. No frontend changes (the web calendar consumes `/upcoming`, which is fixed server-side).

---

### Task 1: `NormalizeHolidayName` + `Holiday.DedupeKey` in domain

**Files:**
- Modify: `internal/domain/holidays.go`
- Test: `internal/domain/holidays_test.go`

**Interfaces:**
- Consumes: nothing new (existing `Holiday` struct, `Date.String()`).
- Produces: `func NormalizeHolidayName(name string) string` and `func (h Holiday) DedupeKey() string` — Tasks 2 and 3 call exactly these names.

- [ ] **Step 1: Write the failing tests**

Append to `internal/domain/holidays_test.go`:

```go
func TestNormalizeHolidayName(t *testing.T) {
	cases := map[string]string{
		"Saraswati":                      "saraswati",
		"Hari Saraswati":                 "saraswati",
		"Hari Raya Galungan":             "galungan",
		"Galungan":                       "galungan",
		"Hari Raya Nyepi":                "nyepi",
		"Hari Nyepi (Tahun Baru Saka)":   "nyepi",
		"Hari Raya Waisak 2570":          "waisak 2570",
		"Umanis Galungan":                "umanis galungan",
		"Penampahan Galungan":            "penampahan galungan",
		"Hari Proklamasi Kemerdekaan RI": "proklamasi kemerdekaan ri",
		"  Hari   Raya   Kuningan ":      "kuningan",
	}
	for in, want := range cases {
		if got := NormalizeHolidayName(in); got != want {
			t.Errorf("NormalizeHolidayName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHolidayDedupeKey(t *testing.T) {
	pawukon := Holiday{Date: NewDate(2026, 10, 31), Name: "Saraswati"}
	saka := Holiday{Date: NewDate(2026, 10, 31), Name: "Hari Saraswati"}
	if pawukon.DedupeKey() != saka.DedupeKey() {
		t.Errorf("same day + normalized name must share a key: %q vs %q",
			pawukon.DedupeKey(), saka.DedupeKey())
	}
	umanis := Holiday{Date: NewDate(2026, 10, 31), Name: "Umanis Galungan"}
	if pawukon.DedupeKey() == umanis.DedupeKey() {
		t.Error("distinct days (Umanis vs the holiday itself) must not share a key")
	}
	otherDay := Holiday{Date: NewDate(2026, 6, 17), Name: "Hari Raya Galungan"}
	if pawukon.DedupeKey() == otherDay.DedupeKey() {
		t.Error("different dates must not share a key")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/domain/ -run 'TestNormalizeHolidayName|TestHolidayDedupeKey' -v`
Expected: FAIL — `undefined: NormalizeHolidayName` and `h.DedupeKey undefined`.

- [ ] **Step 3: Implement**

In `internal/domain/holidays.go`, extend the import block and add below the `Holiday` type (keep `PawukonHolidaysBetween` and `String()` untouched):

```go
import (
	"fmt"
	"regexp"
	"strings"
)
```

```go
// Name normalization for cross-source dedup (spec 2026-09-15-holiday-dedup):
// the saka API spells Balinese holidays with honorifics — "Hari Raya
// Galungan", "Hari Saraswati", "Hari Nyepi (Tahun Baru Saka)" — while the
// pawukon defs are bare ("Galungan"). Strip parentheticals and the leading
// "Hari Raya"/"Hari" honorific, lowercase, collapse whitespace. Distinct
// neighboring days never collapse: "Umanis Galungan" keeps its prefix.
var (
	holidayParenRe = regexp.MustCompile(`\([^)]*\)`)
	hariRayaRe     = regexp.MustCompile(`(?i)^\s*hari\s+raya\s+`)
	hariRe         = regexp.MustCompile(`(?i)^\s*hari\s+`)
)

// NormalizeHolidayName reduces an Indonesian holiday name to a comparable
// form. Only for matching (dedup keys), never for display.
func NormalizeHolidayName(name string) string {
	s := holidayParenRe.ReplaceAllString(name, " ")
	s = hariRayaRe.ReplaceAllString(s, "")
	s = hariRe.ReplaceAllString(s, "")
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// DedupeKey: cross-source identity of a holiday — date + normalized name.
// "Saraswati" (pawukon) and "Hari Saraswati" (saka) share a key on the same
// date; "Umanis Galungan" never shares with "Galungan".
func (h Holiday) DedupeKey() string {
	return h.Date.String() + "|" + NormalizeHolidayName(h.Name)
}
```

Two separate prefix regexes (not one alternation) so the "Hari Raya" strip cannot degrade into stripping just "Hari" and leaving "Raya" behind.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/domain/ -v`
Expected: all PASS, including the pre-existing pawukon tests.

- [ ] **Step 5: Commit**

```bash
git add internal/domain/holidays.go internal/domain/holidays_test.go
git commit -m "feat(domain): NormalizeHolidayName + Holiday.DedupeKey for cross-source dedup"
```

---

### Task 2: `DeduplicateHolidays` + MultiProvider merge

**Files:**
- Modify: `internal/calendarprov/calendarprov.go`
- Test: `internal/calendarprov/calendarprov_test.go`

**Interfaces:**
- Consumes: `domain.Holiday.DedupeKey()` (Task 1). Existing `stubProvider` in the test file (fields `name, cat string; hs []domain.Holiday`).
- Produces: `func DeduplicateHolidays(hs []domain.Holiday) []domain.Holiday` (first-wins, input unmodified, order of first occurrence preserved). `MultiProvider.HolidaysBetween` signature unchanged — behavior now deduped.

- [ ] **Step 1: Write the failing tests**

Append to `internal/calendarprov/calendarprov_test.go`:

```go
func TestDeduplicateHolidaysFirstWins(t *testing.T) {
	in := []domain.Holiday{
		{Date: domain.NewDate(2026, 10, 31), Name: "Saraswati", Category: "pawukon"},
		{Date: domain.NewDate(2026, 10, 31), Name: "Hari Saraswati", Category: "saka"},
		{Date: domain.NewDate(2026, 12, 25), Name: "Hari Raya Natal", Category: "national"},
	}
	out := DeduplicateHolidays(in)
	if len(out) != 2 {
		t.Fatalf("out = %+v, want 2 survivors", out)
	}
	if out[0].Name != "Saraswati" || out[0].Category != "pawukon" {
		t.Errorf("first occurrence must win: %+v", out[0])
	}
	if out[1].Name != "Hari Raya Natal" {
		t.Errorf("unrelated holiday must survive: %+v", out[1])
	}
	if len(in) != 3 {
		t.Errorf("input must not be modified: %+v", in)
	}
}

func TestMultiProviderDeduplicatesAcrossSources(t *testing.T) {
	m := MultiProvider{Providers: []Provider{
		stubProvider{name: "paw", cat: "pawukon", hs: []domain.Holiday{
			{Date: domain.NewDate(2026, 10, 31), Name: "Saraswati"}}},
		stubProvider{name: "saka", cat: "saka", hs: []domain.Holiday{
			{Date: domain.NewDate(2026, 10, 31), Name: "Hari Saraswati"},
			{Date: domain.NewDate(2026, 1, 17), Name: "Hari Siwa Ratri"}}},
	}}
	hs, err := m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 1, 1), domain.NewDate(2026, 12, 31),
		map[string]bool{"pawukon": true, "saka": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 2 || hs[0].Name != "Saraswati" || hs[0].Category != "pawukon" {
		t.Errorf("pawukon entry must win the merge: %+v", hs)
	}
	if hs[1].Name != "Hari Siwa Ratri" {
		t.Errorf("non-colliding saka holiday must survive: %+v", hs)
	}
	// Settings-aware: pawukon off → saka's copy of the same day survives.
	hs, err = m.HolidaysBetween(context.Background(),
		domain.NewDate(2026, 1, 1), domain.NewDate(2026, 12, 31),
		map[string]bool{"pawukon": false, "saka": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 2 || hs[0].Name != "Hari Saraswati" || hs[0].Category != "saka" {
		t.Errorf("saka copy must survive when pawukon is disabled: %+v", hs)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/calendarprov/ -run 'TestDeduplicateHolidaysFirstWins|TestMultiProviderDeduplicatesAcrossSources' -v`
Expected: FAIL — `undefined: DeduplicateHolidays`; the MultiProvider test fails on `len(hs) != 2` (currently 3).

- [ ] **Step 3: Implement**

In `internal/calendarprov/calendarprov.go`, add after the `computedPawukon` section:

```go
// DeduplicateHolidays merges holidays sharing a DedupeKey (same date, same
// normalized name): the FIRST occurrence wins and keeps its name, category,
// and position; later duplicates are dropped. Callers pass slices in provider
// priority order (pawukon → national → saka), so the locally computed entry
// wins. The input slice is not modified.
func DeduplicateHolidays(hs []domain.Holiday) []domain.Holiday {
	seen := make(map[string]bool, len(hs))
	var out []domain.Holiday
	for _, h := range hs {
		k := h.DedupeKey()
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, h)
	}
	return out
}
```

Update `MultiProvider` — replace its doc comment and the final return of `HolidaysBetween` (loop body unchanged):

```go
// MultiProvider combines providers and filters them by the settings categories.
// Cross-source duplicates (same date, same normalized name — pawukon
// "Saraswati" vs saka "Hari Saraswati") are merged first-wins, so provider
// slice order is the priority: pawukon must come first.
type MultiProvider struct{ Providers []Provider }
```

```go
	return DeduplicateHolidays(out), nil
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/calendarprov/ -v`
Expected: all PASS, including pre-existing `TestMultiProviderFilter` and `TestMultiProviderTagsCategory`.

- [ ] **Step 5: Commit**

```bash
git add internal/calendarprov/calendarprov.go internal/calendarprov/calendarprov_test.go
git commit -m "feat(calendarprov): DeduplicateHolidays — MultiProvider merges cross-source dupes (pawukon wins)"
```

---

### Task 3: Scheduler gather-then-dedup holiday loop

**Files:**
- Modify: `internal/scheduler/scheduler.go` — holiday section (currently lines 223-284)
- Test: `internal/scheduler/scheduler_test.go`

**Interfaces:**
- Consumes: `domain.Holiday.DedupeKey()` (Task 1). Existing test helpers `newHarness`, `snapUTC`, `seed`, `stubProvider`.
- Produces: no signature changes. `Service.RunOnce` behavior: one notification set per (date, normalized name) across ALL enabled providers, using the winner's offsets.

- [ ] **Step 1: Extend the test stubs and write the failing tests**

In `internal/scheduler/scheduler_test.go`, change the existing stub to take an optional category (existing call sites pass no `cat` and keep pawukon behavior):

```go
type stubProvider struct {
	hs  []domain.Holiday
	cat string // optional; "" → pawukon
}

func (s *stubProvider) Name() string { return "stub" }
func (s *stubProvider) Category() string {
	if s.cat == "" {
		return "pawukon"
	}
	return s.cat
}
func (s *stubProvider) HolidaysBetween(_ context.Context, _, _ domain.Date) ([]domain.Holiday, error) {
	return s.hs, nil
}

// failProvider: always errors — models the remote being down.
type failProvider struct{ cat string }

func (f failProvider) Name() string     { return "fail" }
func (f failProvider) Category() string { return f.cat }
func (f failProvider) HolidaysBetween(_ context.Context, _, _ domain.Date) ([]domain.Holiday, error) {
	return nil, errors.New("remote down")
}
```

Add `"errors"` to the import block. Then append the two tests:

```go
// Two providers emitting the same normalized holiday — pawukon "Saraswati"
// vs saka "Hari Saraswati" on 2026-10-31. Dedup keeps the FIRST provider's
// entry: exactly one holiday row, using the WINNER's offsets (pawukon {1}
// → sendAt beyond the 24h catch-up window → recorded "missed"); saka's {0}
// copy must not exist. Offsets {0} for the otonan seed → 1 sent.
func TestHolidayDedupAcrossProviders(t *testing.T) {
	now := time.Date(2026, 10, 31, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.svc.Providers = []calendarprov.Provider{
		&stubProvider{cat: "pawukon", hs: []domain.Holiday{
			{Date: domain.NewDate(2026, 10, 31), Name: "Saraswati"}}},
		&stubProvider{cat: "saka", hs: []domain.Holiday{
			{Date: domain.NewDate(2026, 10, 31), Name: "Hari Saraswati"}}},
	}
	snap := snapUTC()
	snap.DefaultOffsets = []int{0}
	snap.HolidayOffsets = map[string][]int{"pawukon": {1}, "saka": {0}}
	res, err := h.svc.RunOnce(context.Background(), snap)
	if err != nil {
		t.Fatal(err)
	}
	if res.Sent != 1 || res.Missed != 1 {
		t.Fatalf("res = %+v, want Sent 1 (otonan) Missed 1 (pawukon Saraswati D-1)", res)
	}
	res, _ = h.svc.RunOnce(context.Background(), snap)
	if res.Sent != 0 || res.Missed != 0 {
		t.Errorf("second run must be fully deduped: %+v", res)
	}
}

// A failing provider must not take the others down: saka errors → skipped,
// pawukon still delivers (and would still win any dedup against it).
func TestHolidayProviderFailureStillSendsOthers(t *testing.T) {
	now := time.Date(2026, 10, 31, 8, 2, 0, 0, time.UTC)
	h := newHarness(t, now)
	h.svc.Providers = []calendarprov.Provider{
		failProvider{cat: "saka"},
		&stubProvider{cat: "pawukon", hs: []domain.Holiday{
			{Date: domain.NewDate(2026, 10, 31), Name: "Saraswati"}}},
	}
	snap := snapUTC()
	snap.DefaultOffsets = []int{0}
	res, err := h.svc.RunOnce(context.Background(), snap)
	if err != nil {
		t.Fatal(err)
	}
	if res.Sent != 2 || res.Missed != 0 {
		t.Fatalf("res = %+v, want Sent 2 (otonan + pawukon Saraswati), Missed 0", res)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/scheduler/ -run 'TestHolidayDedupAcrossProviders|TestHolidayProviderFailureStillSendsOthers' -v`
Expected: `TestHolidayDedupAcrossProviders` FAILS on the counts (current code sends for BOTH providers → Sent 2 / Missed 0). `TestHolidayProviderFailureStillSendsOthers` PASSES already (per-provider skip exists) — that is fine; it guards the refactor.

- [ ] **Step 3: Refactor the holiday section**

In `internal/scheduler/scheduler.go`, replace the whole holiday block — from the `// ---- holidays ----` comment through the closing brace of the `for _, p := range s.Providers` loop (currently lines 223-284) — with:

```go
	// ---- holidays ----
	// Gather: every enabled provider contributes its holidays stamped with its
	// category and effective offsets. A failing provider is skipped (computed
	// pawukon keeps working). Dedup below keeps the FIRST occurrence, so the
	// provider slice order is the priority: pawukon wins over API sources
	// (spec 2026-09-15-holiday-dedup).
	type holidayWithOffsets struct {
		h    domain.Holiday
		offs []int
	}
	var gathered []holidayWithOffsets
	for _, p := range s.Providers {
		if !snap.HolidayCategories[p.Category()] {
			continue
		}
		// Per-category offsets; a category without its own list falls back to
		// the global default offsets (pre-customization behavior).
		offs := snap.HolidayOffsets[p.Category()]
		if len(offs) == 0 {
			offs = snap.DefaultOffsets
		}
		hs, err := p.HolidaysBetween(ctx, from, horizon)
		if err != nil {
			// remote provider failed → skip; computed pawukon keeps working
			continue
		}
		for _, h := range hs {
			h.Category = p.Category()
			gathered = append(gathered, holidayWithOffsets{h: h, offs: offs})
		}
	}
	// Schedule: the same send loop as before, over the deduped list. The
	// winner's category/offsets drive the reminders; its HolidayKey is
	// identical to the pre-dedup key, so notification_log dedupe never
	// re-sends, and dropped duplicates simply stop being generated.
	seen := map[string]bool{}
	for _, g := range gathered {
		dk := g.h.DedupeKey()
		if seen[dk] {
			continue
		}
		seen[dk] = true
		h := g.h
		hkey := HolidayKey(h.Category, h)
		for _, off := range g.offs {
			rDate := h.Date.AddDays(-off)
			sendAt := time.Date(rDate.Year, time.Month(rDate.Month), rDate.Day, sendHH, sendMM, 0, 0, loc)
			if sendAt.After(now) {
				continue
			}
			entry := store.NotificationEntry{HolidayKey: &hkey,
				OccurrenceDate: h.Date, OffsetDays: off}
			if sendAt.Before(dueStart) {
				// holiday → all channels of ALL users (broadcast)
				users, err := s.St.ListUsers(ctx)
				if err != nil {
					continue
				}
				for _, u := range users {
					chs, _ := s.St.ListChannels(ctx, u.ID)
					for _, ch := range chs {
						if ch.Enabled {
							entry.ChannelID, entry.Status = ch.ID, "missed"
							s.record(ctx, entry, &res, "holiday")
						}
					}
				}
				continue
			}
			late := now.Sub(sendAt) > time.Hour
			msg := notify.HolidayMessage(h, h.Date.JDN()-today.JDN(), late)
			users, err := s.St.ListUsers(ctx)
			if err != nil {
				continue
			}
			for _, u := range users {
				chs, _ := s.St.ListChannels(ctx, u.ID)
				var enabled []store.Channel
				for _, ch := range chs {
					if ch.Enabled {
						enabled = append(enabled, ch)
					}
				}
				s.deliver(ctx, enabled, entry, msg, &res, "holiday")
			}
		}
	}
```

The send-loop body is byte-for-byte the old body with `h`/`offs` now coming from `g`; nothing about send timing, `late`, broadcast, or result accounting changes.

- [ ] **Step 4: Run the scheduler tests, then the whole suite**

Run: `go test ./internal/scheduler/ -v`
Expected: all PASS, including pre-existing `TestHolidayReminder`, `TestRunOnceOnTime`, `TestRunOnceCatchUpLate`.

Run: `go test ./...`
Expected: all packages PASS (confirms `/upcoming` and calendarprov behavior is intact).

- [ ] **Step 5: Commit**

```bash
git add internal/scheduler/scheduler.go internal/scheduler/scheduler_test.go
git commit -m "feat(scheduler): gather-then-dedup holiday loop — no duplicate reminders across providers"
```

---

## Verification (after all tasks)

- [ ] `go test ./...` green.
- [ ] `go vet ./...` clean.
- [ ] Spot-check the real fix end-to-end (optional but recommended): run the server, open the calendar on 2026-10-31 — only "Saraswati" (pawukon) shows, no "Hari Saraswati".
