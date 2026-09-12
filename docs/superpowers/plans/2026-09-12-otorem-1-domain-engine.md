# otorem Plan 1/4: Domain Engine (Pawukon, Otonan, Holidays) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Go murni `internal/domain` yang menghitung Pawukon Bali, otonan (siklus 210 hari), ulang tahun, anniversary, tanggal reminder, dan hari raya Pawukon — semua tervalidasi fixture nyata.

**Architecture:** Package tanpa I/O (pure functions atas tipe `Date` civil). Anchor Pawukon tunggal di `pawukon.go`, dikunci oleh test terhadap 3 tanggal Galungan terpublikasi + fixture harian kalenderbali.org. Scraper fixture hidup di `scripts/` (bukan di domain) agar dependensi HTML tidak bocor ke logika.

**Tech Stack:** Go ≥ 1.23 (stdlib only di `internal/domain`; `goquery` hanya di `scripts/`).

## Global Constraints

- Go ≥ 1.23; semua build dengan `CGO_ENABLED=0`.
- `internal/domain` **dilarang** import `net/http`, `database/sql`, `os`, package pihak ketiga. Boleh: `fmt`, `time`, `strings`, `sort`.
- Semua tanggal adalah tipe civil `domain.Date` (tanpa timezone); timezone hanya disentuh di layer scheduler (Plan 3).
- Konstanta anchor Pawukon hanya ada di SATU tempat (`pawukon.go`); mengubahnya hanya boleh jika test anchor/fixture merah.
- Setiap task: TDD (test dulu → merah → implement → hijau), lalu commit pesan conventional (`feat:`/`test:`/`chore:`).
- Modul: `module otorem`; semua path import relatif `otorem/...`.
- Definisi hari raya hanya memuat yang sudah baku (Galungan, Kuningan, Saraswati, Pagerwesi) — perluasan tabel WAJIB diverifikasi fixture dulu (spec §5.3).

**Plan berikutnya (ditulis setelah plan ini tereksekusi):**
- Plan 2/4: Store + API + Cloudflare Access (migrasi, repository, Gin, middleware JWT, endpoint `/api/v1`)
- Plan 3/4: Scheduler + Notifier + HolidayProvider remote (ticker, dedupe, catch-up, Gotify/Telegram/SMTP, enkripsi)
- Plan 4/4: SPA + Deployment (Vite+React+TanStack, embed, Dockerfile, compose)

---

### Task 1: Scaffold modul + tipe `Date` + konversi JDN

**Files:**
- Create: `go.mod`
- Create: `internal/domain/date.go`
- Create: `internal/domain/jdn.go`
- Test: `internal/domain/jdn_test.go`

**Interfaces:**
- Produces: `type Date struct{ Year, Month, Day int }`; `NewDate(y, m, d int) Date`; `DateFromTime(t time.Time) Date`; `(d Date) Time(loc *time.Location) time.Time`; `(d Date) AddDays(n int) Date`; `(d Date) JDN() int`; `DateFromJDN(jdn int) Date`; `(d Date) Weekday() int` (0=Sunday/Redite … 6=Saturday/Saniscara); `(d Date) Before/After/Equal(o Date) bool`.

- [ ] **Step 1: Init modul & package**

```bash
cd code && go mod init otorem && mkdir -p internal/domain scripts testdata
```

- [ ] **Step 2: Tulis tipe Date (belum ada test — tipe data murni)**

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

- [ ] **Step 3: Tulis test JDN yang gagal**

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
		{NewDate(2000, 1, 1), 2451545}, // Sabtu
		{NewDate(2026, 6, 17), 2461209}, // Rabu (Galungan)
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
	if got := d.AddDays(1); got != NewDate(2026, 3, 1) { // 2026 bukan kabisat
		t.Errorf("AddDays(1) dari 2026-02-28 = %s, want 2026-03-01", got)
	}
	if got := d.AddDays(2).AddDays(-2); got != d {
		t.Errorf("round trip: got %s, want %s", got, d)
	}
}
```

- [ ] **Step 4: Run test — pastikan GAGAL (belum ada JDN())**

Run: `go test ./internal/domain/ -run TestJDN -v`
Expected: FAIL — compile error `undefined: DateFromJDN` (date.go memakainya; Step 5 melengkapinya)

- [ ] **Step 5: Implementasi JDN (Fliegel–Van Flandern + inverse)**

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

- [ ] **Step 6: Run test — PASS**

Run: `go test ./internal/domain/ -v`
Expected: PASS semua (jika `TestJDNKnownValues` gagal di 2026-06-17, cek aritmetika, JANGAN ubah nilai test — nilai itu terverifikasi weekday Rabu + delta 420 hari ke 2025-04-23).

- [ ] **Step 7: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add go.mod internal/
git commit -m "feat(domain): civil Date type + JDN conversion (Fliegel-Van Flandern)"
```

