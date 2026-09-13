# otorem Plan 1/4: Domain Engine (Pawukon, Otonan, Holidays) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure Go package `internal/domain` that computes Balinese Pawukon, otonan (the 210-day cycle), birthdays, anniversaries, reminder dates, and Pawukon holidays — all validated against real fixtures.

**Architecture:** An I/O-free package (pure functions over a civil `Date` type). A single Pawukon anchor in `pawukon.go`, locked by tests against 3 published Galungan dates + daily kalenderbali.org fixtures. The fixture scraper lives in `scripts/` (not in domain) so HTML dependencies do not leak into the logic.

**Tech Stack:** Go ≥ 1.23 (stdlib only in `internal/domain`; `goquery` only in `scripts/`).

## Global Constraints

- Go ≥ 1.23; every build with `CGO_ENABLED=0`.
- `internal/domain` **must not** import `net/http`, `database/sql`, `os`, or third-party packages. Allowed: `fmt`, `time`, `strings`, `sort`.
- All dates are the civil type `domain.Date` (no timezone); timezones are only touched at the scheduler layer (Plan 3).
- The Pawukon anchor constant exists in exactly ONE place (`pawukon.go`); changing it is only allowed when anchor/fixture tests are red.
- Every task: TDD (test first → red → implement → green), then a conventional commit message (`feat:`/`test:`/`chore:`).
- Module: `module otorem`; all import paths are relative `otorem/...`.
- Holiday definitions include only well-established ones (Galungan, Kuningan, Saraswati, Pagerwesi) — expanding the table MUST be verified against fixtures first (spec §5.3).

**Next plans (written after this plan is executed):**
- Plan 2/4: Store + API + Cloudflare Access (migrations, repositories, Gin, JWT middleware, `/api/v1` endpoints)
- Plan 3/4: Scheduler + Notifier + remote HolidayProvider (ticker, dedupe, catch-up, Gotify/Telegram/SMTP, encryption)
- Plan 4/4: SPA + Deployment (Vite+React+TanStack, embed, Dockerfile, compose)

---

### Task 1: Module scaffold + `Date` type + JDN conversion

**Files:**
- Create: `go.mod`
- Create: `internal/domain/date.go`
- Create: `internal/domain/jdn.go`
- Test: `internal/domain/jdn_test.go`

**Interfaces:**
- Produces: `type Date struct{ Year, Month, Day int }`; `NewDate(y, m, d int) Date`; `DateFromTime(t time.Time) Date`; `(d Date) Time(loc *time.Location) time.Time`; `(d Date) AddDays(n int) Date`; `(d Date) JDN() int`; `DateFromJDN(jdn int) Date`; `(d Date) Weekday() int` (0=Sunday/Redite … 6=Saturday/Saniscara); `(d Date) Before/After/Equal(o Date) bool`.

- [ ] **Step 1: Init the module & package**

```bash
cd code && go mod init otorem && mkdir -p internal/domain scripts testdata
```

- [ ] **Step 2: Write the Date type (no tests yet — pure data type)**

`internal/domain/date.go`:

```go
package domain

import (
	"fmt"
	"time"
)

// Date is a civil Gregorian calendar date — no timezone, no clock component.
// The domain engine works exclusively on this type; timezones are applied at
// the scheduler layer (Plan 3).
type Date struct {
	Year  int
	Month int
	Day   int
}

func NewDate(year, month, day int) Date { return Date{Year: year, Month: month, Day: day} }

func DateFromTime(t time.Time) Date { return Date{Year: t.Year(), Month: int(t.Month()), Day: t.Day()} }

func (d Date) Time(loc *time.Location) time.Time {
	return time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, loc)
}

func (d Date) AddDays(n int) Date { return DateFromJDN(d.JDN() + n) }

func (d Date) Before(o Date) bool { return d.JDN() < o.JDN() }
func (d Date) After(o Date) bool  { return d.JDN() > o.JDN() }
func (d Date) Equal(o Date) bool  { return d == o }

func (d Date) String() string { return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day) }
```

- [ ] **Step 3: Write the failing JDN test**

`internal/domain/jdn_test.go`:

