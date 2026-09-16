# UUIDv7 + Recurrence Engine + Per-Occasion Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All IDs become TEXT UUIDv7; occasions gain user-chosen recurrence (`once|yearly|monthly|anniversary|otonan`) with month-aware counting; reminders become customizable per occasion (offsets per stream, channels, enabled) layered over contact defaults and per-recurrence settings.

**Architecture:** Bottom-up: pure domain engine first (recurrence vocabulary, month arithmetic, stream-tagged occurrences), then the SQLite schema flip to UUIDv7 with string-ID stores, then scheduler/API/notify consumers, frontend last. Spec: `docs/superpowers/specs/2026-09-16-uuidv7-recurrence-per-occasion-reminders-design.md`.

**Tech Stack:** Go 1.26, gin v1.12, modernc.org/sqlite (pure Go), `github.com/google/uuid` v1.6 (`uuid.NewV7()` — already in go.mod as indirect, becomes direct), React + TanStack Router/Query + shadcn (pnpm).

## Global Constraints

- **Breaking DB reset is intended**: base migrations are rewritten; there is no data migration. README gets a one-line note (Task 11).
- All PKs/FKs are `TEXT` UUIDv7 produced only by `uuid.NewV7().String()` (lowercase, hyphenated).
- Recurrence kinds (user-facing, stored in `occasions.recurrence`): `once`, `yearly`, `monthly`, `anniversary`, `otonan`.
- Streams (offset-set selectors, never stored in occasions): `event`, `yearly`, `monthly`, `otonan`.
- Settings default `recurrence_offsets`: `{"event":[30,7,4,2,1,0], "yearly":[30,7,4,2,1,0], "monthly":[0], "otonan":[7,4,2,1,0]}`.
- Offset validation stays `domain.ValidateOffsets` (0..60, no duplicates) for every list.
- Offset resolution per stream, first non-empty hit: `occasion_prefs.offsets[stream]` → `reminder_prefs.offsets[stream]` → `settings.recurrence_offsets[stream]` → `domain.DefaultOffsets`.
- Channels resolution: `occasion_prefs.channel_ids` (non-empty) → contact `reminder_prefs.channel_ids` → system defaults (`targetChannels` cascade).
- `occasion_prefs.enabled == false` skips one occasion; contact `reminder_prefs.enabled == false` skips the contact (unchanged).
- Catch-up / late / dedupe / backoff semantics are unchanged; a monthly mark missed beyond the catch-up window is `missed` like anything else.
- API path IDs: `uuid.Parse` failure → 404.
- Occasion `type` is a free string: non-empty, ≤ 64 chars, no fixed set. Built-in defaults: birthday→`yearly`, otonan→`otonan`, anniversary→`anniversary`, anything else→`yearly`.
- Every Go task gate: `CGO_ENABLED=0 go test ./... -count=1` (except Task 3's scoped gate, see there).
- Commit after every step that passes its verification.

---

### Task 1: Domain — recurrence vocabulary, streams, month helpers

**Files:**
- Create: `internal/domain/recurrence.go`
- Test: `internal/domain/recurrence_test.go`

**Interfaces:**
- Produces: `type Recurrence string` with `RecurOnce, RecurYearly, RecurMonthly, RecurAnniversary, RecurOtonan Recurrence`; `type Stream string` with `StreamEvent, StreamYearly, StreamMonthly, StreamOtonan Stream`; `type OffsetMap map[Stream][]int`; `ValidateRecurrence(Recurrence) error`; `DefaultRecurrence(OccurrenceType) Recurrence`; `StreamsFor(Recurrence) []Stream`; `ValidateOffsetMap(OffsetMap) error`; `ResolveOffsets(stream Stream, layers ...OffsetMap) []int`; `AddMonths(base Date, k int) Date`; `MonthsLabel(m int) string`.

- [ ] **Step 1: Write the failing tests**

```go
package domain

import "testing"

func TestValidateRecurrence(t *testing.T) {
	for _, r := range []Recurrence{RecurOnce, RecurYearly, RecurMonthly, RecurAnniversary, RecurOtonan} {
		if err := ValidateRecurrence(r); err != nil {
			t.Errorf("%q: unexpected error %v", r, err)
		}
	}
	if err := ValidateRecurrence("weekly"); err == nil {
		t.Error("weekly: want error")
	}
}

func TestDefaultRecurrence(t *testing.T) {
	cases := map[OccurrenceType]Recurrence{
		Birthday: RecurYearly, Otonan: RecurOtonan, Anniversary: RecurAnniversary,
		"wedding": RecurYearly, "": RecurYearly,
	}
	for typ, want := range cases {
		if got := DefaultRecurrence(typ); got != want {
			t.Errorf("%q: got %q want %q", typ, got, want)
		}
	}
}

func TestStreamsFor(t *testing.T) {
	cases := map[Recurrence][]Stream{
		RecurOnce:        {StreamEvent},
		RecurYearly:      {StreamEvent, StreamYearly},
		RecurMonthly:     {StreamEvent, StreamMonthly},
		RecurAnniversary: {StreamEvent, StreamYearly, StreamMonthly},
		RecurOtonan:      {StreamOtonan},
	}
	for rec, want := range cases {
		got := StreamsFor(rec)
		if len(got) != len(want) {
			t.Fatalf("%q: got %v want %v", rec, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%q: got %v want %v", rec, got, want)
			}
		}
	}
}

func TestAddMonths(t *testing.T) {
	cases := []struct {
		base Date
		k    int
		want Date
	}{
		{NewDate(2025, 6, 16), 0, NewDate(2025, 6, 16)},
		{NewDate(2025, 6, 16), 1, NewDate(2025, 7, 16)},
		{NewDate(2025, 6, 16), 7, NewDate(2026, 1, 16)},  // year rollover
		{NewDate(2025, 1, 31), 1, NewDate(2025, 2, 28)},  // clamp non-leap
		{NewDate(2024, 1, 31), 1, NewDate(2024, 2, 29)},  // clamp leap
		{NewDate(2025, 1, 31), 13, NewDate(2026, 2, 28)}, // clamp + rollover
		{NewDate(2025, 3, 31), 1, NewDate(2025, 4, 30)},  // clamp 30-day month
	}
	for _, c := range cases {
		if got := AddMonths(c.base, c.k); got != c.want {
			t.Errorf("AddMonths(%s, %d) = %s, want %s", c.base, c.k, got, c.want)
		}
	}
}

func TestMonthsLabel(t *testing.T) {
	cases := map[int]string{
		0: "0 months", 1: "1 month", 5: "5 months",
		12: "1 year", 13: "1 year 1 month", 14: "1 year 2 months", 24: "2 years",
		26: "2 years 2 months",
	}
	for m, want := range cases {
		if got := MonthsLabel(m); got != want {
			t.Errorf("MonthsLabel(%d) = %q, want %q", m, got, want)
		}
	}
}

func TestValidateOffsetMap(t *testing.T) {
	if err := ValidateOffsetMap(nil); err != nil {
		t.Errorf("nil: %v", err)
	}
	if err := ValidateOffsetMap(OffsetMap{StreamMonthly: {0}, StreamYearly: {30, 7}}); err != nil {
		t.Errorf("valid: %v", err)
	}
	if err := ValidateOffsetMap(OffsetMap{"weekly": {0}}); err == nil {
		t.Error("unknown stream key: want error")
	}
	if err := ValidateOffsetMap(OffsetMap{StreamYearly: {61}}); err == nil {
		t.Error("out of range: want error")
	}
}

func TestResolveOffsets(t *testing.T) {
	settings := OffsetMap{StreamEvent: {30}, StreamYearly: {30, 7, 0}, StreamMonthly: {0}, StreamOtonan: {7}}
	occ := OffsetMap{StreamMonthly: {1, 0}}
	contact := OffsetMap{StreamYearly: {3, 0}}
	if got := ResolveOffsets(StreamMonthly, occ, contact, settings); len(got) != 2 || got[0] != 1 {
		t.Errorf("occasion override wins: %v", got)
	}
	if got := ResolveOffsets(StreamYearly, occ, contact, settings); len(got) != 2 || got[0] != 3 {
		t.Errorf("contact override wins over settings: %v", got)
	}
	if got := ResolveOffsets(StreamEvent, occ, contact, settings); len(got) != 1 || got[0] != 30 {
		t.Errorf("settings fallback: %v", got)
	}
	if got := ResolveOffsets(StreamOtonan, nil, nil, nil); len(got) != 0 {
		t.Errorf("nothing anywhere → empty (caller falls back to DefaultOffsets): %v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/domain/ -run 'TestValidateRecurrence|TestDefaultRecurrence|TestStreamsFor|TestAddMonths|TestMonthsLabel|TestValidateOffsetMap|TestResolveOffsets' -v`
Expected: FAIL — undefined symbols.

- [ ] **Step 3: Write the implementation**

```go
package domain

import (
	"fmt"
	"time"
)

// Recurrence is the user-chosen repeat rule of an occasion (stored in
// occasions.recurrence).
type Recurrence string

const (
	RecurOnce        Recurrence = "once"
	RecurYearly      Recurrence = "yearly"
	RecurMonthly     Recurrence = "monthly"
	RecurAnniversary Recurrence = "anniversary"
	RecurOtonan      Recurrence = "otonan"
)

// Stream selects which offset set applies to one occurrence (never stored on
// occasions; derived from recurrence + which mark generated the occurrence).
type Stream string

const (
	StreamEvent   Stream = "event"   // the base date itself / a one-time occasion
	StreamYearly  Stream = "yearly"  // yearly anniversary marks
	StreamMonthly Stream = "monthly" // monthly marks
	StreamOtonan  Stream = "otonan"  // 210-day pawukon marks
)

// OffsetMap maps a stream to its reminder day-offsets. Absent OR empty list
// = inherit from the next layer.
type OffsetMap map[Stream][]int

func ValidateRecurrence(r Recurrence) error {
	switch r {
	case RecurOnce, RecurYearly, RecurMonthly, RecurAnniversary, RecurOtonan:
		return nil
	}
	return fmt.Errorf("unknown recurrence: %q", r)
}

// DefaultRecurrence maps an occasion type to its recurrence when the caller
// does not send one explicitly. Custom/unknown types repeat yearly.
func DefaultRecurrence(t OccurrenceType) Recurrence {
	switch t {
	case Otonan:
		return RecurOtonan
	case Anniversary:
		return RecurAnniversary
	default:
		return RecurYearly
	}
}

// StreamsFor lists the streams a recurrence emits, in a stable order.
func StreamsFor(r Recurrence) []Stream {
	switch r {
	case RecurOnce:
		return []Stream{StreamEvent}
	case RecurYearly:
		return []Stream{StreamEvent, StreamYearly}
	case RecurMonthly:
		return []Stream{StreamEvent, StreamMonthly}
	case RecurAnniversary:
		return []Stream{StreamEvent, StreamYearly, StreamMonthly}
	case RecurOtonan:
		return []Stream{StreamOtonan}
	}
	return nil
}

// ValidateOffsetMap: every key must be a known stream, every list must pass
// ValidateOffsets. nil is valid (pure inherit).
func ValidateOffsetMap(m OffsetMap) error {
	for k, v := range m {
		switch k {
		case StreamEvent, StreamYearly, StreamMonthly, StreamOtonan:
		default:
			return fmt.Errorf("unknown offsets stream: %q", k)
		}
		if err := ValidateOffsets(v); err != nil {
			return fmt.Errorf("offsets[%s]: %w", k, err)
		}
	}
	return nil
}

// ResolveOffsets: first layer with a non-empty list for the stream wins;
// nothing anywhere → nil (the caller falls back to DefaultOffsets).
func ResolveOffsets(stream Stream, layers ...OffsetMap) []int {
	for _, m := range layers {
		if len(m[stream]) > 0 {
			return append([]int(nil), m[stream]...)
		}
	}
	return nil
}

// AddMonths: k whole months after base, clamping the day to the target
// month's length (Jan 31 + 1m → Feb 28/29). k must be ≥ 0.
func AddMonths(base Date, k int) Date {
	total := (base.Month - 1) + k
	y := base.Year + total/12
	m := total%12 + 1
	day := base.Day
	if max := daysInMonth(y, m); day > max {
		day = max
	}
	return NewDate(y, m, day)
}

func daysInMonth(y, m int) int {
	return time.Date(y, time.Month(m+1), 0, 0, 0, 0, 0, time.UTC).Day()
}

// MonthsLabel renders a month count: <12 → "N months", ≥12 → "Y years M
// months" (years only when the remainder is 0). Singular-safe.
func MonthsLabel(m int) string {
	if m < 12 {
		if m == 1 {
			return "1 month"
		}
		return fmt.Sprintf("%d months", m)
	}
	y, r := m/12, m%12
	ys := "years"
	if y == 1 {
		ys = "year"
	}
	if r == 0 {
		return fmt.Sprintf("%d %s", y, ys)
	}
	ms := "months"
	if r == 1 {
		ms = "month"
	}
	return fmt.Sprintf("%d %s %d %s", y, ys, r, ms)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/domain/ -count=1`
Expected: PASS (whole domain package — also proves no regressions).

- [ ] **Step 5: Commit**

```bash
git add internal/domain/recurrence.go internal/domain/recurrence_test.go
git commit -m "feat(domain): recurrence vocabulary, streams, month helpers"
```

---

### Task 2: Domain — stream-tagged occurrence engine

**Files:**
- Modify: `internal/domain/occurrence.go` (whole file)
- Test: `internal/domain/occurrence_test.go` (port existing cases + new ones)
- Modify (mechanical caller updates, behavior-preserving): `internal/scheduler/scheduler.go:194`, `internal/api/upcoming.go:98`, `internal/api/upcomingnotify.go:93`

**Interfaces:**
- Consumes: Task 1 vocabulary.
- Produces: `Occurrence` gains `Stream Stream` field; new signatures `NextOccurrence(base Date, typ OccurrenceType, rec Recurrence, from Date) (Occurrence, error)` and `OccurrencesBetween(base Date, typ OccurrenceType, rec Recurrence, from, to Date) ([]Occurrence, error)` — `typ` is kept for labels; `rec` drives the engine. Labels: otonan unchanged (`"Otonan #N — wuku"`); birthday yearly unchanged (`"Birthday #N"`); other yearly marks `"{Type} {N years}"`; monthly marks `"{Type} {MonthsLabel}"`; event marks / once → capitalized type only (`"Anniversary"`, `"Graduation"`).

- [ ] **Step 1: Rewrite occurrence tests first (port every existing case to the new signature, add stream/monthly/once/anniversary cases)**

Port every existing `occurrence_test.go` case, changing calls to the new signatures (insert `domain.RecurYearly`/`RecurOtonan` as the recurrence arg — otonan cases keep `RecurOtonan`). Then add:

```go
func TestOccurrencesBetweenOnce(t *testing.T) {
	base := NewDate(2026, 5, 10)
	occs, err := OccurrencesBetween(base, "graduation", RecurOnce, NewDate(2026, 5, 1), NewDate(2026, 5, 31))
	if err != nil || len(occs) != 1 || occs[0].Date != base || occs[0].Stream != StreamEvent {
		t.Fatalf("once inside range: %v %v", occs, err)
	}
	if occs[0].Label != "Graduation" {
		t.Errorf("once label = %q", occs[0].Label)
	}
	if occs, _ := OccurrencesBetween(base, "graduation", RecurOnce, NewDate(2026, 6, 1), NewDate(2026, 6, 30)); len(occs) != 0 {
		t.Fatalf("once outside range must be empty: %v", occs)
	}
}

func TestOccurrencesBetweenMonthly(t *testing.T) {
	base := NewDate(2025, 6, 16)
	occs, err := OccurrencesBetween(base, "anniversary", RecurMonthly,
		NewDate(2025, 6, 1), NewDate(2026, 6, 30))
	if err != nil {
		t.Fatal(err)
	}
	// k=0 (16 Jun 2025, event) + 12 monthly marks (16 Jul 2025 .. 16 Jun 2026)
	if len(occs) != 13 {
		t.Fatalf("got %d occurrences, want 13: %v", len(occs), occs)
	}
	if occs[0].Stream != StreamEvent || occs[0].Label != "Anniversary" {
		t.Errorf("k=0: %+v", occs[0])
	}
	if occs[1].Stream != StreamMonthly || occs[1].Number != 1 || occs[1].Label != "Anniversary 1 month" {
		t.Errorf("k=1: %+v", occs[1])
	}
	if occs[7].Label != "Anniversary 7 months" {
		t.Errorf("k=7: %+v", occs[7])
	}
	last := occs[12]
	if last.Date != (Date{2026, 6, 16}) || last.Number != 12 || last.Label != "Anniversary 12 months" {
		t.Errorf("k=12 monthly (not yearly — RecurMonthly has no yearly stream): %+v", last)
	}
}

func TestOccurrencesBetweenMonthlyClamp(t *testing.T) {
	base := NewDate(2025, 1, 31)
	occs, _ := OccurrencesBetween(base, "x", RecurMonthly, NewDate(2025, 1, 1), NewDate(2025, 4, 30))
	// Jan 31 (event), Feb 28, Mar 31, Apr 30
	want := []Date{NewDate(2025, 1, 31), NewDate(2025, 2, 28), NewDate(2025, 3, 31), NewDate(2025, 4, 30)}
	if len(occs) != len(want) {
		t.Fatalf("got %d, want %d", len(occs), len(want))
	}
	for i := range want {
		if occs[i].Date != want[i] {
			t.Errorf("mark %d = %s, want %s", i, occs[i].Date, want[i])
		}
	}
}

func TestOccurrencesBetweenAnniversary(t *testing.T) {
	base := NewDate(2025, 6, 16)
	occs, _ := OccurrencesBetween(base, "anniversary", RecurAnniversary,
		NewDate(2025, 6, 1), NewDate(2027, 6, 30))
	// Monthly marks k=0..24 (25) MINUS the 12th/24th monthly marks, which are
	// replaced by yearly ones (still 25 entries total — yearly REPLACES monthly).
	var yearly, monthly []Occurrence
	for _, o := range occs {
		switch o.Stream {
		case StreamYearly:
			yearly = append(yearly, o)
		case StreamMonthly:
			monthly = append(monthly, o)
		}
	}
	if len(yearly) != 2 || yearly[0].Label != "Anniversary 1 year" || yearly[1].Label != "Anniversary 2 years" {
		t.Errorf("yearly marks: %+v", yearly)
	}
	if len(monthly) != 23 {
		t.Errorf("monthly marks: got %d, want 23 (25 minus the two yearly)", len(monthly))
	}
	if len(occs) != 25 {
		t.Errorf("total %d, want 25", len(occs))
	}
	// The yearly date must not ALSO appear as a monthly mark (dedupe key would
	// merge offset-0 anyway, but the engine replaces the entry).
	for _, o := range monthly {
		if o.Date == (Date{2026, 6, 16}) || o.Date == (Date{2027, 6, 16}) {
			t.Errorf("yearly date leaked into monthly stream: %+v", o)
		}
	}
}

func TestOccurrencesBetweenYearlyEventStream(t *testing.T) {
	// A future base date: k=0 is stream event so it still gets the full ramp.
	occs, err := OccurrencesBetween(NewDate(2026, 9, 20), Birthday, RecurYearly,
		NewDate(2026, 9, 1), NewDate(2027, 9, 30))
	if err != nil || len(occs) != 2 {
		t.Fatalf("got %v, %v — want 2 (event + 1st birthday)", occs, err)
	}
	if occs[0].Stream != StreamEvent || occs[0].Number != 0 || occs[0].Label != "Birthday" {
		t.Errorf("event: %+v", occs[0])
	}
	if occs[1].Stream != StreamYearly || occs[1].Number != 1 || occs[1].Label != "Birthday #1" {
		t.Errorf("yearly: %+v", occs[1])
	}
}

func TestNextOccurrenceNewRecurrences(t *testing.T) {
	base := NewDate(2025, 6, 16)
	o, err := NextOccurrence(base, Anniversary, RecurAnniversary, NewDate(2025, 12, 1))
	if err != nil || o.Date != (Date{2025, 12, 16}) || o.Stream != StreamMonthly {
		t.Fatalf("next monthly mark: %+v %v", o, err)
	}
	o, err = NextOccurrence(base, Anniversary, RecurAnniversary, NewDate(2026, 6, 16))
	if err != nil || o.Date != (Date{2026, 6, 16}) || o.Stream != StreamYearly {
		t.Fatalf("yearly wins on the date: %+v %v", o, err)
	}
	if _, err := NextOccurrence(NewDate(2026, 5, 10), Anniversary, RecurOnce, NewDate(2026, 6, 1)); err == nil {
		t.Error("once in the past: want error")
	}
	o, err = NextOccurrence(NewDate(2026, 5, 10), Anniversary, RecurOnce, NewDate(2026, 5, 1))
	if err != nil || o.Stream != StreamEvent {
		t.Errorf("once upcoming: %+v %v", o, err)
	}
}
```

- [ ] **Step 2: Run to verify failure (undefined: Stream, Recurrence, wrong arity)**

Run: `CGO_ENABLED=0 go test ./internal/domain/ -count=1`
Expected: FAIL (compile errors). The scheduler/api packages also fail to compile — they are updated in Step 4.

- [ ] **Step 3: Rewrite occurrence.go**

```go
package domain

import (
	"fmt"
	"strings"
	"unicode"
)

type OccurrenceType string

const (
	Birthday    OccurrenceType = "birthday"
	Otonan      OccurrenceType = "otonan"
	Anniversary OccurrenceType = "anniversary"
)

// Occurrence is one concrete happening of a recurring occasion.
// Number semantics: Otonan → cycle N; Birthday yearly → age; other yearly
// marks → year number; monthly marks → total months; event/once → 0.
type Occurrence struct {
	Date   Date
	Type   OccurrenceType
	Stream Stream
	Number int
	Label  string
}

func NextOccurrence(base Date, typ OccurrenceType, rec Recurrence, from Date) (Occurrence, error) {
	if base == (Date{}) || base.JDN() <= 0 {
		return Occurrence{}, fmt.Errorf("empty base date")
	}
	switch rec {
	case RecurOnce:
		if base.Before(from) {
			return Occurrence{}, fmt.Errorf("once occasion already passed: base=%s from=%s", base, from)
		}
		return Occurrence{Date: base, Type: typ, Stream: StreamEvent, Label: capType(typ)}, nil
	case RecurMonthly, RecurAnniversary:
		k := firstMonthMark(base, from)
		return monthMarkOccurrence(base, typ, k), nil
	case RecurOtonan:
		diff := from.JDN() - base.JDN()
		n := diff / PawukonCycleDays
		if diff%PawukonCycleDays != 0 || n == 0 {
			n++
		}
		if n < 1 {
			n = 1
		}
		occ := base.AddDays(n * PawukonCycleDays)
		return Occurrence{Date: occ, Type: Otonan, Stream: StreamOtonan, Number: n,
			Label: fmt.Sprintf("Otonan #%d — %s", n, Pawukon(occ).Label())}, nil
	case RecurYearly:
		L := max(from.Year, base.Year)
		U := max(from.Year+1, L)
		for y := L; y <= U; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) {
				continue
			}
			return yearlyOccurrence(base, typ, occ), nil
		}
		return Occurrence{}, fmt.Errorf("occurrence not found within 2 years: base=%s from=%s", base, from)
	}
	return Occurrence{}, fmt.Errorf("unknown recurrence: %q", rec)
}

func OccurrencesBetween(base Date, typ OccurrenceType, rec Recurrence, from, to Date) ([]Occurrence, error) {
	if to.Before(from) {
		return nil, fmt.Errorf("inverted range: %s > %s", from, to)
	}
	switch rec {
	case RecurOnce:
		if base.Before(from) || base.After(to) {
			return nil, nil
		}
		return []Occurrence{{Date: base, Type: typ, Stream: StreamEvent, Label: capType(typ)}}, nil
	case RecurOtonan:
		n := 1
		if base.Before(from) {
			diff := from.JDN() - base.JDN()
			n = diff / PawukonCycleDays
			if diff%PawukonCycleDays != 0 {
				n++
			}
			if n < 1 {
				n = 1
			}
		}
		var out []Occurrence
		for {
			occDate := base.AddDays(n * PawukonCycleDays)
			if occDate.After(to) {
				break
			}
			out = append(out, Occurrence{Date: occDate, Type: Otonan, Stream: StreamOtonan, Number: n,
				Label: fmt.Sprintf("Otonan #%d — %s", n, Pawukon(occDate).Label())})
			n++
		}
		return out, nil
	case RecurYearly:
		var out []Occurrence
		for y := max(from.Year, base.Year); y <= to.Year; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) || occ.After(to) {
				continue
			}
			out = append(out, yearlyOccurrence(base, typ, occ))
		}
		return out, nil
	case RecurMonthly, RecurAnniversary:
		var out []Occurrence
		k := firstMonthMark(base, from)
		for {
			occ := monthMarkOccurrence(base, typ, k)
			if occ.Date.After(to) {
				break
			}
			out = append(out, occ)
			k++
		}
		return out, nil
	}
	return nil, fmt.Errorf("unknown recurrence: %q", rec)
}

// firstMonthMark: smallest k with AddMonths(base,k) ≥ from (k=0 when the base
// itself is still upcoming). At most 13 loop iterations after the estimate.
func firstMonthMark(base, from Date) int {
	if !base.Before(from) {
		return 0
	}
	k := (from.Year-base.Year)*12 + (from.Month - base.Month) - 1
	if k < 0 {
		k = 0
	}
	for AddMonths(base, k).Before(from) {
		k++
	}
	return k
}

// monthMarkOccurrence: mark k of a monthly-family recurrence. k=0 is the
// event (stream event, no count); k%12==0 marks are the yearly anniversaries
// (stream yearly, "N years") for RecurAnniversary — they REPLACE the monthly
// entry on that date so each date appears exactly once; RecurMonthly emits
// stream monthly for every k≥1 ("N months" forever).
func monthMarkOccurrence(base Date, typ OccurrenceType, k int) Occurrence {
	d := AddMonths(base, k)
	if k == 0 {
		return Occurrence{Date: d, Type: typ, Stream: StreamEvent, Number: 0, Label: capType(typ)}
	}
	if k%12 == 0 {
		return Occurrence{Date: d, Type: typ, Stream: StreamYearly, Number: k / 12,
			Label: fmt.Sprintf("%s %s", capType(typ), MonthsLabel(k))}
	}
	return Occurrence{Date: d, Type: typ, Stream: StreamMonthly, Number: k,
		Label: fmt.Sprintf("%s %s", capType(typ), MonthsLabel(k))}
}

func yearlyOccurrence(base Date, typ OccurrenceType, occ Date) Occurrence {
	n := occ.Year - base.Year
	if n == 0 {
		return Occurrence{Date: occ, Type: typ, Stream: StreamEvent, Number: 0, Label: capType(typ)}
	}
	if typ == Birthday {
		return Occurrence{Date: occ, Type: typ, Stream: StreamYearly, Number: n, Label: fmt.Sprintf("Birthday #%d", n)}
	}
	return Occurrence{Date: occ, Type: typ, Stream: StreamYearly, Number: n,
		Label: fmt.Sprintf("%s %s", capType(typ), MonthsLabel(n*12))}
}

func capType(t OccurrenceType) string {
	s := string(t)
	if s == "" {
		return "Occasion"
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return strings.TrimSpace(string(r))
}

// yearlyDate: the base anniversary in year y; Feb 29 → Mar 1 in non-leap years.
func yearlyDate(base Date, y int) Date {
	if base.Month == 2 && base.Day == 29 && !isLeap(y) {
		return NewDate(y, 3, 1)
	}
	return NewDate(y, base.Month, base.Day)
}

// Age: full age on date `on` (safe for Feb 29 → computed from the year).
func Age(base, on Date) int {
	age := on.Year - base.Year
	if yearlyDate(base, on.Year).After(on) {
		age--
	}
	return age
}

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

Note: `yearlyLabel` is deleted (folded into `yearlyOccurrence`). `Age`/`isLeap`/`max`/`yearlyDate` stay.

- [ ] **Step 4: Update the three callers mechanically (behavior-preserving)**

In each file, replace the old signature call with the recurrence a hard-coded mapping (the DB has no recurrence column yet — Task 6/8 replace this with `occ.Recurrence`):

`internal/scheduler/scheduler.go` (~line 194), `internal/api/upcoming.go` (~line 98), `internal/api/upcomingnotify.go` (~line 93) — identical change at each site:

```go
// before
occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, fromO, toO)
// after — transitional: pre-recurrence behavior (anniversary = yearly)
rec := domain.RecurYearly
if occ.Type == domain.Otonan {
	rec = domain.RecurOtonan
}
occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, rec, fromO, toO)
```

In `upcomingnotify.go` the same mapping precedes its `OccurrencesBetween` call.

- [ ] **Step 5: Run the full suite**

Run: `CGO_ENABLED=0 go test ./... -count=1`
Expected: PASS everywhere (ported occurrence tests + untouched others).

- [ ] **Step 6: Commit**

```bash
git add internal/domain/occurrence.go internal/domain/occurrence_test.go internal/scheduler/scheduler.go internal/api/upcoming.go internal/api/upcomingnotify.go
git commit -m "feat(domain): stream-tagged occurrence engine with monthly/anniversary/once recurrences"
```

---

### Task 3: Store — UUIDv7 schema + string IDs + occasion_prefs

**Files:**
- Modify: `internal/store/migrations/001_init.sql` (rewrite), delete `internal/store/migrations/002_rename_otongan_type.sql`
- Modify: `internal/store/store.go` (no change expected), `users.go`, `contacts.go`, `channels.go`, `log.go`, plus all store tests

**Interfaces:**
- Consumes: Task 1 (`domain.OffsetMap`, `domain.Recurrence`, `domain.StreamsFor`).
- Produces: `store.Contact{ID, OwnerID string; ...}`, `store.Occasion{ID, ContactID string; Type domain.OccurrenceType; Recurrence domain.Recurrence; BaseDate domain.Date; Label string; Prefs *OccasionPrefs}`, `store.ReminderPrefs{ContactID string; Offsets domain.OffsetMap; ChannelIDs []string; Enabled bool}`, `store.OccasionPrefs{OccasionID string; Offsets domain.OffsetMap; ChannelIDs []string; Enabled bool}`, `store.User{ID string}`, `store.Channel{ID, OwnerID string}`, `store.NotificationEntry{OccasionID *string; HolidayKey *string; ChannelID string}`. Owner scope: `ownerID string`, `""` = admin (replaces `0`). New: `AddOccasion(ctx, contactID string, typ OccurrenceType, rec Recurrence, base Date, label string)`, `OccasionByID(ctx, ownerID, occasionID string) (*Occasion, error)`, `SetOccasionPrefs / DeleteOccasionPrefs / GetOccasionPrefs`.

**NOTE — deliberate mid-migration break:** after this task only `internal/store` + `internal/domain` (+ other store-independent packages) compile. The api/scheduler flip is Task 4. Gate on those packages only.

- [ ] **Step 1: Rewrite the schema**

Replace the content of `internal/store/migrations/001_init.sql` with:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_owner ON contacts(owner_id);

CREATE TABLE occasions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('once','yearly','monthly','anniversary','otonan')),
  base_date TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_occasions_contact ON occasions(contact_id);

CREATE TABLE reminder_prefs (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE occasion_prefs (
  occasion_id TEXT PRIMARY KEY REFERENCES occasions(id) ON DELETE CASCADE,
  offsets TEXT NOT NULL,
  channel_ids TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('gotify','telegram','email')),
  name TEXT NOT NULL,
  config_enc BLOB NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notification_log (
  id TEXT PRIMARY KEY,
  occasion_id TEXT REFERENCES occasions(id) ON DELETE SET NULL,
  holiday_key TEXT,
  occurrence_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','missed')),
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_log_occasion ON notification_log(occasion_id, occurrence_date, offset_days, channel_id) WHERE occasion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_log_holiday ON notification_log(holiday_key, occurrence_date, offset_days, channel_id) WHERE holiday_key IS NOT NULL;
CREATE INDEX idx_log_sent_at ON notification_log(sent_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE holiday_cache (
  year INTEGER NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (year, source)
);
```