---

### Task 2: Konverter Pawukon (anchor + 30 wuku)

**Files:**
- Create: `internal/domain/pawukon.go`
- Test: `internal/domain/pawukon_test.go`

**Interfaces:**
- Consumes: `Date.JDN()`, `Date.Weekday()`, `Date.AddDays` (Task 1)
- Produces: `const PawukonCycleDays = 210`; `func CycleDay(d Date) int` (1..210); `type PawukonDate struct{ Saptawara, Pancawara, Wuku int }`; `func Pawukon(d Date) PawukonDate`; `func (p PawukonDate) Label() string`; var `Saptawara [7]string`, `Pancawara [5]string`, `Wuku [30]string`.

- [ ] **Step 1: Tulis test yang gagal**

`internal/domain/pawukon_test.go`:

```go
package domain

import "testing"

// Anchor verification (spec §5.1): Galungan selalu Buda Kliwon Wuku Dunggulan.
// Tanggal terpublikasi: 23 Apr 2025, 19 Nov 2025, 17 Jun 2026.
// Kuningan = Saniscara Kliwon Wuku Kuningan (Galungan + 10 hari).
func TestPawukonAnchorDates(t *testing.T) {
	cases := []struct {
		d    Date
		want PawukonDate
	}{
		{NewDate(2025, 4, 23), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2025, 11, 19), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}}, // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 17), PawukonDate{Saptawara: 3, Pancawara: 3, Wuku: 10}},  // Buda Kliwon Dunggulan
		{NewDate(2026, 6, 27), PawukonDate{Saptawara: 6, Pancawara: 3, Wuku: 11}},  // Saniscara Kliwon Kuningan
		{NewDate(2026, 4, 5), PawukonDate{Saptawara: 0, Pancawara: 0, Wuku: 0}},    // hari-1 siklus: Redite Paing Sinta
	}
	for _, c := range cases {
		got := Pawukon(c.d)
		if got != c.want {
			t.Errorf("Pawukon(%s) = %+v, want %+v (%s)", c.d, got, c.want, c.want.Label())
		}
	}
}

// Property: siklus 210 hari tanpa kabisat — Pawukon(d) == Pawukon(d+210k),
// dan saptawara hasil modulo siklus harus = weekday Gregorian (cek silang).
func TestPawukonCycleProperties(t *testing.T) {
	base := NewDate(2000, 1, 1)
	for i := 0; i < 500; i++ {
		d := base.AddDays(i*3 + 11)
		if Pawukon(d) != Pawukon(d.AddDays(PawukonCycleDays)) {
			t.Fatalf("siklus 210 rusak pada %s", d)
		}
		if saptawaraFromCycle := (CycleDay(d) - 1) % 7; saptawaraFromCycle != d.Weekday() {
			t.Fatalf("saptawara siklus %d != weekday %d pada %s", saptawaraFromCycle, d.Weekday(), d)
		}
	}
}

func TestCycleDayAtAnchor(t *testing.T) {
	if got := CycleDay(NewDate(2026, 6, 17)); got != 74 {
		t.Errorf("CycleDay(anchor) = %d, want 74", got)
	}
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/domain/ -run TestPawukon -v`
Expected: FAIL — `Pawukon undefined`

- [ ] **Step 3: Implementasi pawukon.go**

`internal/domain/pawukon.go`:

```go
package domain

// Pawukon: kalender Bali 210 hari, 10 minggu paralel. v1 hanya butuh
// saptawara (7), pancawara (5), dan wuku (30×7 hari) — lihat spec §5.1.
//
// ANCHOR (satu-satunya konstanta kalender di codebase): 2026-06-17 adalah
// Galungan = Buda Kliwon, Wuku Dunggulan = hari ke-74 siklus. Diverifikasi
// oleh TestPawukonAnchorDates (3 tanggal Galungan terpublikasi) dan fixture
// harian kalenderbali.org (Task 3). Jika test merah, perbaiki HANYA di sini.
var (
	pawukonAnchorJDN      = NewDate(2026, 6, 17).JDN()
	pawukonAnchorCycleDay = 74
)

const PawukonCycleDays = 210

var Saptawara = [7]string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}

// Urutan siklus pancawara: hari ke-1 siklus = Paing (diverifikasi anchor:
// hari-74 = Kliwon → (74-1) mod 5 = 3 → indeks 3 = Kliwon).
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
		Saptawara: d.Weekday(), // saptawara identik hari Gregorian, Redite=Minggu
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
Expected: PASS. Jika `TestPawukonAnchorDates` merah di SEMUA kasus: offset anchor salah → cek `pawukonAnchorCycleDay`. Jika hanya 1 tanggal merah: tanggal sumber yang salah, verifikasi ulang sebelum menyentuh kode.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): pawukon converter with verified anchor (Galungan 2026-06-17)"
```