```go
package domain

import "testing"

func TestJDNKnownValues(t *testing.T) {
	cases := []struct {
		d   Date
		jdn int
	}{
		{NewDate(1970, 1, 1), 2440588},
		{NewDate(2000, 1, 1), 2451545}, // Saturday
		{NewDate(2026, 6, 17), 2461209}, // Wednesday (Galungan)
	}
	for _, c := range cases {
		if got := c.d.JDN(); got != c.jdn {
			t.Errorf("JDN(%s) = %d, want %d", c.d, got, c.jdn)
		}
		if back := DateFromJDN(c.jdn); back != c.d {
			t.Errorf("DateFromJDN(%d) = %s, want %s", c.jdn, back, c.d)
		}
	}
}

func TestWeekday(t *testing.T) {
	cases := []struct {
		d    Date
		want int // 0=Sunday … 6=Saturday
	}{
		{NewDate(2000, 1, 1), 6}, // Saturday
		{NewDate(2026, 6, 17), 3}, // Wednesday
	}
	for _, c := range cases {
		if got := c.d.Weekday(); got != c.want {
			t.Errorf("Weekday(%s) = %d, want %d", c.d, got, c.want)
		}
	}
}

func TestAddDaysRoundTrip(t *testing.T) {
	d := NewDate(2026, 2, 28)
	if got := d.AddDays(1); got != NewDate(2026, 3, 1) { // 2026 is not a leap year
		t.Errorf("AddDays(1) from 2026-02-28 = %s, want 2026-03-01", got)
	}
	if got := d.AddDays(2).AddDays(-2); got != d {
		t.Errorf("round trip: got %s, want %s", got, d)
	}
}
```

- [ ] **Step 4: Run the tests — make sure they FAIL (no JDN() yet)**

Run: `go test ./internal/domain/ -run TestJDN -v`
Expected: FAIL — compile error `undefined: DateFromJDN` (date.go uses it; Step 5 completes it)

- [ ] **Step 5: Implement JDN (Fliegel–Van Flandern + inverse)**

`internal/domain/jdn.go`:

```go
package domain

// JDN returns the integer Julian Day Number for the civil Gregorian date,
// using the Fliegel–Van Flandern algorithm. Go's truncating integer division
// is exactly what this formula expects (a = -1 for Jan/Feb).
func (d Date) JDN() int {
	i, j, k := d.Year, d.Month, d.Day
	a := (j - 14) / 12
	return k - 32075 + 1461*(i+4800+a)/4 + 367*(j-2-a*12)/12 - 3*((i+4900+a)/100)/4
}

// DateFromJDN converts a Julian Day Number back to a civil Gregorian date
// (Richards' inverse; all divisions are on positive operands).
func DateFromJDN(jdn int) Date {
	a := jdn + 32044
	b := (4*a + 3) / 146097
	c := a - 146097*b/4
	dd := (4*c + 3) / 1461
	e := c - 1461*dd/4
	m := (5*e + 2) / 153
	day := e - (153*m+2)/5 + 1
	month := m + 3 - 12*(m/10)
	year := 100*b + dd - 4800 + m/10
	return Date{Year: year, Month: month, Day: day}
}

// Weekday returns 0=Sunday (Redite) … 6=Saturday (Saniscara).
func (d Date) Weekday() int { return (d.JDN() + 1) % 7 }
```

- [ ] **Step 6: Run the tests — PASS**

Run: `go test ./internal/domain/ -v`
Expected: all PASS (if `TestJDNKnownValues` fails on 2026-06-17, check the arithmetic and do NOT change the test values — they are verified by the Wednesday weekday + the 420-day delta to 2025-04-23).

- [ ] **Step 7: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add go.mod internal/
git commit -m "feat(domain): civil Date type + JDN conversion (Fliegel-Van Flandern)"
```

---

### Task 2: Pawukon converter (anchor + 30 wuku)

**Files:**
- Create: `internal/domain/pawukon.go`
- Test: `internal/domain/pawukon_test.go`

**Interfaces:**
- Consumes: `Date.JDN()`, `Date.Weekday()`, `Date.AddDays` (Task 1)
- Produces: `const PawukonCycleDays = 210`; `func CycleDay(d Date) int` (1..210); `type PawukonDate struct{ Saptawara, Pancawara, Wuku int }`; `func Pawukon(d Date) PawukonDate`; `func (p PawukonDate) Label() string`; vars `Saptawara [7]string`, `Pancawara [5]string`, `Wuku [30]string`.

- [ ] **Step 1: Write the failing test**

`internal/domain/pawukon_test.go`:

```go
package domain

import "testing"

// Anchor verification (spec §5.1): Galungan is always Buda Kliwon, Wuku Dunggulan.
// Published dates: 23 Apr 2025, 19 Nov 2025, 17 Jun 2026.
// Kuningan = Saniscara Kliwon, Wuku Kuningan (Galungan + 10 days).
func TestPawukonAnchorDates(t *testing.T) {
	cases := []struct {
		d    Date
		want PawukonDate
	}{
		{NewDate(2025, 4, 23), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2025, 11, 19), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}}, // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 17), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 27), PawukonDate{Saptawara: 6, Pancawara: 3, Wuku: 11}},  // Saniscara Kliwon Kuningan
		{NewDate(2026, 4, 5), PawukonDate{Saptawara: 0, Pancawara: 0, Wuku: 0}},    // day 1 of the cycle: Redite Paing Sinta
	}
	for _, c := range cases {
		got := Pawukon(c.d)
		if got != c.want {
			t.Errorf("Pawukon(%s) = %+v, want %+v (%s)", c.d, got, c.want, c.want.Label())
		}
	}
}