Delete `internal/store/migrations/002_rename_otongan_type.sql`.

- [ ] **Step 2: Move google/uuid to a direct dependency**

Run: `go get github.com/google/uuid@v1.6.0 && go mod tidy`
Expected: `github.com/google/uuid` loses its `// indirect` marker in go.mod.

- [ ] **Step 3: Rewrite store structs and methods (string IDs)**

`internal/store/users.go`:

```go
package store

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

// GetOrCreateUser auto-provisions from the email claim. Role is only set on create.
func (s *Store) GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	role := "member"
	if adminEmails[email] {
		role = "admin"
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, name, role) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING`,
		uuid.NewV7().String(), email, name, role); err != nil {
		return User{}, err
	}
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, role FROM users WHERE email = ?`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.Role)
	return u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, email, name, role FROM users ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
```

`internal/store/contacts.go` — full rewrite of struct defs + ID handling. Key sections:

```go
type Contact struct {
	ID       string `json:"id"`
	OwnerID  string `json:"owner_id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Notes    string `json:"notes"`
}

type Occasion struct {
	ID         string                `json:"id"`
	ContactID  string                `json:"contact_id"`
	Type       domain.OccurrenceType `json:"type"`
	Recurrence domain.Recurrence     `json:"recurrence"`
	BaseDate   domain.Date           `json:"base_date"`
	Label      string                `json:"label"`
	Prefs      *OccasionPrefs        `json:"prefs,omitempty"`
}