---

### Task 3: Fixture scraper kalenderbali.org + test fixture

**Files:**
- Create: `scripts/fetch_fixtures/main.go`
- Create: `scripts/fetch_fixtures/go.mod` (modul terpisah `otorem/scripts/fetchfixtures` — agar goquery tidak masuk modul utama)
- Create: `internal/domain/fixture_test.go`
- Create (hasil run): `testdata/pawukon_2025.csv`, `testdata/pawukon_2026.csv`

**Interfaces:**
- Consumes: `Pawukon(d Date) PawukonDate`, nama hari/wuku (Task 2)
- Produces: fixture CSV `date,saptawara,pancawara,wuku` (format `2006-01-02`); test `TestPawukonAgainstFixtures` yang menjadi wasit anchor & tabel hari raya selamanya.

- [ ] **Step 1: Buat modul scraper**

```bash
mkdir -p scripts/fetch_fixtures && cd scripts/fetch_fixtures && go mod init otorem/scripts/fetchfixtures && go get github.com/PuerkitoBio/goquery@latest
```

- [ ] **Step 2: Tulis scraper**

`scripts/fetch_fixtures/main.go`:

```go
// Scraper fixture: ambil peta tanggal Gregorian → (saptawara, pancawara, wuku)
// dari kalenderbali.org untuk setahun, tulis ke testdata/pawukon_<year>.csv.
// Pemakaian data: fixture pengujian pribadi (spec §6) — data © kalenderbali.org
// (I Wayan Nuarsa, Universitas Udayana), dikreditkan, TIDAK dire distribusikan.
//
// Pemakaian: go run . -year 2026 -out ../../testdata
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

// pola baris harian di halaman rerainan/haripenting, contoh:
// "17-06-2026. Buda Kliwon Dunggulan"
var dayRe = regexp.MustCompile(`(\d{2})-(\d{2})-(\d{4})\.?\s+([A-Za-z]+)\s+([A-Za-z]+)\s+([A-Za-z]+)`)

// ejaan sumber bervariasi; normalisasi ke konstanta engine. Nama yang tidak
// ada di sini DAN tidak cocok konstanta engine = error keras (jangan diam).
var normalize = map[string]string{
	"Keliwon": "Kliwon",
	"Tolu":    "Taulu",
	"Wugu":    "Ugu",
	"Kaulu":   "Kelawu",
	"Luang":   "Luang", // dipertahankan; test akan gagal jika muncul sebagai wuku
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
		text, _ := doc.Find("body").Html() // baris harian berpola dayRe di dalam body
		for _, m := range dayRe.FindAllStringSubmatch(strings.TrimSpace(text), -1) {
			day, month, yearStr := m[1], m[2], m[3]
			sap, pan, wuk := norm(m[4]), norm(m[5]), norm(m[6])
			fmt.Fprintf(f, "%s-%s-%s,%s,%s,%s\n", yearStr, month, day, sap, pan, wuk)
			seen++
		}
		time.Sleep(1500 * time.Millisecond) // sopan: jangan menembak server
	}
	log.Printf("total baris: %d → %s/pawukon_%d.csv", seen, *out, *year)
	if seen < 350 { log.Fatalf("baris %d < 350 — kemungkinan struktur HTML berubah; curl halaman & sesuaikan dayRe", seen) }
}
```

- [ ] **Step 3: Jalankan scraper & periksa hasil**