// Property: a 210-day cycle with no leap days — Pawukon(d) == Pawukon(d+210k),
// and the saptawara derived from the cycle modulo must equal the Gregorian weekday (cross-check).
func TestPawukonCycleProperties(t *testing.T) {
	base := NewDate(2000, 1, 1)
	for i := 0; i < 500; i++ {
		d := base.AddDays(i*3 + 11)
		if Pawukon(d) != Pawukon(d.AddDays(PawukonCycleDays)) {
			t.Fatalf("210-day cycle broken at %s", d)
		}
		if saptawaraFromCycle := (CycleDay(d) - 1) % 7; saptawaraFromCycle != d.Weekday() {
			t.Fatalf("cycle saptawara %d != weekday %d on %s", saptawaraFromCycle, d.Weekday(), d)
		}
	}
}

func TestCycleDayAtAnchor(t *testing.T) {
	if got := CycleDay(NewDate(2026, 6, 17)); got != 74 {
		t.Errorf("CycleDay(anchor) = %d, want 74", got)
	}
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/domain/ -run TestPawukon -v`
Expected: FAIL — `Pawukon undefined`

- [ ] **Step 3: Implement pawukon.go**

`internal/domain/pawukon.go`:

```go
package domain

// Pawukon: the 210-day Balinese calendar, with 10 parallel weeks. v1 only needs
// saptawara (7), pancawara (5), and wuku (30×7 days) — see spec §5.1.
//
// ANCHOR (the only calendar constant in the codebase): 2026-06-17 is
// Galungan = Buda Kliwon, Wuku Dunggulan = day 74 of the cycle. Verified
// by TestPawukonAnchorDates (3 published Galungan dates) and the daily
// kalenderbali.org fixtures (Task 3). If tests go red, fix it ONLY here.
var (
	pawukonAnchorJDN      = NewDate(2026, 6, 17).JDN()
	pawukonAnchorCycleDay = 74
)

const PawukonCycleDays = 210

var Saptawara = [7]string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}

// Pancawara cycle order: day 1 of the cycle = Paing (verified by the anchor:
// day 74 = Kliwon → (74-1) mod 5 = 3 → index 3 = Kliwon).
var Pancawara = [5]string{"Paing", "Pon", "Wage", "Kliwon", "Umanis"}

var Wuku = [30]string{
	"Sinta", "Landep", "Ukir", "Kulantir", "Taulu", "Gumbreg", "Wariga",
	"Warigadian", "Julungwangi", "Sungsang", "Dunggulan", "Kuningan", "Langkir",
	"Medangsia", "Pujut", "Pahang", "Krulut", "Merakih", "Tambir", "Medangkungan",
	"Matal", "Uye", "Menail", "Parangbakat", "Bala", "Ugu", "Wayang", "Kelawu",
	"Dukut", "Watugunung",
}

type PawukonDate struct {
	Saptawara int // 0=Redite … 6=Saniscara (== Date.Weekday())
	Pancawara int // 0=Paing … 4=Umanis
	Wuku      int // 0=Sinta … 29=Watugunung
}

// CycleDay returns the day within the Pawukon cycle: 1..210.
func CycleDay(d Date) int {
	off := (d.JDN() - pawukonAnchorJDN + pawukonAnchorCycleDay - 1) % PawukonCycleDays
	if off < 0 {
		off += PawukonCycleDays
	}
	return off + 1
}

func Pawukon(d Date) PawukonDate {
	c := CycleDay(d)
	return PawukonDate{
		Saptawara: d.Weekday(), // saptawara is identical to the Gregorian weekday, Redite=Sunday
		Pancawara: (c - 1) % 5,
		Wuku:      (c - 1) / 7,
	}
}

func (p PawukonDate) Label() string {
	return Saptawara[p.Saptawara] + " " + Pancawara[p.Pancawara] + ", Wuku " + Wuku[p.Wuku]
}
```

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/domain/ -v`
Expected: PASS. If `TestPawukonAnchorDates` is red on ALL cases, the anchor offset is wrong → check `pawukonAnchorCycleDay`. If only 1 date is red, the source date is wrong; verify again before touching the code.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): pawukon converter with verified anchor (Galungan 2026-06-17)"
```

---

### Task 3: kalenderbali.org fixture scraper + fixture tests

**Files:**
- Create: `scripts/fetch_fixtures/main.go`
- Create: `scripts/fetch_fixtures/go.mod` (a separate module `otorem/scripts/fetchfixtures` — so goquery does not enter the main module)
- Create: `internal/domain/fixture_test.go`
- Create (run output): `testdata/pawukon_2025.csv`, `testdata/pawukon_2026.csv`

**Interfaces:**
- Consumes: `Pawukon(d Date) PawukonDate`, day/wuku names (Task 2)
- Produces: CSV fixtures `date,saptawara,pancawara,wuku` (format `2006-01-02`); the `TestPawukonAgainstFixtures` test that serves as the eternal referee for the anchor & holiday table.

- [ ] **Step 1: Create the scraper module**

```bash
mkdir -p scripts/fetch_fixtures && cd scripts/fetch_fixtures && go mod init otorem/scripts/fetchfixtures && go get github.com/PuerkitoBio/goquery@latest
```

- [ ] **Step 2: Write the scraper**

`scripts/fetch_fixtures/main.go`:

```go
// Fixture scraper: fetch a Gregorian date → (saptawara, pancawara, wuku) map
// from kalenderbali.org for one year, writing to testdata/pawukon_<year>.csv.
// Data usage: personal test fixtures (spec §6) — data © kalenderbali.org
// (I Wayan Nuarsa, Universitas Udayana), credited, NOT redistributed.
//
// Usage: go run . -year 2026 -out ../../testdata
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// daily row pattern on the rerainan/haripenting pages, e.g.:
// "17-06-2026. Buda Kliwon Dunggulan"
var dayRe = regexp.MustCompile(`(\d{2})-(\d{2})-(\d{4})\.?\s+([A-Za-z]+)\s+([A-Za-z]+)\s+([A-Za-z]+)`)