type ReminderPrefs struct {
	ContactID  string            `json:"contact_id"`
	Offsets    domain.OffsetMap  `json:"offsets"`
	ChannelIDs []string          `json:"channel_ids"`
	Enabled    bool              `json:"enabled"`
}

type OccasionPrefs struct {
	OccasionID string           `json:"occasion_id"`
	Offsets    domain.OffsetMap `json:"offsets"`
	ChannelIDs []string         `json:"channel_ids"`
	Enabled    bool             `json:"enabled"`
}

type ContactWithOccasions struct {
	Contact
	Occasions []Occasion     `json:"occasions"`
	Prefs     *ReminderPrefs `json:"prefs"`
}
```

Owner scoping changes from Sprintf to bound params — replace `ownerFilter` with:

```go
// ownerScope returns (clause, args): ownerID "" = admin (no filter).
func ownerScope(ownerID string) (string, []any) {
	if ownerID == "" {
		return "1=1", nil
	}
	return "owner_id = ?", []any{ownerID}
}
```

Every query that used `fmt.Sprintf(..., ownerFilter(ownerID))` becomes a two-part query with `args` appended (e.g. `ListContacts`):

```go
func (s *Store) ListContacts(ctx context.Context, ownerID string) ([]ContactWithOccasions, error) {
	clause, args := ownerScope(ownerID)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, owner_id, name, nickname, notes FROM contacts WHERE `+clause+` ORDER BY name`, args...)
	// ... scan as before into string fields
}
```

`GetContact`, `UpdateContact`, `DeleteContact` follow the same pattern (`WHERE id = ? AND ` + clause).

`CreateContact` generates the ID and no longer uses `LastInsertId`:

```go
func (s *Store) CreateContact(ctx context.Context, ownerID string, name, nickname, notes string) (Contact, error) {
	id := uuid.NewV7().String()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO contacts (id, owner_id, name, nickname, notes) VALUES (?,?,?,?,?)`,
		id, ownerID, name, nickname, notes)
	if err != nil {
		return Contact{}, err
	}
	return Contact{ID: id, OwnerID: ownerID, Name: name, Nickname: nickname, Notes: notes}, nil
}
```

`fill` loads occasions (now with recurrence) and each occasion's prefs:

```go
func (s *Store) fill(ctx context.Context, c *ContactWithOccasions) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, contact_id, type, recurrence, base_date, label FROM occasions WHERE contact_id = ? ORDER BY base_date`, c.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	c.Occasions = []Occasion{} // SPA contract: always an array, never null
	for rows.Next() {
		var o Occasion
		var base string
		if err := rows.Scan(&o.ID, &o.ContactID, &o.Type, &o.Recurrence, &base, &o.Label); err != nil {
			return err
		}
		if o.BaseDate, err = domain.ParseDate(base); err != nil {
			return err
		}
		c.Occasions = append(c.Occasions, o)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	var offsets, channelIDs string
	var enabled int
	err = s.db.QueryRowContext(ctx,
		`SELECT offsets, channel_ids, enabled FROM reminder_prefs WHERE contact_id = ?`, c.ID).
		Scan(&offsets, &channelIDs, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	p := &ReminderPrefs{ContactID: c.ID, Enabled: enabled == 1, Offsets: domain.OffsetMap{}, ChannelIDs: []string{}}
	if err := json.Unmarshal([]byte(offsets), &p.Offsets); err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(channelIDs), &p.ChannelIDs); err != nil {
		return err
	}
	c.Prefs = p

	for i := range c.Occasions {
		op, err := s.getOccasionPrefsRow(ctx, c.Occasions[i].ID)
		if err != nil {
			return err
		}
		c.Occasions[i].Prefs = op
	}
	return nil
}
```