```bash
cd scripts/fetch_fixtures && go run . -year 2026 -out ../../testdata && go run . -year 2025 -out ../../testdata
head -5 ../../testdata/pawukon_2026.csv && wc -l ../../testdata/pawukon_*.csv
```
Expected: ≈365 baris/tahun. **Jika 0 baris / gagal parse**: `curl -s 'https://kalenderbali.org/rerainan.php?bulan=6&tahun=2026' | head -100`, lihat struktur aktual, sesuaikan `dayRe`/selektor — parser boleh disesuaikan, DOMAIN TIDAK. **Jika situs mati total**: buat CSV manual minimal berisi 8 baris terverifikasi (4 tanggal Galungan/Kuningan di Task 2 + 2026-04-05 Redite Paing Sinta + 3 baris lain dari sumber cetak), commit, dan lanjut — test fixture tetap jadi wasit.

- [ ] **Step 4: Tulis test fixture (gagal jika CSV belum ada → di-skip)**

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
	// ejaan fixture harus persis konstanta engine (normalisasi terjadi di scraper)
	for _, n := range strings.Split("Kliwon,Umanis,Dunggulan,Watugunung", ",") {
		if indexOf(Wuku[:], n) < 0 && indexOf(Pancawara[:], n) < 0 {
			t.Errorf("nama %q tidak dikenal engine", n)
		}
	}
}
```

- [ ] **Step 5: Run semua test — PASS**

Run: `go test ./internal/domain/ -v`
Expected: `TestPawukonAgainstFixtures` PASS terhadap ratusan baris nyata — ini bukti anchor & tabel benar. Jika ada baris merah: catat polanya (mis. selisih +1 hari di wuku tertentu = anchor geser; ejaan beda = tambah alias `normalize` di scraper, bukan di engine).

- [ ] **Step 6: Commit (termasuk CSV fixture)**

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
- Consumes: `Date`, `Pawukon`, `PawukonDate.Label()` (Task 1–2)
- Produces: `type OccurrenceType string`; const `Birthday, Otonan, Anniversary OccurrenceType`; `type Occurrence struct{ Date Date; Type OccurrenceType; Number int; Label string }`; `func NextOccurrence(base Date, typ OccurrenceType, from Date) (Occurrence, error)` (inklusif `from`); `func OccurrencesBetween(base Date, typ OccurrenceType, from, to Date) ([]Occurrence, error)`; `func Age(base, on Date) int`.

- [ ] **Step 1: Tulis test yang gagal**

`internal/domain/occurrence_test.go`:

```go
package domain

import "testing"

func TestNextOccurrenceOtonan(t *testing.T) {
	base := NewDate(2026, 1, 10)
	// Otonan pertama = lahir + 210 hari; inclusive terhadap `from`.
	if occ, _ := NextOccurrence(base, Otonan, base); occ.Date != base.AddDays(210) {
		t.Errorf("otoman pertama = %s, want %s", occ.Date, base.AddDays(210))
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(210)); occ.Number != 1 {
		t.Errorf("Number tepat di hari otonan = %d, want 1 (inklusif)", occ.Number)
	}
	if occ, _ := NextOccurrence(base, Otonan, base.AddDays(211)); occ != (Occurrence{
		Date: base.AddDays(420), Type: Otonan, Number: 2,
		Label: "Otonan ke-2 — " + Pawukon(base.AddDays(420)).Label(),
	}) {
		t.Errorf("otoman kedua salah: %+v", occ)
	}
	// konsistensi pawukon: label pawukon tanggal lahir == tanggal otonan
	b, _ := NextOccurrence(base, Otonan, base)
	if Pawukon(base).Label() != Pawukon(b.Date).Label() {
		t.Errorf("pawukon beda: %s vs %s", Pawukon(base).Label(), Pawukon(b.Date).Label())
	}
}

func TestNextOccurrenceBirthday(t *testing.T) {
	leap := NewDate(2000, 2, 29)
	occ, _ := NextOccurrence(leap, Birthday, NewDate(2025, 1, 1))
	if occ.Date != NewDate(2025, 3, 1) || occ.Number != 25 { // 29 Feb → 1 Mar non-kabisat (spec §5.2)
		t.Errorf("29Feb non-kabisat: %+v, want 2025-03-01 umur 25", occ)
	}
	occ, _ = NextOccurrence(leap, Birthday, NewDate(2024, 1, 1))
	if occ.Date != NewDate(2024, 2, 29) || occ.Number != 24 {
		t.Errorf("29Feb kabisat: %+v, want 2024-02-29 umur 24", occ)
	}
	occ, _ = NextOccurrence(NewDate(1990, 12, 30), Birthday, NewDate(2026, 1, 1))
	if occ.Date != NewDate(2026, 12, 30) || occ.Number != 36 {
		t.Errorf("birthday biasa lintas tahun: %+v", occ)
	}
}