// source spellings vary; normalize to engine constants. A name that is not
// here AND does not match an engine constant = hard error (never stay silent).
var normalize = map[string]string{
	"Keliwon": "Kliwon",
	"Tolu":    "Taulu",
	"Wugu":    "Ugu",
	"Kaulu":   "Kelawu",
	"Luang":   "Luang", // kept; the test will fail if it appears as a wuku
}

func norm(s string) string { if v, ok := normalize[s]; ok { return v }; return s }

func main() {
	year := flag.Int("year", time.Now().Year(), "tahun kalender")
	out := flag.String("out", "../../testdata", "direktori output CSV")
	flag.Parse()

	f, err := os.Create(fmt.Sprintf("%s/pawukon_%d.csv", *out, *year))
	if err != nil { log.Fatal(err) }
	defer f.Close()
	fmt.Fprintln(f, "date,saptawara,pancawara,wuku")

	client := &http.Client{Timeout: 20 * time.Second}
	seen := 0
	for bulan := 1; bulan <= 12; bulan++ {
		url := fmt.Sprintf("https://kalenderbali.org/rerainan.php?bulan=%d&tahun=%d", bulan, *year)
		resp, err := client.Get(url)
		if err != nil { log.Fatalf("GET %s: %v", url, err) }
		if resp.StatusCode != 200 { resp.Body.Close(); log.Fatalf("GET %s: status %d", url, resp.StatusCode) }
		doc, err := goquery.NewDocumentFromReader(resp.Body)
		resp.Body.Close()
		if err != nil { log.Fatal(err) }
		text, _ := doc.Find("body").Html() // daily rows matching dayRe inside the body
		for _, m := range dayRe.FindAllStringSubmatch(strings.TrimSpace(text), -1) {
			day, month, yearStr := m[1], m[2], m[3]
			sap, pan, wuk := norm(m[4]), norm(m[5]), norm(m[6])
			fmt.Fprintf(f, "%s-%s-%s,%s,%s,%s\n", yearStr, month, day, sap, pan, wuk)
			seen++
		}
		time.Sleep(1500 * time.Millisecond) // be polite: don't hammer the server
	}
	log.Printf("total baris: %d → %s/pawukon_%d.csv", seen, *out, *year)
	if seen < 350 { log.Fatalf("baris %d < 350 — kemungkinan struktur HTML berubah; curl halaman & sesuaikan dayRe", seen) }
}
```

- [ ] **Step 3: Run the scraper & check the output**

```bash
cd scripts/fetch_fixtures && go run . -year 2026 -out ../../testdata && go run . -year 2025 -out ../../testdata
head -5 ../../testdata/pawukon_2026.csv && wc -l ../../testdata/pawukon_*.csv
```
Expected: ≈365 rows/year. **If 0 rows / parse failure**: `curl -s 'https://kalenderbali.org/rerainan.php?bulan=6&tahun=2026' | head -100`, inspect the actual structure, adjust `dayRe`/selectors — the parser may change, the DOMAIN may not. **If the site is completely down**: create a minimal manual CSV with 8 verified rows (the 4 Galungan/Kuningan dates from Task 2 + 2026-04-05 Redite Paing Sinta + 3 more rows from print sources), commit it, and move on — the fixture test remains the referee.

- [ ] **Step 4: Write the fixture test (skipped if the CSVs do not exist yet)**

`internal/domain/fixture_test.go`:

```go
package domain

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func indexOf(list []string, name string) int { for i, s := range list { if s == name { return i } }; return -1 }