`AddOccasion` (custom types allowed — the fixed-type check moves to the API layer):

```go
func (s *Store) AddOccasion(ctx context.Context, contactID string, typ domain.OccurrenceType, rec domain.Recurrence, base domain.Date, label string) (Occasion, error) {
	if err := domain.ValidateRecurrence(rec); err != nil {
		return Occasion{}, err
	}
	if typ == "" {
		return Occasion{}, fmt.Errorf("occasion type is required")
	}
	if len(typ) > 64 {
		return Occasion{}, fmt.Errorf("occasion type too long (max 64)")
	}
	id := uuid.NewV7().String()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO occasions (id, contact_id, type, recurrence, base_date, label) VALUES (?,?,?,?,?,?)`,
		id, contactID, typ, rec, base.String(), label)
	if err != nil {
		return Occasion{}, err
	}
	return Occasion{ID: id, ContactID: contactID, Type: typ, Recurrence: rec, BaseDate: base, Label: label}, nil
}
```

`DeleteOccasion` keeps its owner scoping with `ownerScope`.

New occasion-prefs methods (also used by the API in Task 8):

```go
// OccasionByID: owner-scoped single occasion ("" ownerID = admin).
func (s *Store) OccasionByID(ctx context.Context, ownerID, occasionID string) (*Occasion, error) {
	clause, args := ownerScope(ownerID)
	all := append([]any{occasionID}, args...)
	var o Occasion
	var base string
	err := s.db.QueryRowContext(ctx,
		`SELECT o.id, o.contact_id, o.type, o.recurrence, o.base_date, o.label
		 FROM occasions o JOIN contacts c ON c.id = o.contact_id
		 WHERE o.id = ? AND `+clause, all...).
		Scan(&o.ID, &o.ContactID, &o.Type, &o.Recurrence, &base, &o.Label)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if o.BaseDate, err = domain.ParseDate(base); err != nil {
		return nil, err
	}
	if o.Prefs, err = s.getOccasionPrefsRow(ctx, o.ID); err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *Store) getOccasionPrefsRow(ctx context.Context, occasionID string) (*OccasionPrefs, error) {
	var offsets, channelIDs string
	var enabled int
	err := s.db.QueryRowContext(ctx,
		`SELECT offsets, channel_ids, enabled FROM occasion_prefs WHERE occasion_id = ?`, occasionID).
		Scan(&offsets, &channelIDs, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil // inherit — not an error
	}
	if err != nil {
		return nil, err
	}
	p := &OccasionPrefs{OccasionID: occasionID, Enabled: enabled == 1, Offsets: domain.OffsetMap{}, ChannelIDs: []string{}}
	if err := json.Unmarshal([]byte(offsets), &p.Offsets); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(channelIDs), &p.ChannelIDs); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Store) SetOccasionPrefs(ctx context.Context, p OccasionPrefs) error {
	off, err := json.Marshal(p.Offsets)
	if err != nil {
		return err
	}
	ch, err := json.Marshal(p.ChannelIDs)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO occasion_prefs (occasion_id, offsets, channel_ids, enabled)
		VALUES (?,?,?,?) ON CONFLICT(occasion_id) DO UPDATE SET offsets=excluded.offsets,
		channel_ids=excluded.channel_ids, enabled=excluded.enabled`,
		p.OccasionID, string(off), string(ch), boolInt(p.Enabled))
	return err
}

func (s *Store) DeleteOccasionPrefs(ctx context.Context, occasionID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM occasion_prefs WHERE occasion_id = ?`, occasionID)
	return err
}
```

`SetReminderPrefs` becomes a full replace with `domain.OffsetMap` (same upsert, marshals the map).

`internal/store/channels.go`: `Channel{ID, OwnerID string}`; `CreateChannel(ctx, ownerID string, ...)` inserts `uuid.NewV7().String()`; all signatures `(ctx, ownerID, id string)`; `ownerID ""` = admin in `ListChannels/GetChannel/SetChannelEnabled/DeleteChannel` (replace the `ownerID != 0` guards with `ownerID != ""`). `UpdateChannelConfig(ctx, id, ownerID string, ...)`.

`internal/store/log.go`: `NotificationEntry{OccasionID *string, HolidayKey *string, ChannelID string}` — queries unchanged (TEXT binding).

- [ ] **Step 4: Port store tests to UUID fixtures**

In every store test (`contacts_test.go`, `channels_test.go`, `users_test.go`, `log_test.go`, `migrate_test.go`), replace integer-ID fixtures with created-row IDs. Pattern:

```go
// before
u, _ := st.GetOrCreateUser(ctx, "a@b.c", "A", nil)
ct, _ := st.CreateContact(ctx, u.ID, "Ani", "", "")
// assertions referencing literal 1 / int64(1) — replace with u.ID / ct.ID
```

Where a test builds raw IDs without rows (FK-ON means this now fails), create the parent row first and use its ID. Add coverage for the new behavior:

```go
func TestOccasionPrefsRoundTrip(t *testing.T) {
	ctx := context.Background()
	st, _ := OpenInMemory()
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, err := st.GetOrCreateUser(ctx, "a@b.c", "A", nil)
	if err != nil {
		t.Fatal(err)
	}
	ct, err := st.CreateContact(ctx, u.ID, "Ani", "", "")
	if err != nil {
		t.Fatal(err)
	}
	oc, err := st.AddOccasion(ctx, ct.ID, "anniversary", domain.RecurAnniversary, domain.NewDate(2025, 6, 16), "wedding")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := uuid.Parse(oc.ID); err != nil {
		t.Fatalf("occasion id not a uuid: %v", oc.ID)
	}
	if err := st.SetOccasionPrefs(ctx, OccasionPrefs{OccasionID: oc.ID,
		Offsets: domain.OffsetMap{domain.StreamMonthly: {1, 0}}, ChannelIDs: []string{}, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	got, err := st.OccasionByID(ctx, u.ID, oc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Prefs == nil || got.Prefs.Enabled || len(got.Prefs.Offsets[domain.StreamMonthly]) != 2 {
		t.Fatalf("prefs round-trip: %+v", got.Prefs)
	}
	if err := st.DeleteOccasionPrefs(ctx, oc.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.OccasionByID(ctx, u.ID, oc.ID); got.Prefs != nil {
		t.Fatalf("delete override: %+v", got.Prefs)
	}
}
```

(imports: `context`, `github.com/google/uuid`, `wimember/internal/domain`.)

- [ ] **Step 5: Run scoped gate**

Run: `CGO_ENABLED=0 go build ./internal/store ./internal/domain && CGO_ENABLED=0 go test ./internal/store/... ./internal/domain/... -count=1`
Expected: PASS. (api/scheduler intentionally do NOT compile yet — Task 4 fixes them. Do not run `go test ./...` here.)

- [ ] **Step 6: Commit**

```bash
git add internal/store/ go.mod go.sum
git commit -m "feat(store): uuidv7 schema, string ids, occasion_prefs, recurrence column"
```

---

### Task 4: API + scheduler + devseed — string-ID flip (build green)

**Files:**
- Modify: `internal/api/handlers.go`, `internal/api/upcoming.go`, `internal/api/upcomingnotify.go`, `internal/api/devseed.go`, `internal/api/server_test.go` and other api tests, `internal/scheduler/scheduler.go`, `internal/scheduler/scheduler_test.go`, `internal/scheduler/loop_test.go`
- Modify: `web/src/lib/api.ts` is NOT in this task (frontend tasks later).

**Interfaces:**
- Consumes: Task 3 stores.
- Produces: `pathID(c) (string, bool)` — `uuid.Parse` failure → 404 JSON; `Server.scope(c) string` (`""` = admin); `Snapshot.DefaultChannelIDs []string`; `Service.failUntil map[string]time.Time`; `upcomingNotifyIn{OccasionID, ContactID string; ChannelIDs []string}`; `UpcomingItem{OccasionID, ContactID string}`.

- [ ] **Step 1: pathID → UUID**

In `internal/api/handlers.go`:

```go
func pathID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return "", false
	}
	return id, true
}
```

(import `github.com/google/uuid`; drop `strconv` if now unused.) `scope` returns `u.ID` for members and `""` for admins:

```go
func (s *Server) scope(c *gin.Context) string {
	u := mustUser(c)
	if u.Role == "admin" {
		return ""
	}
	return u.ID
}
```

`prefsIn.ChannelIDs` becomes `*[]string`; `handleSetPrefs` default stays `ChannelIDs: []string{}`; its `Offsets` default handling is unchanged for now (Task 8 switches the shape).

- [ ] **Step 2: upcoming.go / upcomingnotify.go / devseed.go mechanical flips**

- `UpcomingItem.OccasionID/ContactID` → `string`; `json:"occasion_id,omitempty"` unchanged.
- `upcomingNotifyIn`: `OccasionID, ContactID string`, `ChannelIDs []string`; guard `if in.OccasionID == "" || in.ContactID == ""`; `want := make(map[string]bool, len(in.ChannelIDs))`.
- `devseed.go`: `var extras []string`.

- [ ] **Step 3: scheduler flips**

In `internal/scheduler/scheduler.go`: `Snapshot.DefaultChannelIDs []string`; `failUntil map[string]time.Time` (lazy-init unchanged); `targetChannels`: `want := map[string]bool{}`. In tests, replace every `int64` ID with `uuid.NewString()` fixtures (helper `newID := uuid.NewString`); port every literal (`1`, `int64(2)`…) in `scheduler_test.go` / `loop_test.go` to created rows or generated UUID strings — the stores in those tests are real (`store.OpenInMemory`), so create rows via the store API where FKs demand it.

- [ ] **Step 4: Full suite**

Run: `CGO_ENABLED=0 go test ./... -count=1`
Expected: PASS — the whole module compiles and is green again.

- [ ] **Step 5: Commit**

```bash
git add internal/ cmd/
git commit -m "feat(api,scheduler): string uuid ids end to end"
```

---

### Task 5: Settings — recurrence_offsets

**Files:**
- Modify: `internal/api/settings.go`
- Modify: `internal/domain/recurrence.go` (add `DefaultRecurrenceOffsets`)
- Test: `internal/api/server_test.go` (settings cases) or a new `internal/api/settings_test.go`

**Interfaces:**
- Produces: `domain.DefaultRecurrenceOffsets() domain.OffsetMap` (fresh map each call); `Settings.RecurrenceOffsets domain.OffsetMap json:"recurrence_offsets"`; `Snapshot.RecurrenceOffsets domain.OffsetMap` (wired in main.go's `buildSnapshot`).

- [ ] **Step 1: Failing test**

```go
func TestSettingsRecurrenceOffsets(t *testing.T) {
	// server helper from existing api tests (dev auth) — reuse the pattern in server_test.go
	srv := newTestServer(t)

	got := srv.LoadSettings(context.Background())
	def := got.RecurrenceOffsets
	if len(def[domain.StreamMonthly]) != 1 || def[domain.StreamMonthly][0] != 0 {
		t.Fatalf("default monthly offsets: %v", def)
	}
	if len(def[domain.StreamEvent]) != 6 || def[domain.StreamEvent][0] != 30 {
		t.Fatalf("default event offsets: %v", def)
	}

	in := got
	in.RecurrenceOffsets = domain.OffsetMap{domain.StreamYearly: {2, 0}}
	if _, err := srv.SaveSettings(context.Background(), in); err == nil {
		t.Fatal("partial map must be rejected: keys event/monthly/otonan are required")
	}
	in.RecurrenceOffsets = domain.OffsetMap{
		domain.StreamEvent: {30}, domain.StreamYearly: {2, 0},
		domain.StreamMonthly: {0}, domain.StreamOtonan: {5},
	}
	out, err := srv.SaveSettings(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if o := srv.LoadSettings(context.Background()).RecurrenceOffsets[domain.StreamYearly]; len(o) != 2 || o[0] != 2 {
		t.Fatalf("stored yearly offsets: %v", o)
	}
	if out.DefaultOffsets == nil || len(out.DefaultOffsets) == 0 {
		t.Fatal("default_offsets still required (holiday fallback)")
	}
}
```

- [ ] **Step 2: Run to verify failure** — `CGO_ENABLED=0 go test ./internal/api/ -run TestSettingsRecurrenceOffsets -v` → FAIL (no field).

- [ ] **Step 3: Implement**

In `internal/domain/recurrence.go`:

```go
// DefaultRecurrenceOffsets: the seeded per-stream offset sets. A fresh copy
// every call — callers may mutate.
func DefaultRecurrenceOffsets() OffsetMap {
	return OffsetMap{
		StreamEvent:   {30, 7, 4, 2, 1, 0},
		StreamYearly:  {30, 7, 4, 2, 1, 0},
		StreamMonthly: {0},
		StreamOtonan:  {7, 4, 2, 1, 0},
	}
}
```

In `internal/api/settings.go`: add field to `Settings`:

```go
RecurrenceOffsets domain.OffsetMap `json:"recurrence_offsets"`
```

`DefaultSettings` seeds `RecurrenceOffsets: domain.DefaultRecurrenceOffsets()`. `LoadSettings` merges: `if stored.RecurrenceOffsets != nil { out.RecurrenceOffsets = stored.RecurrenceOffsets }`. `SaveSettings` requires a complete, valid map:

```go
if err := domain.ValidateOffsetMap(in.RecurrenceOffsets); err != nil {
	return Settings{}, err
}
for _, s := range []domain.Stream{domain.StreamEvent, domain.StreamYearly, domain.StreamMonthly, domain.StreamOtonan} {
	if len(in.RecurrenceOffsets[s]) == 0 {
		return Settings{}, fmt.Errorf("recurrence_offsets[%s] is required (use a non-empty list)", s)
	}
}
```

In `cmd/server/main.go` `buildSnapshot`, add `RecurrenceOffsets: set.RecurrenceOffsets,`.

- [ ] **Step 4: Full suite** — `CGO_ENABLED=0 go test ./... -count=1` → PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ cmd/
git commit -m "feat(settings): per-recurrence default offsets"
```

---

### Task 6: Scheduler — recurrence, occasion prefs, per-stream offsets & channels

**Files:**
- Modify: `internal/scheduler/scheduler.go` (occasions section of `RunOnce` + `targetChannels`)
- Test: `internal/scheduler/scheduler_test.go`

**Interfaces:**
- Consumes: `store.Occasion.Recurrence/.Prefs`, `domain.StreamsFor`, `domain.ResolveOffsets`, `Snapshot.RecurrenceOffsets` (Task 5).
- Produces: unchanged `RunOnce` signature; behavior per spec §3.

- [ ] **Step 1: Failing tests** (add to scheduler_test.go, following its existing FakeClock/store/Recording-notifier fixtures)

```go
func TestOccasionDisabledByOccasionPrefs(t *testing.T) {
	// Fixture: contact + anniversary occasion (16 June 2025) with
	// occasion_prefs.enabled = 0, FakeClock at 2026-06-16 08:01 WITA,
	// one enabled telegram channel, recurrence_offsets from settings.
	// RunOnce → Result{} zero: no send, no missed (the occasion is skipped).
}

func TestMonthlyMarkSentOnTheDay(t *testing.T) {
	// Fixture: anniversary occasion base 2025-06-16, no prefs anywhere.
	// FakeClock 2025-12-16 08:01 → RunOnce sends exactly ONE notification:
	// the monthly mark (offset 0 of StreamMonthly), title contains
	// "Anniversary 6 months".
}

func TestYearlyOffsetsUseEventYearlySet(t *testing.T) {
	// Fixture: anniversary base 2025-06-16. FakeClock 2026-05-17 08:01
	// (D-30 before the first anniversary) → sends ONE notification
	// (offset 30 from StreamYearly). FakeClock 2026-06-16 08:01 → sends ONE
	// (offset 0; the monthly [0] and yearly [0] dedupe to one push).
}

func TestOccasionChannelOverride(t *testing.T) {
	// Two enabled channels for the owner; occasion_prefs.channel_ids selects
	// only channel B → every notification lands only on B.
}

func TestOccasionOffsetsOverride(t *testing.T) {
	// occasion_prefs.offsets = {monthly: [1, 0]} → on 2025-12-16 08:01 the
	// D-1 reminder fires (15 Dec), on 2025-12-17 08:01 the D-0 fires.
}
```

Each test body follows the existing scheduler-test fixture style; the assertion core is `Result` counts + captured message titles per channel.

- [ ] **Step 2: Run to verify failure** — `CGO_ENABLED=0 go test ./internal/scheduler/ -run 'TestOccasion|TestMonthlyMark|TestYearlyOffsets' -v` → FAIL.

- [ ] **Step 3: Implement the occasions section**

Replace the occasions loop in `RunOnce`:

```go
for _, cw := range contacts {
	if cw.Prefs != nil && !cw.Prefs.Enabled {
		continue
	}
	defaultChannels := s.targetChannels(ctx, cw, snap.DefaultChannelIDs)
	for _, occ := range cw.Occasions {
		if occ.Prefs != nil && !occ.Prefs.Enabled {
			continue // per-occasion kill switch
		}
		// Channels: occasion override → contact cascade (already resolved).
		channels := defaultChannels
		if occ.Prefs != nil && len(occ.Prefs.ChannelIDs) > 0 {
			if byID := filterChannels(defaultChannels, occ.Prefs.ChannelIDs); len(byID) > 0 {
				channels = byID
			}
		}
		// Offsets per stream: occasion → contact → settings → DefaultOffsets.
		resolved := domain.ResolveOccasionStreams(occ.Recurrence, occ.Prefs.Offsets, cw.Prefs.Offsets, snap.RecurrenceOffsets)
		maxOff := 0
		for _, offs := range resolved {
			if m := maxOffset(offs); m > maxOff {
				maxOff = m
			}
		}
		catchUpDays := (snap.CatchUpHours + 23) / 24
		fromO := today.AddDays(-(maxOff + catchUpDays + 2))
		toO := today.AddDays(maxOff + 2)
		occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, occ.Recurrence, fromO, toO)
		if err != nil {
			continue
		}
		for _, o := range occs {
			offs := resolved[o.Stream]
			if o.Stream == domain.StreamEvent && len(offs) == 0 {
				offs = domain.DefaultOffsets
			}
			for _, off := range offs {
				rDate := o.Date.AddDays(-off)
				sendAt := time.Date(rDate.Year, time.Month(rDate.Month), rDate.Day, sendHH, sendMM, 0, 0, loc)
				if sendAt.After(now) {
					continue
				}
				occID := occ.ID
				entry := store.NotificationEntry{OccasionID: &occID,
					OccurrenceDate: o.Date, OffsetDays: off}
				if sendAt.Before(dueStart) {
					for _, ch := range channels {
						entry.ChannelID, entry.Status = ch.ID, "missed"
						s.record(ctx, entry, &res, "occasion")
					}
					continue
				}
				late := now.Sub(sendAt) > time.Hour
				msg := notify.OccurrenceMessage(cw.Name, o, o.Date.JDN()-today.JDN(), late)
				s.deliver(ctx, channels, entry, msg, &res, "occasion")
			}
		}
	}
}
```

With helpers (package-level, testable):

```go
func filterChannels(all []store.Channel, ids []string) []store.Channel {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var out []store.Channel
	for _, ch := range all {
		if want[ch.ID] {
			out = append(out, ch)
		}
	}
	return out
}
```

The per-contact `offsets`/`oOff`/`fromO`/`toO` locals from the old loop move inside the occasion loop as shown. Delete the old `offsets := snap.DefaultOffsets ...` contact-level block (contact offsets now flow through `ResolveOffsets` via `cw.Prefs.Offsets`). Note `cw.Prefs.Offsets` is now a `domain.OffsetMap` — the legacy per-contact flat list is gone by design (fresh start).

Add the shared resolver to `internal/domain/recurrence.go` (Task 8's upcoming endpoint reuses it verbatim):

```go
// ResolveOccasionStreams: per-stream offset lists for one occasion, applying
// the standard precedence (occasion → contact → settings → DefaultOffsets).
// Only the streams the recurrence emits are present.
func ResolveOccasionStreams(rec Recurrence, occ, contact, settings OffsetMap) map[Stream][]int {
	out := map[Stream][]int{}
	for _, st := range StreamsFor(rec) {
		offs := ResolveOffsets(st, occ, contact, settings)
		if len(offs) == 0 {
			offs = append([]int(nil), DefaultOffsets...)
		}
		out[st] = offs
	}
	return out
}
```

with a table test in `recurrence_test.go`:

```go
func TestResolveOccasionStreams(t *testing.T) {
	got := ResolveOccasionStreams(RecurAnniversary,
		OffsetMap{StreamMonthly: {1, 0}},
		nil,
		OffsetMap{StreamEvent: {30}, StreamYearly: {30, 7, 0}, StreamMonthly: {0}, StreamOtonan: {7}})
	if len(got) != 3 {
		t.Fatalf("streams: %v", got)
	}
	if len(got[StreamMonthly]) != 2 || got[StreamMonthly][0] != 1 {
		t.Errorf("occasion override: %v", got[StreamMonthly])
	}
	if len(got[StreamEvent]) != 1 || got[StreamEvent][0] != 30 {
		t.Errorf("settings fallback: %v", got[StreamEvent])
	}
	if len(got[StreamYearly]) != 3 {
		t.Errorf("settings fallback yearly: %v", got[StreamYearly])
	}
	all := ResolveOccasionStreams(RecurOtonan, nil, nil, nil)
	if len(all[StreamOtonan]) != len(DefaultOffsets) {
		t.Errorf("DefaultOffsets fallback: %v", all[StreamOtonan])
	}
}
```

Also update the transitional `rec` mapping from Task 2: `occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, occ.Recurrence, fromO, toO)`.

- [ ] **Step 4: Full suite** — `CGO_ENABLED=0 go test ./... -count=1` → PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/scheduler/
git commit -m "feat(scheduler): per-stream offsets, occasion prefs, recurrence-aware scan"
```

---

### Task 7: notify — stream-aware messages

**Files:**
- Modify: `internal/notify/message.go`
- Test: `internal/notify/message_test.go`

**Interfaces:**
- Consumes: `domain.Occurrence.Stream/.Label`.
- Produces: `OccurrenceMessage` copy rules: otonan unchanged; birthday yearly → `🎂 {name} — {label} {kapan}` (label already "Birthday #N"); other yearly/monthly → `🎊 {name} — {label} {kapan}` where label = "Anniversary 1 year 2 months" etc.; event/once → `🎉 {name} — {label} {kapan}`.

- [ ] **Step 1: Failing tests**

```go
func TestOccurrenceMessagesStreams(t *testing.T) {
	anniv := domain.Occurrence{Date: domain.NewDate(2026, 8, 16), Type: domain.Anniversary,
		Stream: domain.StreamMonthly, Number: 14, Label: "Anniversary 1 year 2 months"}
	m := OccurrenceMessage("Ani", anniv, 3, false)
	if m.Title != "🎊 Ani — Anniversary 1 year 2 months in 3 days" {
		t.Errorf("monthly title: %q", m.Title)
	}
	y := OccurrenceMessage("Ani", anniv, 0, false) // same struct, daysUntil 0
	if y.Priority != 8 {
		t.Errorf("day-of priority: %d", y.Priority)
	}
	b := OccurrenceMessage("Ben", domain.Occurrence{Date: domain.NewDate(2026, 1, 1), Type: domain.Birthday,
		Stream: domain.StreamYearly, Number: 30, Label: "Birthday #30"}, 7, false)
	if b.Title != "🎂 Ben — Birthday #30 in 7 days" {
		t.Errorf("birthday title: %q", b.Title)
	}
	g := OccurrenceMessage("Cy", domain.Occurrence{Date: domain.NewDate(2026, 5, 10), Type: "graduation",
		Stream: domain.StreamEvent, Label: "Graduation"}, 2, false)
	if g.Title != "🎉 Cy — Graduation in 2 days" {
		t.Errorf("once title: %q", g.Title)
	}
}
```

- [ ] **Step 2: Run to verify failure**, then implement `OccurrenceMessage`:

```go
func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message {
	var emoji, title, body string
	switch {
	case occ.Type == domain.Otonan:
		emoji, title = "🛕", fmt.Sprintf("🛕 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("Otonan for %s %s, on %s.", contactName, kapan(daysUntil), TanggalIndo(occ.Date))
	case occ.Type == domain.Birthday && occ.Stream == domain.StreamYearly:
		title = fmt.Sprintf("🎂 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("%s for %s on %s.", occ.Label, contactName, TanggalIndo(occ.Date))
	case occ.Stream == domain.StreamEvent:
		title = fmt.Sprintf("🎉 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("%s for %s on %s.", occ.Label, contactName, TanggalIndo(occ.Date))
	default: // monthly + yearly marks of anniversaries and custom types
		title = fmt.Sprintf("🎊 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("%s for %s on %s.", occ.Label, contactName, TanggalIndo(occ.Date))
	}
	_ = emoji
	p := 5
	if daysUntil <= 0 {
		p = 8
	}
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}
```

(Drop the unused `emoji` var if the compiler flags it — the emoji is inlined in each format string above.)

- [ ] **Step 3: Full suite** — PASS. **Step 4: Commit**

```bash
git add internal/notify/
git commit -m "feat(notify): stream-aware occurrence messages with month-aware labels"
```

---

### Task 8: API — occasion endpoints, prefs endpoints, upcoming payloads

**Files:**
- Modify: `internal/api/handlers.go` (occasion create), `internal/api/server.go` (routes), `internal/api/upcoming.go`, `internal/api/upcomingnotify.go`
- Test: `internal/api/server_test.go` (+ handler tests as local funcs in it, matching existing style)

**Interfaces:**
- Consumes: Task 3 `OccasionByID/SetOccasionPrefs/DeleteOccasionPrefs`, Task 5 settings, Task 6 semantics.
- Produces: `POST /contacts/:id/occasions` `{type, date, recurrence?, label?}` (201 → full Occasion JSON incl. recurrence); `GET/PUT/DELETE /occasions/:id/prefs`; `GET /occasions/types` → `{"types":[...]}`; upcoming items gain `recurrence`, per-item `reminders` resolved per stream.

- [ ] **Step 1: Failing tests** (following existing api test conventions — httptest against `Server.ServeHTTP` with dev auth):

```go
func TestAddOccasionCustomTypeAndRecurrence(t *testing.T) {
	// POST /api/v1/contacts/{id}/occasions {"type":"wedding","date":"2025-06-16","recurrence":"anniversary","label":"wedding"}
	// → 201, body.recurrence == "anniversary", body.id parses as uuid.
	// POST without recurrence on type "graduation" → recurrence "yearly".
	// POST recurrence "weekly" → 400. POST empty type → 400.
}

func TestOccasionPrefsEndpoints(t *testing.T) {
	// PUT /occasions/{id}/prefs {"offsets":{"monthly":[1,0]},"channel_ids":[],"enabled":false} → 200
	// GET /contacts/{id} → occasion.prefs.enabled == false, offsets.monthly == [1,0]
	// PUT {"offsets":{"monthly":[61]}} → 400
	// DELETE /occasions/{id}/prefs → 200; GET contact → occasion.prefs == null
	// PUT on unknown occasion uuid → 404; on malformed uuid → 404
}

func TestOccasionTypesSuggestions(t *testing.T) {
	// With occasions of types "wedding" and "birthday" →
	// GET /occasions/types → contains "birthday","otonan","anniversary","wedding".
}

func TestUpcomingAnniversaryStreams(t *testing.T) {
	// Contact with anniversary occasion base 2025-06-16, server "today" —
	// use from/to query spanning a monthly mark → item has
	// recurrence "anniversary" and reminders == [0] (monthly stream),
	// title "Anniversary N months"; the yearly-window item has
	// reminders == [30,7,4,2,1,0].
}
```

- [ ] **Step 2: Run to verify failure** — new routes 404 / fields missing.

- [ ] **Step 3: Implement handlers + routes**

`occasionIn` gains `Recurrence string json:"recurrence"`; `handleAddOccasion`:

```go
typ := domain.OccurrenceType(in.Type)
if typ == "" {
	c.JSON(400, gin.H{"error": "type is required"})
	return
}
if len(typ) > 64 {
	c.JSON(400, gin.H{"error": "type too long (max 64)"})
	return
}
rec := domain.Recurrence(in.Recurrence)
if rec == "" {
	rec = domain.DefaultRecurrence(typ)
}
if err := domain.ValidateRecurrence(rec); err != nil {
	c.JSON(400, gin.H{"error": err.Error()})
	return
}
// (existing contact existence + date parsing), then:
oc, err := s.st.AddOccasion(ctx, cid, typ, rec, base, in.Label)
```

New handlers in a focused new file `internal/api/occasionprefs.go`:

```go
type occasionPrefsIn struct {
	Offsets    domain.OffsetMap `json:"offsets"`
	ChannelIDs *[]string        `json:"channel_ids"`
	Enabled    *bool            `json:"enabled"`
}

func (s *Server) handleGetOccasionPrefs(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	occ, err := s.st.OccasionByID(c.Request.Context(), s.scope(c), id)
	if err != nil {
		respondErr(c, err)
		return
	}
	if occ.Prefs == nil {
		c.JSON(200, store.OccasionPrefs{OccasionID: id, Offsets: domain.OffsetMap{}, ChannelIDs: []string{}, Enabled: true})
		return
	}
	c.JSON(200, *occ.Prefs)
}

func (s *Server) handleSetOccasionPrefs(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	in, ok := bind[occasionPrefsIn](c)
	if !ok {
		return
	}
	if _, err := s.st.OccasionByID(c.Request.Context(), s.scope(c), id); err != nil {
		respondErr(c, err)
		return
	}
	if err := domain.ValidateOffsetMap(in.Offsets); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	p := store.OccasionPrefs{OccasionID: id, Offsets: in.Offsets, ChannelIDs: []string{}, Enabled: true}
	if in.ChannelIDs != nil {
		p.ChannelIDs = *in.ChannelIDs
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if err := s.st.SetOccasionPrefs(c.Request.Context(), p); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, p)
}

func (s *Server) handleDeleteOccasionPrefs(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if _, err := s.st.OccasionByID(c.Request.Context(), s.scope(c), id); err != nil {
		respondErr(c, err)
		return
	}
	if err := s.st.DeleteOccasionPrefs(c.Request.Context(), id); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) handleOccasionTypes(c *gin.Context) {
	types, err := s.st.DistinctOccasionTypes(c.Request.Context(), s.scope(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"types": types})
}
```

Add to `internal/store/contacts.go`:

```go
// DistinctOccasionTypes: the caller's used types plus the built-ins, sorted.
func (s *Store) DistinctOccasionTypes(ctx context.Context, ownerID string) ([]string, error) {
	clause, args := ownerScope(ownerID)
	rows, err := s.db.QueryContext(ctx,
		`SELECT DISTINCT o.type FROM occasions o
		 JOIN contacts c ON c.id = o.contact_id WHERE `+clause+` ORDER BY o.type`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := map[string]bool{string(domain.Birthday): true, string(domain.Otonan): true, string(domain.Anniversary): true}
	out := []string{string(domain.Birthday), string(domain.Otonan), string(domain.Anniversary)}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out, rows.Err()
}
```

Routes in `server.go` (before the `:id` routes is not required in gin ≥1.7 — static and param siblings coexist):

```go
apiG.GET("/occasions/types", s.handleOccasionTypes)
apiG.GET("/occasions/:id/prefs", s.handleGetOccasionPrefs)
apiG.PUT("/occasions/:id/prefs", s.handleSetOccasionPrefs)
apiG.DELETE("/occasions/:id/prefs", s.handleDeleteOccasionPrefs)
```

If gin panics at registration on route conflict, rename the static route to `/occasion-types` and use that from the frontend (gin 1.12 supports the sibling layout, so this fallback is unlikely).

`handleSetPrefs` (contact-level) switches to the map shape: `prefsIn{Offsets domain.OffsetMap json:"offsets"; ChannelIDs *[]string; Enabled *bool}`, default `Offsets: domain.OffsetMap{}`, validate with `domain.ValidateOffsetMap`.

`upcoming.go`: items carry the stream-resolved reminders. Per contact/occasion, resolve per-stream maps exactly like Task 6 (extract that resolution into a small shared helper — put `ResolveOccasionStreams(occ store.Occasion, contact *store.ReminderPrefs, settings domain.OffsetMap) map[domain.Stream][]int` in `internal/scheduler`? No — api cannot import scheduler (cycle-free but layering); put it in `domain`:

```go
// in domain/recurrence.go
// ResolveOccasionStreams: per-stream offset lists for one occasion, applying
// the standard precedence (occasion → contact → settings → DefaultOffsets).
func ResolveOccasionStreams(rec Recurrence, occ, contact OffsetMap, settings OffsetMap) map[Stream][]int {
	out := map[Stream][]int{}
	for _, st := range StreamsFor(rec) {
		offs := ResolveOffsets(st, occ, contact, settings)
		if len(offs) == 0 {
			offs = append([]int(nil), DefaultOffsets...)
		}
		out[st] = offs
	}
	return out
}
```

(Then Task 6's resolution already calls this helper.) `upcoming.go` per item: `streamOffs := domain.ResolveOccasionStreams(occ.Recurrence, occPrefsOf(occ), contactPrefsOf(cw), settings.RecurrenceOffsets)`; `item.Reminders = streamOffs[o.Stream]`; `item.RemindersDefault = (no contact-level and no occasion-level list existed for this stream)` — compute by checking `len(contactMap[stream]) == 0 && len(occMap[stream]) == 0`. Add `Recurrence domain.Recurrence json:"recurrence"` to `UpcomingItem`. Remove the transitional `rec` mapping (use `occ.Recurrence`).

`upcomingnotify.go`: replace the transitional mapping with `occ.Recurrence` (loaded via `s.st.OccasionByID` instead of scanning `cw.Occasions` — simpler and owner-safe).

- [ ] **Step 4: Full suite** — PASS. **Step 5: Commit**

```bash
git add internal/ && git commit -m "feat(api): occasion recurrence, per-occasion prefs endpoints, stream-aware upcoming"
```

---

### Task 9: Frontend — string IDs + new payload shapes (build green)

**Files:**
- Modify: `web/src/lib/api.ts`, `web/src/routes/reminder.contacts.$id.tsx`, `web/src/components/contacts/contacts-grid.tsx`, `web/src/components/contacts/contact-summary-card.tsx`, `web/src/components/contacts/contact-detail-content.tsx` (ID props only), `web/src/components/event-detail.tsx`, `web/src/routes/reminder.channels.tsx`, `web/src/lib/prefs.ts`, `web/src/components/day-events-dialog.tsx` (if it types IDs)

**Interfaces:**
- Consumes: backend JSON from Tasks 3–8.
- Produces: `Occasion { id: string; type: string; recurrence: 'once'|'yearly'|'monthly'|'anniversary'|'otonan'; base_date: string; label: string; prefs: OccasionPrefs | null }`; `Prefs { contact_id: string; offsets: Record<string, number[]>; channel_ids: string[]; enabled: boolean }`; `OccasionPrefs { occasion_id: string; offsets: Record<string, number[]>; channel_ids: string[]; enabled: boolean }`; `Contact { id: string; ... }`; `Channel { id: string; ... }`; `UpcomingItem { occasion_id?: string; contact_id?: string; recurrence?: string; ... }`; `Settings { recurrence_offsets: Record<string, number[]>; ... }`.

- [ ] **Step 1: Update types in api.ts** per the shapes above (IDs `string`, add `recurrence`, `prefs`, `recurrence_offsets`).

- [ ] **Step 2: Route guard** in `reminder.contacts.$id.tsx`:

```ts
// before
if (!/^\d+$/.test(params.id)) throw redirect({ to: '/reminder/contacts' })
const id = String(Number(params.id))
// after
const id = params.id
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  throw redirect({ to: '/reminder/contacts' })
}
```

and drop every `Number(id)` → pass `id` to `ContactDetailContent` / `ContactSummaryCard` / `ContactEditForm`.

- [ ] **Step 3: Prop types** — `contactId: number` → `string` (contact-summary-card, contact-detail-content, contact-edit-form); `onSelect: (id: number)` / `selectedId?: number` → `string` (contacts-grid); `occasionId?: number` / `contactId?: number` / `channelIds: number[]` → `string[]`/`string` (event-detail + ReminderTrigger); channels route `ids: number[]`, `(id: number)`, `{ id: number; enabled: boolean }` → `string`. In event-detail, the `#{item.number}` suffix in the title is removed (labels already carry the count: "Anniversary 1 year 2 months"); keep `number` for otonan display if present.

- [ ] **Step 4: prefs.ts** — offsets are now a map; the contact form hydration becomes:

```ts
export function hydratePrefsForm(prefs?: Prefs | null): { yearly: string; monthly: string; enabled: boolean } {
  return {
    yearly: (prefs?.offsets?.yearly ?? []).join(','),
    monthly: (prefs?.offsets?.monthly ?? []).join(','),
    enabled: prefs?.enabled ?? true,
  }
}
```

- [ ] **Step 5: Verify** — `cd web && pnpm run build` (tsc strict catches all leftover `number` ID sites; fix each as above). Then `CGO_ENABLED=0 go test ./... -count=1` (webroot embed untouched).

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): string uuid ids and recurrence payload shapes"
```

---

### Task 10: Frontend — occasion form, per-occasion prefs editor, settings

**Files:**
- Modify: `web/src/components/contacts/contact-detail-content.tsx`
- Create: `web/src/components/contacts/occasion-prefs-editor.tsx`
- Modify: `web/src/routes/reminder.settings.tsx`
- Test: `cd web && pnpm run build` + manual dev-mode smoke (`AUTH_MODE=dev make run`) — no unit-test harness exists for the SPA; TypeScript strictness is the gate.

**Interfaces:**
- Consumes: Task 8/9 endpoints and types.
- Produces: `OccasionPrefsEditor({ contact: Contact; occasion: Occasion; channels: Channel[] })` — PUT/DELETE `/occasions/{id}/prefs`, invalidates `['contact', id]`.

- [ ] **Step 1: Occasion add form rework** in contact-detail-content.tsx

State: `type: string` (built-in or custom), `recurrence: 'once'|'yearly'|'monthly'|'anniversary'|'otonan'`, `label: string`, existing `date`/`dateSel`/`pawukon`. Type control becomes a Select of built-ins + an "Custom…" item that reveals a free-text `Input` (suggestions via `useQuery(['occasion-types'], () => api<{types: string[]}>('/occasions/types'))` rendered as clickable hint chips under the input). Recurrence is a Select; picking a built-in type auto-sets its default (`useEffect` on `type`: birthday→yearly, otonan→otonan, anniversary→anniversary; custom stays at the current choice, initialized to `yearly`). Add payload:

```ts
body: JSON.stringify({ type, recurrence, date, label })
```

Delete the one-per-type machinery: `existingTypes`, `typeItems.disabled`, the Add-button lock (keep `disabled={!date || addOcc.isPending}`), and the "only one of each type" paragraph.

Occasion rows gain a recurrence badge next to the type badge:

```tsx
<Badge variant="secondary" className="uppercase">{o.type}</Badge>
<Badge variant="outline" className="capitalize">{o.recurrence}</Badge>
```

- [ ] **Step 2: OccasionPrefsEditor component**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Channel, type Occasion } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const STREAM_LABELS: Record<string, string> = {
  event: 'Event (D-… before the date)', yearly: 'Yearly marks', monthly: 'Monthly marks', otonan: 'Otonan marks',
}

export function OccasionPrefsEditor({ contactId, occasion, channels }: {
  contactId: string; occasion: Occasion; channels: Channel[]
}) {
  const qc = useQueryClient()
  const p = occasion.prefs
  const streams: Record<string, number[]> = p?.offsets ?? {}
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/occasions/${occasion.id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to save: ${String(e)}`),
  })
  const reset = useMutation({
    mutationFn: () => api(`/occasions/${occasion.id}/prefs`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to reset: ${String(e)}`),
  })
  return (
    <div className="mt-2 space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Reminders for this occasion</span>
        {p && <Button variant="ghost" size="sm" onClick={() => reset.mutate()}>Reset to inherit</Button>}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          defaultChecked={p?.enabled ?? true}
          onCheckedChange={(v) => save.mutate({
            offsets: streams,
            channel_ids: p?.channel_ids ?? [],
            enabled: v === true,
          })}
        />
        Active
      </label>
      {Object.entries(STREAM_LABELS)
        .filter(([s]) => ['event', 'yearly', 'monthly', 'otonan']
          .filter((x) => streamsFor(occasion.recurrence).includes(x)).includes(s))
        .map(([s, label]) => (
          <div key={s} className="space-y-1">
            <Label>{label}</Label>
            <Input
              defaultValue={(streams[s] ?? []).join(', ')}
              placeholder="inherit"
              onBlur={(e) => {
                const list = e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n))
                save.mutate({ offsets: { ...streams, [s]: list }, channel_ids: p?.channel_ids ?? [], enabled: p?.enabled ?? true })
              }}
              className="max-w-xs"
            />
          </div>
        ))}
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => (
          <label key={ch.id} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-sm">
            <Checkbox
              defaultChecked={p?.channel_ids.includes(ch.id) ?? false}
              onCheckedChange={(v) => {
                const cur = new Set(p?.channel_ids ?? [])
                if (v === true) cur.add(ch.id)
                else cur.delete(ch.id)
                save.mutate({ offsets: streams, channel_ids: [...cur], enabled: p?.enabled ?? true })
              }}
            />
            {ch.name}
          </label>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">Empty = inherit from contact defaults.</p>
    </div>
  )
}

function streamsFor(rec: Occasion['recurrence']): string[] {
  switch (rec) {
    case 'once': return ['event']
    case 'yearly': return ['event', 'yearly']
    case 'monthly': return ['event', 'monthly']
    case 'anniversary': return ['event', 'yearly', 'monthly']
    case 'otonan': return ['otonan']
  }
}
```

Mount it under each occasion row in the page variant: wrap each row in a `div` and render `<OccasionPrefsEditor contactId={c.id} occasion={o} channels={channels.data?.channels ?? []} />` beneath it (page variant only; the docked panel stays read-only and shows a `Paused` badge when `o.prefs?.enabled === false`).

- [ ] **Step 3: Contact-level prefs card** — replace the single offsets Input with two (`yearly`, `monthly` via the new `hydratePrefsForm`), save payload `{ offsets: { yearly: parseList(yearly), monthly: parseList(monthly) }, enabled }` where `parseList(s: string)` splits/ints exactly like the old inline code. The "Global default:" line also shows `settings.recurrence_offsets.yearly` and `.monthly` joined as `D-30, D-7…`.

- [ ] **Step 4: Settings page** (`reminder.settings.tsx`) — add a "Recurrence offsets" card with four Inputs (event, yearly, monthly, otonan) hydrated from `settings.recurrence_offsets`, saved inside the existing settings PUT payload.

- [ ] **Step 5: Verify** — `cd web && pnpm run build` → clean. Smoke: `AUTH_MODE=dev make run`, then: add a custom-type occasion with recurrence; toggle an occasion off; confirm the contact list/agenda render monthly marks.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): occasion recurrence form, per-occasion prefs editor, recurrence offsets settings"
```

---

### Task 11: Rollout — README, embedded assets, full verification

**Files:**
- Modify: `README.md`, `internal/api/webroot/*` (regenerated by the web build)

- [ ] **Step 1: README note** — in the Quickstart/environment area add one line: "v0.x breaking change: IDs are now UUIDv7 and occasions gained recurrence — delete your old `data/wimember.db` (schema is incompatible); take a backup first if needed."

- [ ] **Step 2: Rebuild embedded SPA** — `cd web && pnpm install --frozen-lockfile && pnpm run build`, then copy `web/dist` into `internal/api/webroot` exactly the way `make build` does (check the Makefile `web` target — it already runs the pnpm build; run `make build` so the embedded assets refresh).

- [ ] **Step 3: Full verification**

```bash
CGO_ENABLED=0 go test ./... -count=1
AUTH_MODE=dev make run &
sleep 3
curl -s localhost:8080/healthz
curl -s -H 'X-Dev-Email: admin@example.com' localhost:8080/api/v1/contacts
# create a contact, add a custom-type anniversary occasion with a past date,
# POST /api/v1/scheduler/run, verify a "N months" notification was recorded
# in GET /api/v1/upcoming and (with dev telegram creds set) delivered.
kill %1
```

Expected: all green; scheduler run records the expected rows in `notification_log`.

- [ ] **Step 4: Commit + wipe local dev DB (the user resets their data dir)**

```bash
git add README.md internal/api/webroot
git commit -m "chore: uuidv7 + recurrence rollout notes, rebuilt embedded spa"
```

---

## Self-Review

1. **Spec coverage:** §1 schema (T3), offset maps (T3/T5), type free-string (T3/T8), recurrence defaults (T1/T8), one-per-type dropped (T10); §2 engine + streams + labels (T1/T2), notify copy (T7); §3 resolution chain + skip + channels + window + catch-up unchanged (T6, `dueStart`/`late` logic untouched); §4 endpoints + UUID 404 + ownerScope bound params (T4/T8), upcoming stream payloads (T8); §5 frontend (T9/T10); §6 reset + README + devseed (T3/T4/T11); §7 tests distributed per task. Gap check: `NextOccurrence`'s new param — callers were only in domain tests (verified by grep during planning; scheduler/upcoming use `OccurrencesBetween` only).
2. **Placeholder scan:** Task 6 Step 1 test bodies describe fixtures in comments rather than full code — intentional: they must follow each test file's existing fixture helpers, and the assertion cores are spelled out. Everything else carries real code.
3. **Type consistency:** `OffsetMap` lives in domain and is used by store/api/scheduler uniformly; `pathID` returns `(string, bool)` everywhere after T4; `ResolveOccasionStreams` is introduced in domain in T6 (with test) and consumed by T6's scheduler loop and T8's upcoming endpoint — no duplicate resolution logic; `OccasionPrefs` field names match across store/API/TS (`offsets`, `channel_ids`, `enabled`).