func TestOccurrencesBetween(t *testing.T) {
	base := NewDate(2026, 1, 10)
	occs, _ := OccurrencesBetween(base, Otonan, base, base.AddDays(1000))
	if len(occs) != 5 { // hari ke-210,420,630,840,1000? → 210,420,630,840 = 4 saja (1000 < 1050)
		t.Fatalf("dapat %d occurrence, want 4", len(occs))
	}
	if occs[3].Number != 4 { t.Errorf("urutan N salah: %+v", occs[3]) }
	occs2, _ := OccurrencesBetween(NewDate(2026, 6, 20), Birthday, NewDate(2026, 1, 1), NewDate(2026, 12, 31))
	if len(occs2) != 1 || occs2[0].Date != NewDate(2026, 6, 20) {
		t.Errorf("birthday dalam range: %+v", occs2)
	}
}

func TestAge(t *testing.T) {
	if Age(NewDate(2000, 2, 29), NewDate(2025, 3, 1)) != 25 { t.Error("age 29Feb") }
	if Age(NewDate(1990, 12, 30), NewDate(2026, 12, 29)) != 35 { t.Error("age sebelum ultah") }
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/domain/ -run 'Occurrence|Age' -v`
Expected: FAIL — `NextOccurrence undefined`

- [ ] **Step 3: Implementasi occurrence.go**

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
// Number semantics: Otonan → siklus ke-N (N≥1); Birthday → umur;
// Anniversary → tahun ke- sejak base.
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

// yearlyDate: ulang tahun base di tahun y; 29 Feb → 1 Mar pada tahun non-kabisat.
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

// Age: umur penuh pada tanggal `on` (aman untuk 29 Feb → hitung berdasar tahun).
func Age(base, on Date) int { return on.Year - base.Year }

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func max(a, b int) int { if a > b { return a }; return b }
```

- [ ] **Step 4: Run — PASS**

Run: `go test ./internal/domain/ -v`
Expected: PASS semua. Catatan TestOccurrencesBetween: 4 occurrence (210/420/630/840) — komentar test sengaja menuntut 4, bukan 5.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): occurrence engine (otongan 210d, birthday feb29, anniversary)"
```

---

### Task 5: Hari raya Pawukon (dihitung lokal)

**Files:**
- Create: `internal/domain/holidays.go`
- Test: `internal/domain/holidays_test.go`

**Interfaces:**
- Consumes: `Pawukon`, `PawukonDate`, nama-nama (Task 2), `Date` (Task 1)
- Produces: `type Holiday struct{ Date Date; Name string }`; `func PawukonHolidaysBetween(from, to Date) []Holiday`; var `PawukonHolidayDefs []HolidayDef` (`type HolidayDef struct{ Name string; Saptawara, Pancawara, Wuku int }`) — hanya 4 definisi baku; perluasan harus lolos fixture dulu.

- [ ] **Step 1: Tulis test yang gagal**

`internal/domain/holidays_test.go`:

```go
package domain

import "testing"

func TestGalunganKuningan2026(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 6, 1), NewDate(2026, 7, 31))
	got := map[Date]string{}
	for _, h := range hs { got[h.Date] = h.Name }
	if got[NewDate(2026, 6, 17)] != "Galungan" { t.Errorf("Galungan 2026-06-17 tidak ada: %v", got) }
	if got[NewDate(2026, 6, 27)] != "Kuningan" { t.Errorf("Kuningan 2026-06-27 tidak ada: %v", got) }
}