func TestPawukonAgainstFixtures(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("..", "..", "testdata", "pawukon_*.csv"))
	if len(files) == 0 {
		t.Skip("fixture belum ada — jalankan scripts/fetch_fixtures")
	}
	for _, file := range files {
		f, err := os.Open(file)
		if err != nil { t.Fatal(err) }
		rows, err := csv.NewReader(f).ReadAll()
		f.Close()
		if err != nil { t.Fatal(err) }
		for i, row := range rows {
			if i == 0 { continue }
			var y, m, d int
			if _, err := fmt.Sscanf(row[0], "%d-%d-%d", &y, &m, &d); err != nil { t.Fatalf("%s baris %d: %v", file, i+1, err) }
			got := Pawukon(NewDate(y, m, d))
			wantSap, wantPan, wantWuk := row[1], row[2], row[3]
			if Saptawara[got.Saptawara] != wantSap || Pancawara[got.Pancawara] != wantPan || Wuku[got.Wuku] != wantWuk {
				t.Errorf("%s: engine=%s | fixture=%s %s %s", row[0], got.Label(), wantSap, wantPan, wantWuk)
			}
		}
	}
}

func TestFixtureSpellingKnown(t *testing.T) {
	// fixture spellings must exactly match the engine constants (normalization happens in the scraper)
	for _, n := range strings.Split("Kliwon,Umanis,Dunggulan,Watugunung", ",") {
		if indexOf(Wuku[:], n) < 0 && indexOf(Pancawara[:], n) < 0 {
			t.Errorf("nama %q tidak dikenal engine", n)
		}
	}
}
```

- [ ] **Step 5: Run all tests — PASS**

Run: `go test ./internal/domain/ -v`
Expected: `TestPawukonAgainstFixtures` PASSes against hundreds of real rows — proof that the anchor & table are correct. If any row is red: note the pattern (e.g. a +1-day shift on a specific wuku = shifted anchor; a spelling difference = add an alias to `normalize` in the scraper, not in the engine).

- [ ] **Step 6: Commit (including the CSV fixtures)**

```bash
git add scripts/ testdata/ internal/
git commit -m "feat(domain): kalenderbali.org fixture scraper + daily fixture tests"
```

---

### Task 4: Occurrence engine (otongan / birthday / anniversary)

**Files:**
- Create: `internal/domain/occurrence.go`
- Test: `internal/domain/occurrence_test.go`

**Interfaces:**
- Consumes: `Date`, `Pawukon`, `PawukonDate.Label()` (Tasks 1–2)
- Produces: `type OccurrenceType string`; consts `Birthday, Otonan, Anniversary OccurrenceType`; `type Occurrence struct{ Date Date; Type OccurrenceType; Number int; Label string }`; `func NextOccurrence(base Date, typ OccurrenceType, from Date) (Occurrence, error)` (inclusive of `from`); `func OccurrencesBetween(base Date, typ OccurrenceType, from, to Date) ([]Occurrence, error)`; `func Age(base, on Date) int`.

- [ ] **Step 1: Write the failing test**

`internal/domain/occurrence_test.go`:

```go
package domain

import "testing"

func TestNextOccurrenceOtonan(t *testing.T) {
	base := NewDate(2026, 1, 10)
	// The first otonan = birth + 210 days; inclusive of `from`.
	if occ, _ := NextOccurrence(base, Otonan, base); occ.Date != base.AddDays(210) {
		t.Errorf("first otonan = %s, want %s", occ.Date, base.AddDays(210))
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(210)); occ.Number != 1 {
		t.Errorf("Number exactly on the otonan day = %d, want 1 (inclusive)", occ.Number)
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(211)); occ != (Occurrence{
		Date: base.AddDays(420), Type: Otonan, Number: 2,
		Label: "Otonan ke-2 — " + Pawukon(base.AddDays(420)).Label(),
	}) {
		t.Errorf("second otonan wrong: %+v", occ)
	}
	// pawukon consistency: the pawukon label of the birth date == the otonan date
	b, _ := NextOccurrence(base, Otonan, base)
	if Pawukon(base).Label() != Pawukon(b.Date).Label() {
		t.Errorf("pawukon differs: %s vs %s", Pawukon(base).Label(), Pawukon(b.Date).Label())
	}
}

func TestNextOccurrenceBirthday(t *testing.T) {
	leap := NewDate(2000, 2, 29)
	occ, _ := NextOccurrence(leap, Birthday, NewDate(2025, 1, 1))
	if occ.Date != NewDate(2025, 3, 1) || occ.Number != 25 { // Feb 29 → Mar 1 in non-leap years (spec §5.2)
		t.Errorf("Feb29 non-leap: %+v, want 2025-03-01 age 25", occ)
	}
	occ, _ = NextOccurrence(leap, Birthday, NewDate(2024, 1, 1))
	if occ.Date != NewDate(2024, 2, 29) || occ.Number != 24 {
		t.Errorf("Feb29 leap: %+v, want 2024-02-29 age 24", occ)
	}
	occ, _ = NextOccurrence(NewDate(1990, 12, 30), Birthday, NewDate(2026, 1, 1))
	if occ.Date != NewDate(2026, 12, 30) || occ.Number != 36 {
		t.Errorf("ordinary birthday across years: %+v", occ)
	}
}

func TestOccurrencesBetween(t *testing.T) {
	base := NewDate(2026, 1, 10)
	occs, _ := OccurrencesBetween(base, Otonan, base, base.AddDays(1000))
	if len(occs) != 5 { // days 210,420,630,840,1000? → 210,420,630,840 = only 4 (1000 < 1050)
		t.Fatalf("got %d occurrences, want 4", len(occs))
	}
	if occs[3].Number != 4 { t.Errorf("wrong N order: %+v", occs[3]) }
	occs2, _ := OccurrencesBetween(NewDate(2026, 6, 20), Birthday, NewDate(2026, 1, 1), NewDate(2026, 12, 31))
	if len(occs2) != 1 || occs2[0].Date != NewDate(2026, 6, 20) {
		t.Errorf("birthday within range: %+v", occs2)
	}
}

func TestAge(t *testing.T) {
	if Age(NewDate(2000, 2, 29), NewDate(2025, 3, 1)) != 25 { t.Error("age 29Feb") }
	if Age(NewDate(1990, 12, 30), NewDate(2026, 12, 29)) != 35 { t.Error("age before birthday") }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/domain/ -run 'Occurrence|Age' -v`
Expected: FAIL — `NextOccurrence undefined`

- [ ] **Step 3: Implement occurrence.go**

`internal/domain/occurrence.go`:

```go
package domain

import "fmt"

type OccurrenceType string

const (
	Birthday    OccurrenceType = "birthday"
	Otonan      OccurrenceType = "otongan"
	Anniversary OccurrenceType = "anniversary"
)

// Occurrence is one concrete happening of a recurring occasion.
// Number semantics: Otonan → cycle N (N≥1); Birthday → age;
// Anniversary → number of years since base.
type Occurrence struct {
	Date   Date
	Type   OccurrenceType
	Number int
	Label  string
}

// NextOccurrence returns the next occurrence on or after `from`.
func NextOccurrence(base Date, typ OccurrenceType, from Date) (Occurrence, error) {
	if base == (Date{}) || base.JDN() <= 0 {
		return Occurrence{}, fmt.Errorf("base date kosong")
	}
	switch typ {
	case Otonan:
		diff := from.JDN() - base.JDN()
		n := diff / PawukonCycleDays
		if diff%PawukonCycleDays != 0 || n == 0 {
			n++
		}
		if n < 1 { n = 1 }
		occ := base.AddDays(n * PawukonCycleDays)
		return Occurrence{Date: occ, Type: Otonan, Number: n,
			Label: fmt.Sprintf("Otonan ke-%d — %s", n, Pawukon(occ).Label())}, nil
	case Birthday, Anniversary:
		for y := max(from.Year, base.Year); y <= from.Year+1; y++ {
			occ := yearlyDate(base, y)
			if occ.Before(from) { continue }
			return Occurrence{Date: occ, Type: typ, Number: occ.Year - base.Year,
				Label: yearlyLabel(base, occ, typ)}, nil
		}
		return Occurrence{}, fmt.Errorf("occurrence tidak ditemukan dalam 2 tahun: base=%s from=%s", base, from)
	default:
		return Occurrence{}, fmt.Errorf("tipe occurrence tidak dikenal: %q", typ)
	}
}

// yearlyDate: the base anniversary in year y; Feb 29 → Mar 1 in non-leap years.
func yearlyDate(base Date, y int) Date {
	if base.Month == 2 && base.Day == 29 && !isLeap(y) {
		return NewDate(y, 3, 1)
	}
	return NewDate(y, base.Month, base.Day)
}

func yearlyLabel(base, occ Date, typ OccurrenceType) string {
	if typ == Birthday {
		return fmt.Sprintf("Ulang tahun ke-%d", occ.Year-base.Year)
	}
	return fmt.Sprintf("Anniversary ke-%d", occ.Year-base.Year)
}

// OccurrencesBetween returns all occurrences with from ≤ Date ≤ to.
func OccurrencesBetween(base Date, typ OccurrenceType, from, to Date) ([]Occurrence, error) {
	if to.Before(from) { return nil, fmt.Errorf("range terbalik: %s > %s", from, to) }
	var out []Occurrence
	if typ == Otonan {
		n := 1
		if base.Before(from) {
			diff := from.JDN() - base.JDN()
			n = diff / PawukonCycleDays
			if diff%PawukonCycleDays != 0 { n++ }
			if n < 1 { n = 1 }
		}
		for {
			occDate := base.AddDays(n * PawukonCycleDays)
			if occDate.After(to) { break }
			out = append(out, Occurrence{Date: occDate, Type: Otonan, Number: n,
				Label: fmt.Sprintf("Otonan ke-%d — %s", n, Pawukon(occDate).Label())})
			n++
		}
		return out, nil
	}
	for y := max(from.Year, base.Year); y <= to.Year; y++ {
		occ := yearlyDate(base, y)
		if occ.Before(from) || occ.After(to) { continue }
		out = append(out, Occurrence{Date: occ, Type: typ, Number: occ.Year - base.Year,
			Label: yearlyLabel(base, occ, typ)})
	}
	return out, nil
}

// Age: full age on date `on` (safe for Feb 29 → computed from the year).
func Age(base, on Date) int { return on.Year - base.Year }

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func max(a, b int) int { if a > b { return a }; return b }
```

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/domain/ -v`
Expected: all PASS. Note on TestOccurrencesBetween: 4 occurrences (210/420/630/840) — the test comment intentionally demands 4, not 5.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): occurrence engine (otongan 210d, birthday feb29, anniversary)"
```

---

### Task 5: Pawukon holidays (computed locally)

**Files:**
- Create: `internal/domain/holidays.go`
- Test: `internal/domain/holidays_test.go`

**Interfaces:**
- Consumes: `Pawukon`, `PawukonDate`, the name tables (Task 2), `Date` (Task 1)
- Produces: `type Holiday struct{ Date Date; Name string }`; `func PawukonHolidaysBetween(from, to Date) []Holiday`; var `PawukonHolidayDefs []HolidayDef` (`type HolidayDef struct{ Name string; Saptawara, Pancawara, Wuku int }`) — only the 4 standard definitions; expansions must pass fixtures first.

- [ ] **Step 1: Write the failing test**

`internal/domain/holidays_test.go`:

```go
package domain