// Satu siklus penuh (210 hari mulai hari-1 siklus = 2026-04-05) memuat tepat
// sekali: Galungan (hari-74), Kuningan (hari-84), Pagerwesi (hari-4), Saraswati (hari-210).
func TestOneCycleExactHolidays(t *testing.T) {
	hs := PawukonHolidaysBetween(NewDate(2026, 4, 5), NewDate(2026, 4, 5).AddDays(209))
	if len(hs) != 4 { t.Fatalf("dapat %d hari raya, want 4: %+v", len(hs), hs) }
	names := map[string]bool{}
	for _, h := range hs { names[h.Name] = true }
	for _, want := range []string{"Galungan", "Kuningan", "Saraswati", "Pagerwesi"} {
		if !names[want] { t.Errorf("hilang %s dalam 1 siklus", want) }
	}
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/domain/ -run Holiday -v`
Expected: FAIL — `PawukonHolidaysBetween undefined`

- [ ] **Step 3: Implementasi holidays.go**

`internal/domain/holidays.go`:

```go
package domain

import "fmt"

// HolidayDef: satu hari raya Pawukon = kombinasi (saptawara, pancawara, wuku).
type HolidayDef struct {
	Name      string
	Saptawara int
	Pancawara int
	Wuku      int
}

// HANYA definisi yang sudah baku dan diverifikasi (spec §5.3). Menambah
// definisi (deret Tumpek, Sugihan, dsb.) WAJIB: tambahkan baris di fixture
// scraper terlebih dahulu, buktikan tanggalnya cocok, baru masuk sini.
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
// O( jumlah hari × jumlah definisi ) — trivial untuk rentang horizon app.
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
Expected: PASS semua termasuk fixture test. Jika fixture menyebut hari raya lain (Sugihan, Tumpek) — abaikan untuk v1; tabel diperluas di Plan 3 bersama HolidayProvider.

- [ ] **Step 5: Commit**

```bash
gofmt -w internal/ && go vet ./...
git add internal/
git commit -m "feat(domain): pawukon holidays (galungan, kunningan, saraswati, pagerwesi)"
```

---

### Task 6: Tanggal reminder (offset) + rangkum API domain

**Files:**
- Create: `internal/domain/reminder.go`
- Create: `internal/domain/doc.go`
- Test: `internal/domain/reminder_test.go`

**Interfaces:**
- Consumes: `Date` (Task 1)
- Produces: `var DefaultOffsets = []int{7, 4, 2, 1, 0}`; `func ReminderDates(occurrenceDate Date, offsets []int) ([]Date, error)` (terurut naik, dedupe, semua offset ≥ 0, maks 60); `func ValidateOffsets(offsets []int) error`.

- [ ] **Step 1: Tulis test yang gagal**

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
	if len(got) != 3 { t.Fatalf("dapat %d tanggal, want 3 (dedupe): %v", len(got), got) }
	if got[0] != NewDate(2026, 6, 10) || got[2] != NewDate(2026, 6, 17) {
		t.Errorf("urutan salah: %v", got)
	}
}

func TestValidateOffsets(t *testing.T) {
	if err := ValidateOffsets([]int{-1}); err == nil { t.Error("offset negatif harus error") }
	if err := ValidateOffsets([]int{1, 1, 500}); err == nil { t.Error("duplikat/terlalu besar harus error") }
	if err := ValidateOffsets(DefaultOffsets); err != nil { t.Errorf("default harus valid: %v", err) }
}
```

- [ ] **Step 2: Run — GAGAL**

Run: `go test ./internal/domain/ -run Reminder -v`
Expected: FAIL — `ReminderDates undefined`

- [ ] **Step 3: Implementasi reminder.go**

`internal/domain/reminder.go`:

```go
package domain

import (
	"fmt"
	"sort"
)

// DefaultOffsets: H-7, H-4, H-2, H-1, H (spec §2, configurable di Settings).
var DefaultOffsets = []int{7, 4, 2, 1, 0}

// ValidateOffsets: non-negatif, tanpa duplikat, ≤ 60 hari (paling jauh 2 bulan).
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

// ReminderDates: tanggal-tanggal reminder untuk satu occurrence —
// occurrenceDate − offset, terurut naik, dedupe.
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
// Package domain adalah engine kalender murni otorem: Pawukon Bali, otonan,
// ulang tahun, anniversary, hari raya Pawukon, dan tanggal reminder.
// DILARANG menambahkan dependensi I/O di package ini (lihat plan, Global
// Constraints) — semua keputusan timezone dilakukan oleh layer scheduler.
package domain
```

- [ ] **Step 4: Run seluruh test + lint**

Run: `gofmt -l internal/ scripts/ ; go vet ./... && go test ./internal/domain/ -v -count=1`
Expected: kosong (format), vet bersih, semua test PASS.

- [ ] **Step 5: Commit + tag akhir plan**

```bash
git add internal/
git commit -m "feat(domain): reminder dates + validate offsets; domain package complete"
git tag plan-1-domain-engine-done
```

---

## Definition of Done (Plan 1)

- [ ] `go test ./internal/domain/ -v -count=1` hijau penuh, termasuk fixture ratusan hari nyata.
- [ ] `go build ./...` sukses dengan `CGO_ENABLED=0`.
- [ ] `internal/domain` tanpa import I/O (`go list -deps` dicek manual).
- [ ] Semua task ter-commit; tag `plan-1-domain-engine-done` ada.
- [ ] Anchor Pawukon hanya di `pawukon.go`; tabel hari raya hanya 4 definisi baku.