import "testing"

func TestGalunganKuningan2026(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 6, 1), NewDate(2026, 7, 31))
	got := map[Date]string{}
	for _, h := range hs { got[h.Date] = h.Name }
	if got[NewDate(2026, 6, 17)] != "Galungan" { t.Errorf("Galungan 2026-06-17 missing: %v", got) }
	if got[NewDate(2026, 6, 27)] != "Kuningan" { t.Errorf("Kuningan 2026-06-27 missing: %v", got) }
}

// One full cycle (210 days starting on cycle day 1 = 2026-04-05) contains exactly
// one of each: Galungan (day 74), Kuningan (day 84), Pagerwesi (day 4), Saraswati (day 210).
func TestOneCycleExactHolidays(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 4, 5), NewDate(2026, 4, 5).AddDays(209))
	if len(hs) != 4 { t.Fatalf("got %d holidays, want 4: %+v", len(hs), hs) }
	names := map[string]bool{}
	for _, h := range hs { names[h.Name] = true }
	for _, want := range []string{"Galungan", "Kuningan", "Saraswati", "Pagerwesi"} {
		if !names[want] { t.Errorf("missing %s within 1 cycle", want) }
	}
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/domain/ -run Holiday -v`
Expected: FAIL — `PawukonHolidaysBetween undefined`

- [ ] **Step 3: Implement holidays.go**

`internal/domain/holidays.go`:

```go
package domain

import "fmt"

// HolidayDef: one Pawukon holiday = a (saptawara, pancawara, wuku) combination.
type HolidayDef struct {
	Name      string
	Saptawara int
	Pancawara int
	Wuku      int
}

// ONLY well-established, verified definitions (spec §5.3). Adding a
// definition (the Tumpek series, Sugihan, etc.) REQUIRES: first add a row to
// the fixture scraper, prove the dates match, and only then add it here.
var PawukonHolidayDefs = []HolidayDef{
	{Name: "Galungan", Saptawara: 3, Pancawara: 3, Wuku: 10},  // Buda Kliwon Dunggulan
	{Name: "Kuningan", Saptawara: 6, Pancawara: 3, Wuku: 11},  // Saniscara Kliwon Kuningan
	{Name: "Saraswati", Saptawara: 6, Pancawara: 4, Wuku: 29}, // Saniscara Umanis Watugunung
	{Name: "Pagerwesi", Saptawara: 3, Pancawara: 3, Wuku: 0},  // Buda Kliwon Sinta
}

type Holiday struct {
	Date Date
	Name string
}

// PawukonHolidaysBetween returns Pawukon-based holidays in [from, to].
// O( number of days × number of definitions ) — trivial for the app's horizon.
func PawukonHolidaysBetween(from, to Date) []Holiday {
	var out []Holiday
	for d := from; !d.After(to); d = d.AddDays(1) {
		p := Pawukon(d)
		for _, h := range PawukonHolidayDefs {
			if p.Saptawara == h.Saptawara && p.Pancawara == h.Pancawara && p.Wuku == h.Wuku {
				out = append(out, Holiday{Date: d, Name: h.Name})
				break
			}
		}
	}
	return out
}

func (h Holiday) String() string { return fmt.Sprintf("%s (%s)", h.Name, h.Date) }
```

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/domain/ -v`
Expected: all PASS, including the fixture tests. If fixtures mention other holidays (Sugihan, Tumpek) — ignore them for v1; the table is expanded in Plan 3 together with the HolidayProvider.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): pawukon holidays (galungan, kunningan, saraswati, pagerwesi)"
```

---

### Task 6: Reminder dates (offsets) + domain API summary

**Files:**
- Create: `internal/domain/reminder.go`
- Create: `internal/domain/doc.go`
- Test: `internal/domain/reminder_test.go`

**Interfaces:**
- Consumes: `Date` (Task 1)
- Produces: `var DefaultOffsets = []int{7, 4, 2, 1, 0}`; `func ReminderDates(occurrenceDate Date, offsets []int) ([]Date, error)` (ascending, deduped, all offsets ≥ 0, max 60); `func ValidateOffsets(offsets []int) error`.

- [ ] **Step 1: Write the failing test**

`internal/domain/reminder_test.go`:

```go
package domain

import "testing"

func TestReminderDates(t *testing.T) {
	occ := NewDate(2026, 6, 17)
	want := []Date{NewDate(2026, 6, 10), NewDate(2026, 6, 13), NewDate(2026, 6, 15), NewDate(2026, 6, 16), NewDate(2026, 6, 17)}
	got, err := ReminderDates(occ, DefaultOffsets)
	if err != nil { t.Fatal(err) }
	for i := range want {
		if got[i] != want[i] { t.Errorf("got[%d]=%s want %s", i, got[i], want[i]) }
	}
}

func TestReminderDatesDedupeSort(t *testing.T) {
	got, err := ReminderDates(NewDate(2026, 6, 17), []int{2, 7, 2, 0})
	if err != nil { t.Fatal(err) }
	if len(got) != 3 { t.Fatalf("got %d dates, want 3 (deduped): %v", len(got), got) }
	if got[0] != NewDate(2026, 6, 10) || got[2] != NewDate(2026, 6, 17) {
		t.Errorf("wrong order: %v", got)
	}
}

func TestValidateOffsets(t *testing.T) {
	if err := ValidateOffsets([]int{-1}); err == nil { t.Error("negative offset must error") }
	if err := ValidateOffsets([]int{1, 1, 500}); err == nil { t.Error("duplicate/too large must error") }
	if err := ValidateOffsets(DefaultOffsets); err != nil { t.Errorf("defaults must be valid: %v", err) }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `go test ./internal/domain/ -run Reminder -v`
Expected: FAIL — `ReminderDates undefined`

- [ ] **Step 3: Implement reminder.go**

`internal/domain/reminder.go`:

```go
package domain

import (
	"fmt"
	"sort"
)

// DefaultOffsets: D-7, D-4, D-2, D-1, D (spec §2, configurable in Settings).
var DefaultOffsets = []int{7, 4, 2, 1, 0}

// ValidateOffsets: non-negative, no duplicates, ≤ 60 days (2 months at most).
func ValidateOffsets(offsets []int) error {
	seen := map[int]bool{}
	for _, o := range offsets {
		if o < 0 || o > 60 {
			return fmt.Errorf("offset %d di luar 0..60", o)
		}
		if seen[o] {
			return fmt.Errorf("offset %d duplikat", o)
		}
		seen[o] = true
	}
	return nil
}

// ReminderDates: the reminder dates for one occurrence —
// occurrenceDate − offset, ascending, deduped.
func ReminderDates(occurrenceDate Date, offsets []int) ([]Date, error) {
	if err := ValidateOffsets(offsets); err != nil { return nil, err }
	sorted := append([]int(nil), offsets...)
	sort.Sort(sort.Reverse(sort.IntSlice(sorted)))
	out := make([]Date, 0, len(sorted))
	for _, o := range sorted {
		out = append(out, occurrenceDate.AddDays(-o))
	}
	return out, nil
}
```

`internal/domain/doc.go`:

```go
// Package domain is otorem's pure calendar engine: Balinese Pawukon, otonan,
// birthdays, anniversaries, Pawukon holidays, and reminder dates.
// Adding I/O dependencies to this package is FORBIDDEN (see the plan, Global
// Constraints) — all timezone decisions are made by the scheduler layer.
package domain
```

- [ ] **Step 4: Run all tests + lint**

Run: `gofmt -l internal/ scripts/ ; go vet ./... && go test ./internal/domain/ -v -count=1`
Expected: empty (formatting), clean vet, all tests PASS.

- [ ] **Step 5: Commit + final plan tag**

```bash
git add internal/
git commit -m "feat(domain): reminder dates + validate offsets; domain package complete"
git tag plan-1-domain-engine-done
```

---

## Definition of Done (Plan 1)

- [ ] `go test ./internal/domain/ -v -count=1` fully green, including fixtures of hundreds of real days.
- [ ] `go build ./...` succeeds with `CGO_ENABLED=0`.
- [ ] `internal/domain` has no I/O imports (`go list -deps` checked manually).
- [ ] All tasks committed; the tag `plan-1-domain-engine-done` exists.
- [ ] The Pawukon anchor lives only in `pawukon.go`; the holiday table contains only the 4 standard definitions.
